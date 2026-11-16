import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  LayoutChangeEvent,
  ScrollView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useLLM } from "@/src/llm";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import { speak, stopSpeech } from "@/src/tts";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from "react-native-vision-camera";
import { useVision } from "@/src/vision";
import { useVisionFrameProcessor } from "@/src/vision/frameProcessor";
import { SkeletonOverlay } from "@/src/vision/components/SkeletonOverlay";
import { GuideOverlay } from "@/src/vision/components/GuideOverlay";
import { GestureCountdownOverlay } from "@/components/GestureCountdownOverlay";
import { getExerciseRules } from "@/src/vision/exercises";
import {
  submitCompletedActivity,
  ExerciseActivityCategory,
  AngleSummarySet,
  FeedbackEvent,
} from "@/src/exercise-activity-storage";
import { usePrefs } from "../../src/prefs-context";
import { type ContrastPalette } from "../../src/theme";

type CatKey = "warmup" | "strength" | "balance";

function toActivityCategory(
  cat?: string,
  fallbackCategory?: string
): ExerciseActivityCategory {
  if (cat === "warmup" || cat === "strength" || cat === "balance") return cat;
  if (
    fallbackCategory === "warmup" ||
    fallbackCategory === "strength" ||
    fallbackCategory === "balance" ||
    fallbackCategory === "assessment"
  ) {
    return fallbackCategory;
  }
  return "other";
}

