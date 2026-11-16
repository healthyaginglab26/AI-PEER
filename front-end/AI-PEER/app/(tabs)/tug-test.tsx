import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  LayoutChangeEvent,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useLLM } from "@/src/llm";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from "react-native-vision-camera";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { speak, stopSpeech } from "@/src/tts";
import { useVision } from "@/src/vision";
import { setPalmThresholds, resetPalmThresholds } from "@/src/vision/VisionContext";
import { useVisionFrameProcessor } from "@/src/vision/frameProcessor";
import { SkeletonOverlay } from "@/src/vision/components/SkeletonOverlay";
import { GuideOverlay } from "@/src/vision/components/GuideOverlay";
import { GestureCountdownOverlay } from "@/components/GestureCountdownOverlay";
import { getExerciseRules } from "@/src/vision/exercises";
import { calculateAngle3D, isConfident } from "@/src/vision/exercises/utils";
import { submitCompletedActivity } from "@/src/exercise-activity-storage";
import { usePrefs } from "../../src/prefs-context";
import { type ContrastPalette } from "../../src/theme";

const EXERCISE_ID = "assessment-3";
const EXERCISE_NAME = "Timed Up and Go";

// State machine thresholds. The pre-test "getting_ready" 10s countdown is
// gone — the gesture-confirm flow in VisionContext (arms overhead → 5s
// countdown) now handles the pre-test phase before tugState advances out of
// 'idle'.
// TUG runs farther from the phone (~10 ft) than the other exercises, so
// everything here is tuned for that distance.
const STAND_THRESHOLD = 135;    // 3D knee angle ≥ this means standing. 135
                                // catches partial lockout; full 145 required
                                // near-perfect extension which was unreliable
                                // at distance.
const SIT_THRESHOLD = 125;      // 3D knee angle ≤ this means seated.
const FRAMES_REQUIRED = 2;      // require N consecutive frames in zone.
const LOCKOUT_MS = 5000;        // ignore knee angle for 5s after initial stand.
const KEYPOINT_MIN_CONFIDENCE = 0.25; // per-landmark gate for knee/hip/ankle.
                                      // default is 0.4, but at 10 ft those
                                      // landmarks frequently sit 0.3–0.5 —
                                      // 0.4 rejected real standing frames.

// Secondary sit→stand signal. At distance the knee angle is often missed
// because one or both legs have low-confidence landmarks. Shoulders are
// large and reliably tracked — when a seated person rises, both shoulders
// translate up in image-Y by a significant fraction of frame height. If
// the current shoulder Y has risen by ≥ this fraction vs the sitting
// baseline captured when we enter `waiting_for_stand`, count it as
// standing regardless of knee angle.
const SHOULDER_RISE_THRESHOLD = 0.08;

type TugState =
  | "idle"
  | "waiting_for_stand"
  | "walking"
  | "waiting_for_final_sit"
  | "done";

function tugFallRiskBand(
  seconds: number,
  accent: string,
  t: (key: string) => string
): { label: string; color: string } {
  if (seconds < 12) return { label: t("tug-test.bandNormal"), color: "#1E7A3A" };
  return { label: t("tug-test.bandIncreasedRisk"), color: accent };
}

function stateLabel(state: TugState, t: (key: string) => string): string {
  switch (state) {
    case "idle":
      return t("tug-test.stateIdle");
    case "waiting_for_stand":
      return t("tug-test.stateWaitingForStand");
    case "walking":
      return t("tug-test.stateWalking");
    case "waiting_for_final_sit":
      return t("tug-test.stateWaitingForFinalSit");
    case "done":
      return t("tug-test.stateDone");
  }
}