export default function ExerciseSessionPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = usePrefs();
  const { releaseModel } = useLLM();

  useFocusEffect(
    useCallback(() => {
      releaseModel().catch(console.error);
    }, [releaseModel])
  );
  const styles = useMemo(() => createStyles(colors), [colors]);
  const warmRed = colors.accent;
  const params = useLocalSearchParams<{
    cat?: CatKey;
    video?: string;
    label?: string;
    duration?: string;
  }>();

  const prettyCat = (cat?: string) => {
    if (cat === "warmup") return t("exercise.warmupTitle");
    if (cat === "strength") return t("exercise.strengthTitle");
    if (cat === "balance") return t("exercise.balanceTitle");
    return t("exercise.exercise");
  }
  const title = useMemo(() => prettyCat(params.cat), [params.cat]);
  const exerciseId = params.video || `${params.cat || "warmup"}-1`;
  const exerciseRule = useMemo(() => getExerciseRules(exerciseId), [exerciseId]);
  const exerciseName = params.label || exerciseRule?.name || exerciseId;
  const activityCategory = useMemo(
    () => toActivityCategory(params.cat, exerciseRule?.category),
    [params.cat, exerciseRule?.category]
  );

  // MediaPipe model loads automatically via usePoseDetection hook in frameProcessor.
  // We consider it ready immediately since the hook handles initialization internally.
  const modelReady = true;
  const isModelLoading = false;
  const [modelError, setModelError] = useState<Error | null>(null);

  // vision hook
  const {
    isTracking,
    trackingMode,
    countdownSecondsLeft,
    currentPose,
    currentFeedback,
    repCount,
    targetReps: visionTargetReps,
    debugAngle,
    debugPhase,
    debugConfidences,
    debugPositions,
    error: visionError,
    setModelReady,
    startTracking,
    startGestureWatch,
    stopTracking,
    handlePoseResult,
    getRepHistory,
  } = useVision();

  // activity-scoped accumulators (span all sets of the current activity).
  // these are reset only when a new activity starts (handleStartMonitoring or
  // exerciseId change), NOT between sets — so the final activity record can
  // include the union of every set's reps, scores, frames, and violations.
  // declared up here so the exerciseId-reset effect below can call the reset.
  const activityRepsPerSetRef = useRef<number[]>([]);
  const activitySetDurationsRef = useRef<number[]>([]);
  const activityScoresRef = useRef<number[]>([]);
  const activityViolationsRef = useRef<Record<string, FeedbackEvent>>({});
  const activitySetAngleSummariesRef = useRef<AngleSummarySet[]>([]);
  // anchor for activity-relative timestamps in feedbackEvents firstAt/lastAt.
  // set in handleStartMonitoring (the first set of an activity) and never
  // reset between sets, so timestamps from set 2 don't collide with set 1.
  const activityStartedAtRef = useRef<number | null>(null);

  const resetActivityAccumulators = useCallback(() => {
    activityRepsPerSetRef.current = [];
    activitySetDurationsRef.current = [];
    activityScoresRef.current = [];
    activityViolationsRef.current = {};
    activitySetAngleSummariesRef.current = [];
    activityStartedAtRef.current = null;
  }, []);

  // reset sets when exercise changes
  useEffect(() => {
    setCurrentSet(1);
    setSetComplete(false);
    setShowSummary(false);
    resetActivityAccumulators();
  }, [exerciseId, resetActivityAccumulators]);

  // sync model ready state into vision context
  useEffect(() => {
    setModelReady(modelReady);
  }, [modelReady, setModelReady]);

  // camera
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("front");
  const insets = useSafeAreaInsets();
  // TEMP DIAGNOSTIC — remove after gesture nav fix is verified
  console.log(`[exercise-session] insets bottom=${insets.bottom} top=${insets.top} platform=${Platform.OS}`);
  const [showSummary, setShowSummary] = useState(false);

  // set & side management
  const isUnilateral = exerciseRule?.unilateral ?? false;
  const setsPerSide = exerciseRule?.totalSets ?? 3;
  const totalSets = isUnilateral ? setsPerSide * 2 : setsPerSide;
  const [currentSet, setCurrentSet] = useState(1);
  const [setComplete, setSetComplete] = useState(false);
  const currentSide = isUnilateral
    ? currentSet <= setsPerSide ? t("exercise-session.leftSide") : t("exercise-session.rightSide")
    : null;
  // exercise ID with -right suffix for right-side sets
  const trackingExerciseId = isUnilateral && currentSide === "Right"
    ? `${exerciseId}-right`
    : exerciseId;
  // next set's side (for display in between-set screen)
  const nextSide = isUnilateral
    ? (currentSet + 1) <= setsPerSide ? t("exercise-session.leftSide") : t("exercise-session.rightSide")
    : null;

  // the exercise rule the user is *about* to perform — used to source the
  // cameraPrompt shown in the placeholder. While the between-set screen is
  // up (setComplete === true), we look ahead one set so the prompt switches
  // to the right-side variant before sets 4-6 begin.
  const upcomingTrackingId = useMemo(() => {
    if (!isUnilateral) return exerciseId;
    const targetSet = setComplete ? currentSet + 1 : currentSet;
    return targetSet > setsPerSide ? `${exerciseId}-right` : exerciseId;
  }, [setComplete, currentSet, isUnilateral, setsPerSide, exerciseId]);
  const upcomingRule = useMemo(
    () => getExerciseRules(upcomingTrackingId),
    [upcomingTrackingId]
  );

  // timer state
  const timerDuration = exerciseRule?.timerSeconds ?? null;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setSecondsLeft(null);
  }, []);

  // session stats — use refs so we don't re-render on every frame.
  // violationCountRef holds per-set FeedbackEvent entries with timestamps
  // measured relative to the activity start (not the set start) so they
  // can merge cleanly into activityViolationsRef across sets.
  const scoresRef = useRef<number[]>([]);
  const violationCountRef = useRef<Record<string, FeedbackEvent>>({});
  const repCountRef = useRef(0);
  const sessionStartedAtRef = useRef<number | null>(null);
  // trigger re-render for summary only
  const [summaryTick, setSummaryTick] = useState(0);

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const handleCameraLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  }, []);

  // accumulate scores and violations while tracking.
  // each frame increments the violation's count and bumps lastAt; the first
  // frame sets firstAt. timestamps are activity-relative ms (not set-relative)
  // so cross-set merges in handleSetComplete don't need re-baselining.
  useEffect(() => {
    if (!isTracking || !currentFeedback) return;

    scoresRef.current.push(currentFeedback.score);

    const offsetMs = activityStartedAtRef.current
      ? Date.now() - activityStartedAtRef.current
      : 0;

    for (const v of currentFeedback.violations) {
      const key = v.message;
      const existing = violationCountRef.current[key];
      if (existing) {
        existing.count += 1;
        existing.lastAt = offsetMs;
      } else {
        violationCountRef.current[key] = {
          message: v.message,
          severity: v.severity,
          count: 1,
          firstAt: offsetMs,
          lastAt: offsetMs,
        };
      }
    }
  }, [isTracking, currentFeedback]);

  // frame processor — runs inference on worklet, posts pose AND hands back to js.
  // handlePoseResult routes pose to form analysis / rep counter (in tracking mode)
  // and hands to the open-palm gesture detector (in waiting_for_gesture mode).
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

  const handleStartMonitoring = async () => {
    // request camera permission on first tap
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) return;
    }

    // model loads automatically via useTensorflowModel hook
    if (!modelReady) return;

    // reset per-set stats AND activity-scoped accumulators — this is set 1
    // of a new activity, so we start fresh on both granularities. activity
    // start anchor is set here so per-frame violation timestamps are relative
    // to the very beginning of the multi-set activity.
    scoresRef.current = [];
    violationCountRef.current = {};
    repCountRef.current = 0;
    resetActivityAccumulators();
    activityStartedAtRef.current = Date.now();
    setShowSummary(false);

    // start the gesture flow instead of jumping straight to tracking. the
    // trackingMode watcher effect below will start the per-set timer / set
    // sessionStartedAtRef once the countdown completes and trackingMode flips
    // to 'tracking'.
    startGestureWatch(trackingExerciseId);
  };

  const handleSetComplete = useCallback(() => {
    const nowMs = Date.now();
    const startedAt = sessionStartedAtRef.current ?? nowMs;
    const setDurationSec = Math.max(1, Math.round((nowMs - startedAt) / 1000));
    const setFramesCount = scoresRef.current.length;
    const setReps = repCountRef.current;

    // grab the rep counter's per-rep angle history BEFORE stopTracking()
    // resets and discards it. for bilateral-averaged exercises (knee bends),
    // this is one entry per rep with the averaged angle; flag it so the
    // analysis layer knows the angles aren't a single side.
    const setRepHistory = getRepHistory();
    const repConfigHasSecondary =
      !!exerciseRule?.repConfig?.secondaryKeypoints;
    const setSide: "left" | "right" | "both" = isUnilateral
      ? currentSide === "Right"
        ? "right"
        : "left"
      : repConfigHasSecondary
        ? "both"
        : "left";

    // accumulate this set's data into the activity-scoped refs. these are NOT
    // reset between sets — we only persist the activity record once all sets
    // are done, so we need the union of every set's data here. setIndex is
    // pulled from the current length so it always matches the slot this set
    // will occupy in repsPerSet.
    const setIndex = activityRepsPerSetRef.current.length;
    activityRepsPerSetRef.current.push(setReps);
    activitySetDurationsRef.current.push(setDurationSec);
    activityScoresRef.current.push(...scoresRef.current);
    // merge per-set FeedbackEvent map into the activity-level map: same-keyed
    // events sum their counts and take the min firstAt / max lastAt across
    // sets so the merged record reflects the full lifetime of the violation.
    for (const [k, perSet] of Object.entries(violationCountRef.current)) {
      const existing = activityViolationsRef.current[k];
      if (existing) {
        existing.count += perSet.count;
        existing.firstAt = Math.min(existing.firstAt, perSet.firstAt);
        existing.lastAt = Math.max(existing.lastAt, perSet.lastAt);
      } else {
        activityViolationsRef.current[k] = { ...perSet };
      }
    }
    activitySetAngleSummariesRef.current.push({
      setIndex,
      side: setSide,
      reps: setRepHistory,
      ...(repConfigHasSecondary ? { bilateralAveraged: true } : {}),
    });

    sessionStartedAtRef.current = null;
    repCountRef.current = 0;
    clearTimer();
    setSummaryTick((t) => t + 1);

    // if there are more sets to go, leave the camera/pose pipeline running
    // and queue the gesture flow for the next set; the trackingMode watcher
    // effect handles the per-set state advancement once the countdown ends.
    // if this was the last set, fall through to the submit + navigate path.
    const isFinalSet = currentSet >= totalSets;

    if (isFinalSet) {
      stopTracking();
    }

    if (isFinalSet) {
      // all sets done — build the activity record and submit it (locally + backend),
      // then navigate back to the exercise tab. partial activities are NEVER
      // persisted; if the user bails out before this branch, no record is written.
      const totalReps = activityRepsPerSetRef.current.reduce((a, b) => a + b, 0);
      const totalDurationSec = activitySetDurationsRef.current.reduce(
        (a, b) => a + b,
        0
      );
      const totalFrames = activityScoresRef.current.length;
      const activityAvgScore =
        totalFrames > 0
          ? activityScoresRef.current.reduce((a, b) => a + b, 0) / totalFrames
          : null;

      resetActivityAccumulators();

      // only persist activities where at least one rep was counted across the
      // whole session — guards against accidental empty completions. On
      // successful persist, route to the summary screen with the record id so
      // the user sees their form score + top feedback before going back.
      if (totalReps > 0) {
        submitCompletedActivity({
          exerciseId,
          exerciseName,
          category: activityCategory,
          setsCompleted: totalSets,
          setsTarget: totalSets,
          durationSec: totalDurationSec,
          totalReps,
          repsPerSet: [...activityRepsPerSetRef.current],
          unilateral: isUnilateral,
          angleSummaries: [...activitySetAngleSummariesRef.current],
          feedbackEvents: Object.values(activityViolationsRef.current).map(
            (e) => ({ ...e })
          ),
          avgScore: activityAvgScore,
          framesAnalyzed: totalFrames,
        })
          .then((record) => {
            router.replace({
              pathname: "/(tabs)/exercise-summary",
              params: { recordId: record.id },
            });
          })
          .catch((error) => {
            console.error(
              "[ExerciseSession] Failed to save activity record:",
              error
            );
            router.replace("/(tabs)/exercise");
          });
      } else {
        router.replace("/(tabs)/exercise");
      }
      return;
    } else {
      // more sets to go — show between-set summary card and queue the gesture
      // flow for the next set. the user raises arms again to start the next
      // set; we don't render a manual "Next Set" button anymore.
      setSetComplete(true);
      const nextSet = currentSet + 1;
      const nextTrackingId =
        isUnilateral && nextSet > setsPerSide
          ? `${exerciseId}-right`
          : exerciseId;
      startGestureWatch(nextTrackingId);
    }
  }, [
    currentSet,
    totalSets,
    clearTimer,
    stopTracking,
    startGestureWatch,
    exerciseId,
    exerciseName,
    activityCategory,
    isUnilateral,
    setsPerSide,
    currentSide,
    exerciseRule,
    getRepHistory,
    resetActivityAccumulators,
    router,
  ]);

  // gesture flow handoff: when trackingMode flips to 'tracking', either
  // (a) starting set 1 of a new activity — we just need to seed the per-set
  //     timer/timestamp; the activity-level accumulators were reset in
  //     handleStartMonitoring.
  // (b) advancing from a between-set state — we ALSO need to bump currentSet
  //     and clear setComplete. handleSetComplete already queued this set's
  //     gesture watch with the right tracking ID.
  // both cases run on the trackingMode === 'tracking' edge. setComplete tells
  // them apart.
  useEffect(() => {
    if (trackingMode !== "tracking") return;

    if (setComplete) {
      // case (b): coming from a between-set transition
      setCurrentSet((c) => c + 1);
      setSetComplete(false);
    }

    // case (a) and (b): seed per-set state
    scoresRef.current = [];
    violationCountRef.current = {};
    repCountRef.current = 0;
    sessionStartedAtRef.current = Date.now();
    setStartedAtRef.current = Date.now();

    if (timerDuration) {
      setSecondsLeft(timerDuration);
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev === null || prev <= 1) return 0;
          return prev - 1;
        });
      }, 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingMode]);

  // rep counted flash
  const [repFlash, setRepFlash] = useState(false);
  const prevRepCountRef = useRef<number | null>(null);

  // sync VisionContext repCount into ref for persistence
  useEffect(() => {
    if (typeof repCount === "number") {
      repCountRef.current = Math.max(repCountRef.current, repCount);

      // flash, speak, and tap when a new rep is counted
      if (prevRepCountRef.current !== null && repCount > prevRepCountRef.current) {
        setRepFlash(true);
        setTimeout(() => setRepFlash(false), 800);
        // cancel any in-flight speech so the user always hears the latest count
        stopSpeech();
        speak(String(repCount));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      prevRepCountRef.current = repCount;
    }
  }, [repCount]);

  // auto-stop when countdown reaches 0
  useEffect(() => {
    if (secondsLeft === 0 && isTracking) {
      handleSetComplete();
    }
  }, [secondsLeft, isTracking, handleSetComplete]);

  // auto-stop when target reps reached
  // guard against stale repCount firing immediately after starting a new set
  const setStartedAtRef = useRef<number>(0);
  useEffect(() => {
    if (visionTargetReps && repCount !== null && repCount >= visionTargetReps && isTracking) {
      // only auto-stop if we've been tracking for at least 2 seconds
      if (Date.now() - setStartedAtRef.current > 2000) {
        handleSetComplete();
      }
    }
  }, [repCount, visionTargetReps, isTracking, handleSetComplete]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      sessionStartedAtRef.current = null;
      repCountRef.current = 0;
      clearTimer();
      stopTracking();
    };
  }, [stopTracking, clearTimer]);

  // compute summary data — recalcs when summaryTick changes
  const avgScore = useMemo(() => {
    if (scoresRef.current.length === 0) return null;
    const sum = scoresRef.current.reduce((a, b) => a + b, 0);
    return Math.round(sum / scoresRef.current.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryTick]);

  const topViolations = useMemo(() => {
    const entries = Object.entries(violationCountRef.current);
    entries.sort((a, b) => b[1].count - a[1].count);
    return entries.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryTick]);

  const framesAnalyzed = useMemo(() => scoresRef.current.length, [summaryTick]);

  // score color helper
  const scoreColor = (s: number) => {
    if (s >= 80) return "#1E7A3A";
    if (s >= 60) return "#B8860B";
    return warmRed;
  };

  const currentScore = currentFeedback?.score ?? null;
  // camera + skeleton render in any non-idle state so the user can see the
  // pose feedback during gesture wait and the countdown, not just tracking.
  const cameraActive =
    trackingMode !== "idle" && hasPermission && !!device;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
        {/* header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => {
              sessionStartedAtRef.current = null;
              repCountRef.current = 0;
              clearTimer();
              stopTracking();
              router.replace("/(tabs)/exercise");
            }}
            style={styles.backBtn}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back" size={18} color="#3D2F27" />
              <Text style={styles.backText}>{t("exercise-session.back")}</Text>
          </TouchableOpacity>

          <View style={{ flex: 1 }} />
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
        </View>

        <Text style={styles.pageTitle}>{title} {t("exercise-session.session")}</Text>
        <Text style={styles.pageSub}>
          {exerciseName}
        </Text>

        {/* camera / preview area */}
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
              {isModelLoading ? (
                <>
                  <ActivityIndicator size="large" color={warmRed} />
                  <Text style={styles.cameraHint}>{t("exercise-session.loadingModel")}</Text>
                </>
              ) : modelError ? (
                <>
                  <Ionicons name="alert-circle-outline" size={34} color={warmRed} />
                  <Text style={[styles.cameraHint, { color: warmRed }]}>{t("exercise-session.modelFailed")}</Text>
                  <Text style={styles.cameraSmall}>
                    {modelError.message}
                  </Text>
                </>
              ) : !hasPermission ? (
                <>
                  <Ionicons name="camera-outline" size={34} color="#8C7A6C" />
                  <Text style={styles.cameraHint}>{t("exercise-session.cameraNeeded")}</Text>
                  <Text style={styles.cameraSmall}>{t("exercise-session.enableCamera")}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="camera-outline" size={40} color="#8C7A6C" />
                  <Text style={styles.cameraHint}>{t("exercise-session.readyToMonitor")}</Text>
                  <Text style={styles.cameraSmall}>
                    {upcomingRule?.cameraPrompt ?? t("exercise-session.placePhone")}
                  </Text>
                </>
              )}
            </View>
          )}

          {/* skeleton overlays — render in gesture/countdown/tracking modes */}
          {trackingMode !== "idle" && currentPose && containerSize.width > 0 && (
            <>
              <GuideOverlay
                pose={currentPose}
                exerciseId={exerciseId}
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

          {/* gesture-confirm + countdown overlay (sits on top of the skeleton).
              the component renders nothing in idle/tracking modes. */}
          <GestureCountdownOverlay
            trackingMode={trackingMode}
            countdownSecondsLeft={countdownSecondsLeft}
          />

          {/* score overlay when tracking */}
          {isTracking && currentScore !== null && (
            <View style={styles.scoreOverlay}>
              <Text style={[styles.scoreText, { color: scoreColor(currentScore) }]}>
                {currentScore}
              </Text>
              <Text style={styles.scoreLabel}>{t("exercise-session.formScore")}</Text>
            </View>
          )}

          {/* debug angle overlay — commented out for the first device walkthrough
              so the skeleton overlay is visible without text obscuring it.
              uncomment when you need to validate angle thresholds / phase
              transitions / keypoint confidence again.
          {isTracking && debugAngle !== null && (() => {
            const activeRule = getExerciseRules(trackingExerciseId);
            return (
              <View style={styles.debugOverlay}>
                <Text style={styles.debugText}>Angle: {debugAngle}°</Text>
                <Text style={styles.debugText}>Phase: {debugPhase}</Text>
                <Text style={styles.debugTextSmall}>
                  ID: {trackingExerciseId}
                </Text>
                <Text style={styles.debugTextSmall}>
                  KP: {activeRule?.repConfig?.keypoints?.join(' → ')}
                </Text>
                <Text style={styles.debugTextSmall}>
                  Start: {activeRule?.repConfig?.startMin}–{activeRule?.repConfig?.startMax}°
                </Text>
                <Text style={styles.debugTextSmall}>
                  End: {activeRule?.repConfig?.endMin}–{activeRule?.repConfig?.endMax}°
                </Text>
                {debugConfidences && (
                  <Text style={styles.debugTextSmall}>
                    {debugConfidences}
                  </Text>
                )}
                {debugPositions && (
                  <Text style={styles.debugTextSmall}>
                    {debugPositions}
                  </Text>
                )}
              </View>
            );
          })()}
          */}

          {/* timer overlay */}
          {isTracking && secondsLeft !== null && (
            <View style={styles.timerOverlay}>
              <Text style={[styles.timerText, secondsLeft <= 5 && styles.timerTextUrgent]}>
                {secondsLeft}
              </Text>
              <Text style={styles.timerLabel}>{t("exercise-session.secondsRemaining")}</Text>
            </View>
          )}

          {/* rep counter moved below camera */}

          {/* set indicator overlay */}
          {isTracking && totalSets > 1 && (
            <View style={styles.setOverlay}>
              <Text style={styles.setText}>{t("exercise-session.set", { current: currentSet, total: totalSets })}</Text>
              {currentSide && (
                <Text style={styles.sideText}>{currentSide}</Text>
              )}
            </View>
          )}

          {/* violation messages overlay */}
          {isTracking && currentFeedback && currentFeedback.violations.length > 0 && (
            <View style={styles.violationsOverlay}>
              {currentFeedback.violations.slice(0, 3).map((v, i) => (
                <View
                  key={`${v.bodyPart}-${i}`}
                  style={[
                    styles.violationBadge,
                    v.severity === "error" ? styles.violationError : styles.violationWarning,
                  ]}
                >
                  <Text style={styles.violationText}>{v.message}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* rep counter below camera */}
        {isTracking && visionTargetReps !== null && repCount !== null && (
          <View style={[styles.repCounterBar, repFlash && styles.repCounterFlash]}>
            <Text style={[styles.repCounterText, repCount >= visionTargetReps && { color: warmRed }]}>
              {t("exercise-session.repCount", { current: repCount, total: visionTargetReps })}
            </Text>
            {repFlash && (
              <Text style={styles.repCountedLabel}>Rep counted!</Text>
            )}
          </View>
        )}

        {/* error display */}
        {modelError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t("exercise-session.modelFailed")} {modelError.message}</Text>
          </View>
        )}
        {visionError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{visionError}</Text>
          </View>
        )}

        {/* between-set screen */}
        {setComplete && !isTracking && !showSummary && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {t("exercise-session.setComplete", { current: currentSet, total: totalSets })}
            </Text>
            {isUnilateral && currentSet === setsPerSide && (
              <View style={styles.switchSidesBox}>
                <Ionicons name="swap-horizontal" size={24} color={colors.accent} />
                <Text style={styles.switchSidesText}>
                  {t("exercise-session.switchSide")}
                </Text>
              </View>
            )}
            {nextSide && (
              <Text style={styles.sideLabel}>
                {t("exercise-session.next")} {nextSide}
              </Text>
            )}
          </View>
        )}

        {/* session summary */}
        {showSummary && !isTracking && (
          <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("exercise-session.sessionSummary")}</Text>
            {avgScore !== null ? (
              <>
                <View style={styles.feedbackRow}>
                  <Text style={styles.feedbackLabel}>{t("exercise-session.averageScore")}</Text>
                  <Text style={[styles.feedbackValue, { color: scoreColor(avgScore) }]}>
                    {avgScore} / 100
                  </Text>
                </View>
                <View style={styles.feedbackRow}>
                  <Text style={styles.feedbackLabel}>{t("exercise-session.framesAnalyzed")}</Text>
                  <Text style={styles.feedbackValue}>{framesAnalyzed}</Text>
                </View>
                {topViolations.length > 0 && (
                  <View style={styles.tipBox}>
                    <Text style={styles.tipTitle}>{t("exercise-session.topIssues")}</Text>
                    {topViolations.map(([msg, event]) => (
                      <Text key={msg} style={styles.tipText}>
                        {"\u2022"} {msg} ({event.count}x)
                      </Text>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.feedbackValue}>{t("exercise-session.noDataRecorded")}</Text>
            )}
          </View>
        )}

        {/* tips card when truly idle (no gesture flow running) */}
        {trackingMode === "idle" && !showSummary && !setComplete && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("exercise-session.tips")}</Text>
            <View style={styles.tipBox}>
              <Text style={styles.tipText}>
                {"\u2022"} {t("exercise-session.tip1")} {"\n"}
                {"\u2022"} {t("exercise-session.tip2")} {"\n"}
                {"\u2022"} {t("exercise-session.tip3")} {"\n"}
                {"\u2022"} {t("exercise-session.tip4")}
              </Text>
            </View>
          </View>
        )}

        {/* controls — Next Set button is gone; the gesture flow auto-advances
            between sets. during gesture/countdown the only escape is the back
            arrow at the top of the screen (which calls stopTracking). */}
        <View style={styles.controlsRow}>
          {trackingMode === "tracking" ? (
            <TouchableOpacity
              style={styles.stopBtn}
              activeOpacity={0.9}
              onPress={handleSetComplete}
            >
              <Ionicons name="square" size={16} color="#FFF" />
              <Text style={styles.primaryText}>{t("exercise-session.stopMonitoring")}</Text>
            </TouchableOpacity>
          ) : trackingMode === "waiting_for_gesture" ||
            trackingMode === "countdown" ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              activeOpacity={0.9}
              onPress={() => {
                stopTracking();
                resetActivityAccumulators();
                setSetComplete(false);
                setCurrentSet(1);
              }}
            >
              <Ionicons name="close" size={16} color="#5B4636" />
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <>
              {showSummary && (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  activeOpacity={0.9}
                  onPress={() => setShowSummary(false)}
                >
                  <Ionicons name="close" size={16} color="#5B4636" />
                  <Text style={styles.secondaryText}>{t("exercise-session.dismiss")}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.primaryBtn, isModelLoading && { opacity: 0.6 }]}
                activeOpacity={0.9}
                onPress={handleStartMonitoring}
                disabled={isModelLoading}
              >
                <Ionicons name="play" size={16} color="#FFF" />
                <Text style={styles.primaryText}>
                  {isModelLoading ? t("exercise-session.loading") : t("exercise-session.startMonitoring")}
                </Text>
              </TouchableOpacity>
            </>
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

  scoreOverlay: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
    }),
  },
  scoreText: { fontSize: 28, fontWeight: "900" },
  scoreLabel: { fontSize: 10, fontWeight: "800", color: "#6B5E55", marginTop: 2 },

  debugOverlay: {
    position: "absolute",
    top: 60,
    left: 12,
    right: 12,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
  },
  debugText: { fontSize: 32, fontWeight: "900", color: "#0F0" },
  debugTextSmall: { fontSize: 22, fontWeight: "700", color: "#AAA", marginTop: 6 },

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
      ios: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
    }),
  },
  timerText: { fontSize: 28, fontWeight: "900", color: colors.text },
  timerTextUrgent: { color: warmRed },
  timerLabel: { fontSize: 10, fontWeight: "800", color: colors.muted, marginTop: 2 },

  setOverlay: {
    position: "absolute",
    bottom: 12,
    right: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: "center",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
    }),
  },
  setText: { fontSize: 14, fontWeight: "900", color: colors.text },
  sideText: { fontSize: 11, fontWeight: "800", color: colors.accent, marginTop: 2 },

  switchSidesBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#E8F0FE",
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  switchSidesText: { fontSize: 16, fontWeight: "900", color: colors.accent },
  sideLabel: { fontSize: 13, fontWeight: "700", color: "#6B5E55", marginTop: 8 },

  repCounterBar: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 10,
    alignItems: "center",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 1.5 },
    }),
  },
  repCounterText: { fontSize: 50, fontWeight: "900", color: "#222" },
  repCounterFlash: {
    backgroundColor: "#E8F5E9",
    borderColor: "#1E7A3A",
    borderWidth: 2,
  },
  repCountedLabel: { fontSize: 14, fontWeight: "900", color: "#1E7A3A", marginTop: 2 },

  violationsOverlay: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    gap: 4,
  },
  violationBadge: {
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  violationError: { backgroundColor: "rgba(216,69,53,0.88)" },
  violationWarning: { backgroundColor: "rgba(184,134,11,0.82)" },
  violationText: { color: "#FFF", fontWeight: "800", fontSize: 12 },

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
  cardTitle: { fontWeight: "900", color: colors.text, marginBottom: 4 },

  feedbackRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  feedbackLabel: { width: 140, fontWeight: "900", color: "#3D2F27" },
  feedbackValue: { fontWeight: "900", color: "#1E7A3A" },

  tipBox: {
    marginTop: 10,
    backgroundColor: beigeStrip,
    borderRadius: 12,
    padding: 12,
  },
  tipTitle: { fontWeight: "900", color: "#3D2F27", marginBottom: 6 },
  tipText: { color: "#5B4636", fontWeight: "700", lineHeight: 20 },

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