export default function TugTestPage() {
  const router = useRouter();
  const { releaseModel } = useLLM();

  useFocusEffect(
    useCallback(() => {
      releaseModel().catch(console.error);
    }, [releaseModel])
  );
  const { colors } = usePrefs();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const warmRed = colors.accent;

  const exerciseRule = useMemo(() => getExerciseRules(EXERCISE_ID), []);

  // Relax the open-palm trigger while this screen is mounted. The phone sits
  // ~10 ft from the user for TUG, which shrinks the hand to a handful of
  // pixels; the default geometry thresholds (calibrated for ~6 ft exercise
  // sessions) reject most frames. Reset on unmount so exercise-session,
  // chair-rise, balance continue to see the strict defaults.
  useEffect(() => {
    // Aggressive relaxation for ~10ft distance. First round (0.85 / 3 / 1.0
    // / 700) was still inconsistent per device testing, so dropping each knob
    // another notch. The open-palm-normal-vs-camera check (check 4 inside
    // detectOpenPalm) still fires, so we won't false-positive on a fist or a
    // back-of-hand — we're only relaxing the geometric strictness.
    setPalmThresholds({
      fingerExtension: 0.75,
      minExtendedFingers: 2,
      thumbReachRatio: 0.8,
      holdMs: 500,
    });
    return () => {
      resetPalmThresholds();
    };
  }, []);

  const modelReady = true;

  const {
    isTracking,
    trackingMode,
    countdownSecondsLeft,
    currentPose,
    currentFeedback,
    error: visionError,
    setModelReady,
    startTracking,
    startGestureWatch,
    stopTracking,
    handlePoseResult,
  } = useVision();

  useEffect(() => {
    setModelReady(modelReady);
  }, [modelReady, setModelReady]);

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("front");

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const handleCameraLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  }, []);

  // state machine
  const [tugState, setTugState] = useState<TugState>("idle");
  const [walkSec, setWalkSec] = useState<number>(0);
  const [finalElapsed, setFinalElapsed] = useState<number>(0);

  const startTimeRef = useRef<number | null>(null);
  const lockoutEndsAtRef = useRef<number>(0);
  const framesInTargetRef = useRef<number>(0);
  const lastKneeAngleRef = useRef<number | null>(null);
  // Shoulder Y captured when entering `waiting_for_stand`. Used as a
  // backstop if knee keypoints are unreliable at distance.
  const sittingShoulderYRef = useRef<number | null>(null);

  // frame processor wiring — receives pose AND hands per frame
  const handleFrameResult = useCallback(
    (
      pose: Parameters<typeof handlePoseResult>[0],
      hands: Parameters<typeof handlePoseResult>[1]
    ) => {
      handlePoseResult(pose, hands);
    },
    [handlePoseResult]
  );
  const frameProcessor = useVisionFrameProcessor(modelReady, handleFrameResult);

  // Compute the 3D knee angle from whichever leg has confident landmarks.
  // If both legs pass confidence, return the MAX of the two angles. That
  // choice works for both thresholds:
  //   - STAND (angle ≥ 135): max ≥ 135 means at least one leg is straight,
  //     which is sufficient to call the user "standing".
  //   - SIT (angle ≤ 125): max ≤ 125 means even the straightest leg is
  //     bent, which is exactly the "fully seated" condition we want.
  // Returns null only if BOTH legs fail the confidence gate.
  const computeKneeAngle = useCallback((): number | null => {
    if (!currentPose) return null;
    const kpByName = new Map(
      currentPose.keypoints.map((k) => [k.name, k])
    );
    const legAngle = (side: "left" | "right"): number | null => {
      const hip = kpByName.get(`${side}_hip`);
      const knee = kpByName.get(`${side}_knee`);
      const ankle = kpByName.get(`${side}_ankle`);
      if (!hip || !knee || !ankle) return null;
      if (
        !isConfident(hip, KEYPOINT_MIN_CONFIDENCE) ||
        !isConfident(knee, KEYPOINT_MIN_CONFIDENCE) ||
        !isConfident(ankle, KEYPOINT_MIN_CONFIDENCE)
      )
        return null;
      return calculateAngle3D(hip, knee, ankle);
    };
    const left = legAngle("left");
    const right = legAngle("right");
    if (left === null && right === null) return null;
    if (left === null) return right;
    if (right === null) return left;
    return Math.max(left, right);
  }, [currentPose]);

  // Average shoulder Y across confident left/right shoulder landmarks.
  // Returns null if neither shoulder passes the confidence gate.
  const computeShoulderY = useCallback((): number | null => {
    if (!currentPose) return null;
    const ls = currentPose.keypoints.find((k) => k.name === "left_shoulder");
    const rs = currentPose.keypoints.find((k) => k.name === "right_shoulder");
    const lOk = ls && isConfident(ls, KEYPOINT_MIN_CONFIDENCE);
    const rOk = rs && isConfident(rs, KEYPOINT_MIN_CONFIDENCE);
    if (!lOk && !rOk) return null;
    if (lOk && rOk) return (ls!.y + rs!.y) / 2;
    return (lOk ? ls! : rs!).y;
  }, [currentPose]);

  // pose-watching effect — runs the state machine transitions that depend on knee angle
  useEffect(() => {
    if (!isTracking) return;
    if (
      tugState !== "waiting_for_stand" &&
      tugState !== "waiting_for_final_sit"
    )
      return;

    const angle = computeKneeAngle();
    if (angle !== null) lastKneeAngleRef.current = angle;

    if (tugState === "waiting_for_stand") {
      // Capture the sitting shoulder baseline on the first confident
      // shoulder reading after this state begins.
      const shoulderY = computeShoulderY();
      if (
        sittingShoulderYRef.current === null &&
        shoulderY !== null
      ) {
        sittingShoulderYRef.current = shoulderY;
      }

      const kneeStanding = angle !== null && angle >= STAND_THRESHOLD;
      const shoulderStanding =
        shoulderY !== null &&
        sittingShoulderYRef.current !== null &&
        sittingShoulderYRef.current - shoulderY >= SHOULDER_RISE_THRESHOLD;

      if (kneeStanding || shoulderStanding) {
        framesInTargetRef.current += 1;
        if (framesInTargetRef.current >= FRAMES_REQUIRED) {
          framesInTargetRef.current = 0;
          startTimeRef.current = Date.now();
          lockoutEndsAtRef.current = Date.now() + LOCKOUT_MS;
          setTugState("walking");
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
            () => {}
          );
        }
      } else {
        framesInTargetRef.current = 0;
      }
    } else if (tugState === "waiting_for_final_sit") {
      if (angle === null) return;
      if (angle <= SIT_THRESHOLD) {
        framesInTargetRef.current += 1;
        if (framesInTargetRef.current >= FRAMES_REQUIRED) {
          framesInTargetRef.current = 0;
          const startedAt = startTimeRef.current ?? Date.now();
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          finishTest(elapsed);
        }
      } else {
        framesInTargetRef.current = 0;
      }
    }
    // we deliberately depend on currentPose to run on every new frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPose, tugState, isTracking]);

  // walking → waiting_for_final_sit transition (after 5s lockout)
  useEffect(() => {
    if (tugState !== "walking") return;
    const remaining = lockoutEndsAtRef.current - Date.now();
    if (remaining <= 0) {
      setTugState("waiting_for_final_sit");
      return;
    }
    const t = setTimeout(() => setTugState("waiting_for_final_sit"), remaining);
    return () => clearTimeout(t);
  }, [tugState]);

  // running elapsed-time display while walking and waiting_for_final_sit
  useEffect(() => {
    if (tugState !== "walking" && tugState !== "waiting_for_final_sit") return;
    if (startTimeRef.current === null) return;
    const t = setInterval(() => {
      if (startTimeRef.current === null) return;
      setWalkSec((Date.now() - startTimeRef.current) / 1000);
    }, 100);
    return () => clearInterval(t);
  }, [tugState]);

  // gesture-flow handoff: when the VisionContext countdown completes and
  // trackingMode flips to 'tracking', we're ready to start watching for the
  // initial stand. only fires once per test (gated on tugState === 'idle').
  useEffect(() => {
    if (trackingMode !== "tracking") return;
    if (tugState !== "idle") return;
    framesInTargetRef.current = 0;
    sittingShoulderYRef.current = null; // will be captured from the first
                                        // confident shoulder reading below
    stopSpeech();
    speak(t("tug-test.ttsStart"));
    setTugState("waiting_for_stand");
  }, [trackingMode, tugState, t]);

  const finishTest = useCallback(
    (elapsedSeconds: number) => {
      setFinalElapsed(elapsedSeconds);
      setTugState("done");

      // TUG has no reps and no form score — the test result is durationSec.
      // dropped the previous avgScore=elapsedSeconds hack since durationSec
      // already carries that information cleanly.
      void submitCompletedActivity({
        exerciseId: EXERCISE_ID,
        exerciseName: EXERCISE_NAME,
        category: "assessment",
        setsCompleted: 1,
        setsTarget: 1,
        durationSec: elapsedSeconds,
        totalReps: 0,
        repsPerSet: [0],
        unilateral: false,
        angleSummaries: [],
        feedbackEvents: [],
        avgScore: null,
        framesAnalyzed: 0,
      }).catch((error) => {
        console.error("[TugTest] Failed to save activity record:", error);
      });

      const band = tugFallRiskBand(elapsedSeconds, warmRed, t);
      stopSpeech();
      speak(
        t("tug-test.ttsComplete", {
          seconds: elapsedSeconds,
          band: band.label,
        })
      );
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      ).catch(() => {});

      stopTracking();
    },
    [stopTracking, t, warmRed]
  );

  const handleStart = useCallback(async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) return;
    }
    if (!modelReady) return;

    // reset state. tugState stays 'idle' through the gesture flow; the
    // trackingMode watcher effect flips it to 'waiting_for_stand' once the
    // gesture-confirm countdown completes.
    startTimeRef.current = null;
    lockoutEndsAtRef.current = 0;
    framesInTargetRef.current = 0;
    lastKneeAngleRef.current = null;
    setWalkSec(0);
    setFinalElapsed(0);

    startGestureWatch(EXERCISE_ID);
  }, [hasPermission, requestPermission, modelReady, startGestureWatch]);

  const handleAbort = useCallback(() => {
    stopTracking();
    stopSpeech();
    setTugState("idle");
    startTimeRef.current = null;
    setWalkSec(0);
  }, [stopTracking]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      startTimeRef.current = null;
      stopTracking();
      stopSpeech();
    };
  }, [stopTracking]);

  // camera renders during gesture wait + countdown + tracking
  const cameraActive =
    trackingMode !== "idle" && hasPermission && !!device;
  const band = tugFallRiskBand(finalElapsed, warmRed, t);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.containerContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => {
              handleAbort();
              router.replace("/(tabs)/balance-test");
            }}
            style={styles.backBtn}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back" size={18} color="#3D2F27" />
            <Text style={styles.backText}>{t("tug-test.back")}</Text>
          </TouchableOpacity>

          <View style={{ flex: 1 }} />
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
        </View>

        <Text style={styles.pageTitle}>{t("tug-test.pageTitle")}</Text>
        <Text style={styles.pageSub}>{stateLabel(tugState, t)}</Text>

        {/* Camera area */}
        <View style={styles.cameraContainer} onLayout={handleCameraLayout}>
          {cameraActive && device ? (
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={true}
              frameProcessor={frameProcessor}
              pixelFormat="rgb"
            />
          ) : (
            <View style={styles.cameraPlaceholder}>
              {!hasPermission ? (
                <>
                  <Ionicons name="camera-outline" size={40} color="#8C7A6C" />
                  <Text style={styles.cameraHint}>{t("tug-test.cameraAccessNeeded")}</Text>
                  <Text style={styles.cameraSmall}>
                    {t("tug-test.cameraPromptStart")}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="camera-outline" size={40} color="#8C7A6C" />
                  <Text style={styles.cameraHint}>{t("tug-test.readyToTest")}</Text>
                  <Text style={styles.cameraSmall}>
                    {exerciseRule?.cameraPrompt ??
                      t("tug-test.defaultCameraPrompt")}
                  </Text>
                </>
              )}
            </View>
          )}

          {/* skeleton overlays — visible in gesture/countdown/tracking */}
          {trackingMode !== "idle" && currentPose && containerSize.width > 0 && (
            <>
              <GuideOverlay
                pose={currentPose}
                exerciseId={EXERCISE_ID}
                width={containerSize.width}
                height={containerSize.height}
                isFrontCamera
              />
              <SkeletonOverlay
                pose={currentPose}
                feedback={currentFeedback}
                width={containerSize.width}
                height={containerSize.height}
                isFrontCamera
              />
            </>
          )}

          {/* gesture-confirm + countdown overlay — replaces the old 10s
              get-ready overlay. renders nothing in idle/tracking modes. */}
          <GestureCountdownOverlay
            trackingMode={trackingMode}
            countdownSecondsLeft={countdownSecondsLeft}
          />

          {/* Running timer overlay (walking + waiting_for_final_sit) */}
          {(tugState === "walking" || tugState === "waiting_for_final_sit") && (
            <View style={styles.timerOverlay}>
              <Text style={styles.timerText}>{walkSec.toFixed(1)}s</Text>
              <Text style={styles.timerLabel}>elapsed</Text>
            </View>
          )}

          {/* live knee-angle debug overlay — commented out for the first device
              walkthrough so the skeleton is visible without text obscuring it.
              uncomment to validate STAND_THRESHOLD / SIT_THRESHOLD again.
          {isTracking && lastKneeAngleRef.current !== null && (
            <View style={styles.angleOverlay}>
              <Text style={styles.angleText}>
                {Math.round(lastKneeAngleRef.current)}°
              </Text>
              <Text style={styles.angleLabel}>knee 3D</Text>
            </View>
          )}
          */}
        </View>

        {/* error display */}
        {visionError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{visionError}</Text>
          </View>
        )}

        {/* summary card after the test ends */}
        {tugState === "done" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("tug-test.testComplete")}</Text>
            <View style={styles.scoreRow}>
              <Text style={styles.scoreNumber}>{finalElapsed}</Text>
              <Text style={styles.scoreUnit}>{t("tug-test.seconds")}</Text>
            </View>
            <View style={[styles.bandBox, { borderColor: band.color }]}>
              <Text style={[styles.bandText, { color: band.color }]}>
                {band.label}
              </Text>
            </View>
            <Text style={styles.cardFootnote}>
              {t("tug-test.cdcFootnote")}
            </Text>
          </View>
        )}

        {/* tips card when idle */}
        {tugState === "idle" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("tug-test.howToTitle")}</Text>
            <View style={styles.tipBox}>
              <Text style={styles.tipText}>
                {"\u2022"} {t("tug-test.tip1")}{"\n"}
                {"\u2022"} {t("tug-test.tip2")}{"\n"}
                {"\u2022"} {t("tug-test.tip3")}{"\n"}
                {"\u2022"} {t("tug-test.tip4")}{"\n"}
                {"\u2022"} {t("tug-test.tip5")}{"\n"}
                {"\u2022"} {t("tug-test.tip6")}
              </Text>
            </View>
          </View>
        )}

        {/* controls */}
        <View style={styles.controlsRow}>
          {tugState === "idle" && trackingMode === "idle" ? (
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.9}
              onPress={handleStart}
            >
              <Ionicons name="play" size={16} color="#FFF" />
              <Text style={styles.primaryText}>{t("tug-test.startTest")}</Text>
            </TouchableOpacity>
          ) : tugState === "idle" &&
            (trackingMode === "waiting_for_gesture" ||
              trackingMode === "countdown") ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              activeOpacity={0.9}
              onPress={() => {
                handleAbort();
              }}
            >
              <Ionicons name="close" size={16} color="#5B4636" />
              <Text style={styles.secondaryText}>{t("tug-test.cancel")}</Text>
            </TouchableOpacity>
          ) : tugState === "done" ? (
            <>
              <TouchableOpacity
                style={styles.secondaryBtn}
                activeOpacity={0.9}
                onPress={() => router.replace("/(tabs)/balance-test")}
              >
                <Ionicons name="arrow-back" size={16} color="#5B4636" />
                <Text style={styles.secondaryText}>{t("tug-test.backToTests")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                activeOpacity={0.9}
                onPress={handleStart}
              >
                <Ionicons name="refresh" size={16} color="#FFF" />
                <Text style={styles.primaryText}>{t("tug-test.tryAgain")}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.stopBtn}
              activeOpacity={0.9}
              onPress={handleAbort}
            >
              <Ionicons name="square" size={16} color="#FFF" />
              <Text style={styles.primaryText}>{t("tug-test.cancel")}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 12 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ContrastPalette) => {
  const beige = colors.background;
  const beigeStrip = colors.bgTile;
  const warmRed = colors.accent;

  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: beige },
  container: { flex: 1, paddingHorizontal: 16 },
  containerContent: { paddingBottom: 24 },

  header: { paddingTop: 6, flexDirection: "row", alignItems: "center" },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  backText: { fontWeight: "900", color: colors.text },

  pageTitle: { fontSize: 18, fontWeight: "900", color: colors.text, marginTop: 4 },
  pageSub: { color: colors.muted, fontWeight: "600", marginBottom: 10 },

  cameraContainer: {
    height: 500,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1A1A1A",
    position: "relative",
  },
  cameraPlaceholder: {
    flex: 1,
    backgroundColor: "#FFF7F1",
    borderWidth: 1,
    borderColor: "#F0E0D4",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 16,
  },
  cameraHint: { color: colors.muted, fontWeight: "800", fontSize: 20 },
  cameraSmall: {
    color: "#5B4636",
    fontWeight: "700",
    textAlign: "center",
    fontSize: 17,
    lineHeight: 26,
  },

  bigCountdownOverlay: {
    position: "absolute",
    top: "30%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  bigCountdownNumber: {
    fontSize: 120,
    fontWeight: "900",
    color: "#FFF",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  bigCountdownLabel: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: "900",
    color: "#FFF",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  timerOverlay: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 3 },
    }),
  },
  timerText: { fontSize: 28, fontWeight: "900", color: colors.text },
  timerLabel: { fontSize: 10, fontWeight: "800", color: colors.muted, marginTop: 2 },

  angleOverlay: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(0,0,0,0.78)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  angleText: { fontSize: 22, fontWeight: "900", color: "#0F0" },
  angleLabel: { fontSize: 10, fontWeight: "800", color: "#AAA", marginTop: 2 },

  errorBox: {
    backgroundColor: "#FDECEA",
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  errorText: { color: warmRed, fontWeight: "700" },

  card: {
    backgroundColor: colors.bgTile,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 1.5 },
    }),
  },
  cardTitle: { fontWeight: "900", color: colors.text, marginBottom: 4, fontSize: 16 },
  cardFootnote: {
    marginTop: 10,
    color: "#8C7A6C",
    fontWeight: "600",
    fontSize: 12,
    lineHeight: 16,
  },

  scoreRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginTop: 12,
  },
  scoreNumber: { fontSize: 48, fontWeight: "900", color: colors.text },
  scoreUnit: { fontSize: 14, fontWeight: "700", color: colors.muted },

  bandBox: {
    marginTop: 12,
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  bandText: { fontSize: 16, fontWeight: "900" },

  tipBox: {
    marginTop: 10,
    backgroundColor: beigeStrip,
    borderRadius: 12,
    padding: 12,
  },
  tipText: { color: "#5B4636", fontWeight: "700", lineHeight: 22 },

  controlsRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#E6D4C6",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryText: { fontWeight: "900", color: "#5B4636" },

  primaryBtn: {
    flex: 1.4,
    backgroundColor: warmRed,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  stopBtn: {
    flex: 1,
    backgroundColor: "#333",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryText: { fontWeight: "900", color: "#FFF" },
  });
};
