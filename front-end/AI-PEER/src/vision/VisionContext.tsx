//
// VisionContext.tsx — react context for vision state management
//
// model loading is handled by useTensorflowModel hook in the component
// context provides react state for tracking, form analysis, and re-renders
//

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { VisionState, Pose, FormFeedback, FormViolation } from './types';
import { analyzePose } from './FormAnalyzer';
import { RepCounter, RepHistoryEntry } from './RepCounter';
import { getExerciseRules } from './exercises';
import { ExerciseRule } from './exercises/types';
import { Hand } from './VisionService';

/** Tracking lifecycle state machine.
 *  - 'idle': nothing running
 *  - 'waiting_for_gesture': camera + pose pipeline up; gesture detector
 *    watching for "both wrists above both shoulders by ≥15% torso for ≥500ms"
 *  - 'countdown': gesture confirmed; 5-second TTS countdown is running; rep
 *    counter and form analysis are NOT yet active
 *  - 'tracking': rep counter + form analysis active; this is the legacy
 *    "isTracking" state */
export type TrackingMode = 'idle' | 'waiting_for_gesture' | 'countdown' | 'tracking';

type VisionContextValue = {
  state: VisionState;
  trackingMode: TrackingMode;
  countdownSecondsLeft: number | null;
  repCount: number | null;
  targetReps: number | null;
  debugAngle: number | null;
  debugPhase: string | null;
  debugConfidences: string | null;
  debugPositions: string | null;
  setModelReady: (ready: boolean) => void;
  /** Begin pose tracking immediately. Bypasses the gesture flow — use
   *  startGestureWatch instead for the standard arms-overhead confirmation. */
  startTracking: (exerciseId: string) => void;
  /** Run camera + pose pipeline in 'waiting_for_gesture' mode. Once the user
   *  holds both arms overhead for 500ms, the context internally transitions to
   *  'countdown' (5s) and then to 'tracking', at which point startTracking's
   *  effects (rep counter init, form analysis) take over. */
  startGestureWatch: (exerciseId: string) => void;
  stopTracking: () => void;
  // accepts an already-parsed pose AND hand list from the frame processor.
  // hands is empty when no hands are detected this frame; pose is null only
  // on detection failure.
  handlePoseResult: (pose: Pose | null, hands: Hand[]) => void;
  // returns a snapshot of the current rep counter's per-rep history. callers
  // must invoke this BEFORE stopTracking() since stopTracking resets the
  // counter and discards the history. exposed as a getter (not a state field)
  // to avoid re-rendering every consumer on each rep increment.
  getRepHistory: () => RepHistoryEntry[];
};

const VisionContext = createContext<VisionContextValue | null>(null);

const initialState: VisionState = {
  isModelDownloaded: true,
  isModelLoaded: false,
  isTracking: false,
  downloadProgress: 100,
  error: null,
  currentPose: null,
  currentFeedback: null,
};

// throttle state updates to ~5hz so we don't spam re-renders
const STATE_UPDATE_INTERVAL = 100;

// a form-check violation must be continuously failing for at least this many
// ms before we surface it. catches single-frame keypoint glitches without
// hiding sustained out-of-form positions.
const VIOLATION_SMOOTHING_MS = 300;

// gesture must be sustained for at least this many ms before we count it as
// confirmed. prevents stray frames from prematurely triggering the countdown.
// bumped from 500 to 1000 after device testing — 500 was too quick to reject
// transient hand sightings.
const DEFAULT_GESTURE_HOLD_MS = 1000;

// length of the spoken countdown that runs after a gesture is confirmed.
const COUNTDOWN_SECONDS = 5;

export function VisionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VisionState>(initialState);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('idle');
  const [countdownSecondsLeft, setCountdownSecondsLeft] = useState<number | null>(null);
  const [repCount, setRepCount] = useState<number | null>(null);
  const [targetReps, setTargetReps] = useState<number | null>(null);
  const [debugAngle, setDebugAngle] = useState<number | null>(null);
  const [debugPhase, setDebugPhase] = useState<string | null>(null);
  const [debugConfidences, setDebugConfidences] = useState<string | null>(null);
  const [debugPositions, setDebugPositions] = useState<string | null>(null);

  // refs for stable callback identity
  const isTrackingRef = useRef(false);
  const exerciseIdRef = useRef<string | null>(null);
  const lastStateUpdateRef = useRef(0);
  const pendingPoseRef = useRef<Pose | null>(null);
  const pendingFeedbackRef = useRef<FormFeedback | null>(null);
  const repCounterRef = useRef<RepCounter | null>(null);
  const activeRulesRef = useRef<ExerciseRule | null>(null);
  // per-violation start timestamps used by the 300ms smoother. cleared on
  // start/stop tracking. keyed by violation message — bilateral exercises with
  // duplicate messages (e.g. knee bends "Bend your knees more" on left + right)
  // collapse to one entry, which matches how feedbackEvents key by message too.
  const violationStartTimesRef = useRef<Map<string, number>>(new Map());
  // mirror of trackingMode for use inside handlePoseResult (which has stable
  // identity and can't read state directly without re-creation).
  const trackingModeRef = useRef<TrackingMode>('idle');
  // exerciseId queued during the gesture/countdown phases — startTracking
  // gets called with this once the countdown completes.
  const pendingExerciseIdRef = useRef<string | null>(null);
  // first frame in which the arms-overhead gesture was detected continuously.
  // null = not currently in a gesture detection. used by the 500ms hold check.
  const gestureFirstSeenAtRef = useRef<number | null>(null);
  // pending setTimeouts from the countdown ladder; cleared on stopTracking
  // and on startGestureWatch so a new flow doesn't fire stale ticks.
  const countdownTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // keep the ref in sync with state for use in stable callbacks
  useEffect(() => {
    trackingModeRef.current = trackingMode;
  }, [trackingMode]);

  const setModelReady = useCallback((ready: boolean) => {
    setState((s) => ({ ...s, isModelLoaded: ready }));
  }, []);

  // shared internal: actually flip into 'tracking' mode and init the rep
  // counter. called from both the public startTracking (immediate) path and
  // from the countdown ladder once the spoken countdown finishes.
  const enterTrackingMode = useCallback((exerciseId: string) => {
    exerciseIdRef.current = exerciseId;
    isTrackingRef.current = true;
    violationStartTimesRef.current.clear();

    const rules = getExerciseRules(exerciseId);
    activeRulesRef.current = rules ?? null;

    if (rules?.repConfig) {
      repCounterRef.current = new RepCounter(rules.repConfig);
      setRepCount(0);
      setTargetReps(rules.repConfig.targetReps);
    } else {
      repCounterRef.current = null;
      setRepCount(null);
      setTargetReps(null);
    }

    setTrackingMode('tracking');
    setCountdownSecondsLeft(null);
    setState((s) => ({
      ...s,
      isTracking: true,
      currentPose: null,
      currentFeedback: null,
      error: null,
    }));
  }, []);

  const startTracking = useCallback(
    (exerciseId: string) => {
      // public bypass path — clears any pending gesture/countdown state and
      // jumps straight into tracking. screens that want the gesture flow
      // should call startGestureWatch instead.
      pendingExerciseIdRef.current = null;
      gestureFirstSeenAtRef.current = null;
      for (const t of countdownTimeoutsRef.current) clearTimeout(t);
      countdownTimeoutsRef.current = [];
      enterTrackingMode(exerciseId);
    },
    [enterTrackingMode]
  );

  const getRepHistory = useCallback((): RepHistoryEntry[] => {
    return repCounterRef.current?.getRepHistory() ?? [];
  }, []);

  const stopTracking = useCallback(() => {
    exerciseIdRef.current = null;
    isTrackingRef.current = false;
    pendingExerciseIdRef.current = null;
    gestureFirstSeenAtRef.current = null;
    for (const t of countdownTimeoutsRef.current) clearTimeout(t);
    countdownTimeoutsRef.current = [];
    repCounterRef.current?.reset();
    repCounterRef.current = null;
    violationStartTimesRef.current.clear();
    setTrackingMode('idle');
    setCountdownSecondsLeft(null);
    setRepCount(null);
    setTargetReps(null);
    setState((s) => ({
      ...s,
      isTracking: false,
      currentPose: null,
      currentFeedback: null,
    }));
  }, []);

  // schedules the 5→4→3→2→1→tracking ladder. each tick updates
  // countdownSecondsLeft so a UI overlay can render the current count and
  // the screen's TTS effect can speak it. on the final tick, we transition
  // into tracking mode (initializing the rep counter) and clear the ladder.
  const beginCountdown = useCallback(() => {
    for (const t of countdownTimeoutsRef.current) clearTimeout(t);
    countdownTimeoutsRef.current = [];
    setTrackingMode('countdown');
    setCountdownSecondsLeft(COUNTDOWN_SECONDS);

    for (let i = 1; i <= COUNTDOWN_SECONDS; i++) {
      const t = setTimeout(() => {
        const remaining = COUNTDOWN_SECONDS - i;
        if (remaining > 0) {
          setCountdownSecondsLeft(remaining);
        } else {
          // countdown done — flip into tracking
          const exerciseId = pendingExerciseIdRef.current;
          pendingExerciseIdRef.current = null;
          if (exerciseId) {
            enterTrackingMode(exerciseId);
          } else {
            // no queued exerciseId means the gesture flow was cancelled mid-
            // countdown — bail out cleanly back to idle
            setTrackingMode('idle');
            setCountdownSecondsLeft(null);
          }
        }
      }, i * 1000);
      countdownTimeoutsRef.current.push(t);
    }
  }, [enterTrackingMode]);

  const startGestureWatch = useCallback((exerciseId: string) => {
    // start the camera/pose pipeline in the gesture-detection state. the rep
    // counter and form analysis stay dormant until enterTrackingMode runs at
    // the end of the countdown.
    pendingExerciseIdRef.current = exerciseId;
    gestureFirstSeenAtRef.current = null;
    for (const t of countdownTimeoutsRef.current) clearTimeout(t);
    countdownTimeoutsRef.current = [];
    isTrackingRef.current = false;
    repCounterRef.current?.reset();
    repCounterRef.current = null;
    violationStartTimesRef.current.clear();
    setRepCount(null);
    setTargetReps(null);
    setCountdownSecondsLeft(null);
    setTrackingMode('waiting_for_gesture');
    setState((s) => ({
      ...s,
      isTracking: false,
      currentPose: null,
      currentFeedback: null,
      error: null,
    }));
  }, []);

  // handlePoseResult — takes a parsed pose AND hand list from the frame processor.
  // - 'idle': bail out
  // - 'waiting_for_gesture': run the open-palm detector against the detected
  //   hands. don't analyze form, don't update the rep counter. update
  //   currentPose so the screen can still render the skeleton overlay (gives
  //   the user feedback that the camera sees them).
  // - 'countdown': pose-only update for the skeleton; everything else dormant.
  // - 'tracking': existing path — analyze, smooth, update rep counter. hands
  //   are ignored in tracking mode.
  const handlePoseResult = useCallback(
    (pose: Pose | null, hands: Hand[]) => {
      const mode = trackingModeRef.current;
      if (mode === 'idle') return;

      let feedback: FormFeedback | null = null;

      if (mode === 'waiting_for_gesture') {
        // sustained-detection: only fire when at least one detected hand has
        // been showing an open palm for ≥ the active holdMs threshold. resets if any
        // frame fails (no hands, or no hand currently open).
        if (detectStartGesture(hands)) {
          if (gestureFirstSeenAtRef.current === null) {
            gestureFirstSeenAtRef.current = Date.now();
          } else if (Date.now() - gestureFirstSeenAtRef.current >= activePalmThresholds.holdMs) {
            gestureFirstSeenAtRef.current = null;
            beginCountdown();
          }
        } else {
          gestureFirstSeenAtRef.current = null;
        }
      }

      if (mode === 'tracking' && pose && exerciseIdRef.current) {
        const raw = analyzePose(pose, exerciseIdRef.current, activeRulesRef.current ?? undefined);
        // apply 300ms smoothing: drop violations that haven't been continuously
        // failing for long enough yet, and clear timers for rules that have
        // recovered. recompute the binary score from the smoothed list so a
        // single-frame glitch doesn't tank the per-frame form score.
        const smoothed = smoothViolations(raw.violations, violationStartTimesRef.current, Date.now());
        feedback = {
          violations: smoothed,
          score: smoothed.length === 0 ? 100 : 0,
          isGoodForm: smoothed.length === 0,
        };

        // update rep counter
        if (repCounterRef.current) {
          const count = repCounterRef.current.update(pose);
          setRepCount(count);
          setDebugAngle(repCounterRef.current.lastAngle);
          setDebugPhase(repCounterRef.current.currentPhase);
          setDebugConfidences(repCounterRef.current.debugConfidences);
          setDebugPositions(repCounterRef.current.debugPositions);
        }
      }

      pendingPoseRef.current = pose;
      pendingFeedbackRef.current = feedback;

      const now = Date.now();
      if (now - lastStateUpdateRef.current >= STATE_UPDATE_INTERVAL) {
        lastStateUpdateRef.current = now;
        setState((s) => ({
          ...s,
          currentPose: pendingPoseRef.current,
          currentFeedback: pendingFeedbackRef.current,
        }));
      }
    },
    [beginCountdown]
  );

  // stop tracking when app goes to background
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState !== 'active' && isTrackingRef.current) {
        if (__DEV__) console.log('app backgrounded, stopping tracking');
        stopTracking();
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [stopTracking]);

  return (
    <VisionContext.Provider
      value={{
        state,
        trackingMode,
        countdownSecondsLeft,
        repCount,
        targetReps,
        debugAngle,
        debugPhase,
        debugConfidences,
        debugPositions,
        setModelReady,
        startTracking,
        startGestureWatch,
        stopTracking,
        handlePoseResult,
        getRepHistory,
      }}
    >
      {children}
    </VisionContext.Provider>
  );
}

export function useVisionContext(): VisionContextValue {
  const context = useContext(VisionContext);
  if (!context) {
    throw new Error('useVisionContext must be used within VisionProvider');
  }
  return context;
}

// MediaPipe Hand landmark indices for the four non-thumb fingers. each finger
// has four landmarks: MCP (knuckle base), PIP (mid), DIP (upper), TIP (end).
// thumb (1-4) is handled separately by the thumb-extended check below — its
// curl behavior doesn't fit the four-segment extension-ratio pattern.
const FINGER_INDICES: ReadonlyArray<readonly [number, number, number, number]> = [
  [5, 6, 7, 8],     // index
  [9, 10, 11, 12],  // middle
  [13, 14, 15, 16], // ring
  [17, 18, 19, 20], // pinky
];

// Palm-open classifier thresholds.
//
// These defaults are calibrated for an ~6ft training distance (exercise-
// session, chair-rise, balance — where the framing is relatively close).
// Screens that need looser thresholds at greater distance — TUG test in
// particular runs at ~10ft — can call setPalmThresholds({...}) on mount and
// resetPalmThresholds() on unmount. The module-level `activePalmThresholds`
// is read on every frame inside detectOpenPalm.
//
// fingerExtension: minimum 3D extension ratio (straight-line MCP→TIP distance
// / sum of segment lengths MCP→PIP→DIP→TIP). 1.0 = perfectly straight,
// ~0.5 = fist. 0.92 is strict.
//
// minExtendedFingers: how many of the four non-thumb fingers must be extended.
// 4 eliminates the "fist with one finger sticking out" false positive.
//
// thumbReachRatio: minimum thumb-tip-to-wrist distance as a fraction of hand
// size (wrist → middle-finger MCP). Tucked thumb sits close to the wrist;
// extended thumb reaches past the middle MCP.
//
// holdMs: how long the open palm must be sustained before the countdown fires.
// Screens can lower this when distance makes consistent passes rarer.
export type PalmThresholds = {
  fingerExtension: number;
  minExtendedFingers: number;
  thumbReachRatio: number;
  holdMs: number;
};

const DEFAULT_PALM_THRESHOLDS: PalmThresholds = {
  fingerExtension: 0.92,
  minExtendedFingers: 4,
  thumbReachRatio: 1.2,
  holdMs: DEFAULT_GESTURE_HOLD_MS,
};

let activePalmThresholds: PalmThresholds = { ...DEFAULT_PALM_THRESHOLDS };

export function setPalmThresholds(overrides: Partial<PalmThresholds>): void {
  activePalmThresholds = { ...DEFAULT_PALM_THRESHOLDS, ...overrides };
}

export function resetPalmThresholds(): void {
  activePalmThresholds = { ...DEFAULT_PALM_THRESHOLDS };
}

// Empirically determined sign for the palm-normal cross product on a Right
// hand with palm facing the camera in our portrait coordinate system.
// The cross product of (wrist→index_MCP) × (wrist→pinky_MCP) z-component
// flips between Left and Right hands (the two are mirror images), so we
// scale by handedness in detectOpenPalm. Calibrated on iOS with a palm-
// forward right hand.
//
// Cross-platform note: mapMediaPipeToHands applies a transpose-only
// transform on iOS (linear part det = -1, orientation-reversing) but a
// transpose + Y-flip on Android (det = +1, orientation-preserving). The
// 2D cross product picks up opposite signs on the two platforms for the
// same anatomical hand, so detectOpenPalm negates expectedSign on Android.
// An earlier version of this file claimed two errors cancel on Android
// (Y-flip + a supposedly-wrong MediaPipe handedness label); device testing
// on a Pixel 7 in 2026-04 disproved that — Android handedness is reported
// correctly, so only the transform-sign flip applies and must be
// compensated inside detectOpenPalm.
const RIGHT_PALM_NORMAL_SIGN = 1;

function dist3D(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// open-palm detector v3. five checks must all pass:
//
//   (1) all four non-thumb fingers extended in 3D (catches side-view fists
//       that a 2D check would miss: a curled finger has its tip near the
//       wrist in 3D regardless of camera angle).
//   (2) all four fingertips above the wrist in image y (rejects upside-down
//       hands, sideways fingers, and incidental hand movements where the
//       user isn't deliberately holding the hand up to show the camera).
//   (3) thumb extended away from the wrist (rejects fist-with-fingers-out
//       and any hand pose where the thumb is tucked).
//   (4) palm normal points toward the camera. cross product of
//       (wrist→index_MCP) and (wrist→pinky_MCP) gives the palm normal
//       vector; its z-component sign tells us palm vs back. the sign also
//       depends on which physical hand it is (the cross product orientation
//       flips between left and right), so we use MediaPipe's handedness
//       label to disambiguate.
//
// v2 (the previous version) skipped check (4) because handedness wasn't
// extracted from the native plugin yet. v2 false-positived on a back-of-
// hand-facing-camera with extended fingers. v3 fixes that.
function detectOpenPalm(hand: Hand): boolean {
  if (!hand.landmarks || hand.landmarks.length < 21) return false;
  const lm = hand.landmarks;
  const wrist = lm[0];

  // (1) all four non-thumb fingers extended in 3D
  let extendedCount = 0;
  for (const [mcp, pip, dip, tip] of FINGER_INDICES) {
    const direct = dist3D(lm[mcp], lm[tip]);
    const path =
      dist3D(lm[mcp], lm[pip]) +
      dist3D(lm[pip], lm[dip]) +
      dist3D(lm[dip], lm[tip]);
    if (path === 0 || direct / path < activePalmThresholds.fingerExtension) return false;
    extendedCount++;
  }
  if (extendedCount < activePalmThresholds.minExtendedFingers) return false;

  // (2) fingertips above the wrist (smaller y = higher on screen in
  // normalized image coords). natural "showing my palm" pose only.
  for (const [, , , tip] of FINGER_INDICES) {
    if (lm[tip].y >= wrist.y) return false;
  }

  // (3) thumb extended away from the wrist. uses the wrist→middle-finger-MCP
  // distance as a hand-size scale reference, then checks that the thumb tip
  // reaches beyond THUMB_REACH_RATIO * handSize.
  const handSize = dist3D(wrist, lm[9]); // wrist → middle finger MCP
  if (handSize === 0) return false;
  const thumbReach = dist3D(wrist, lm[4]); // wrist → thumb tip
  if (thumbReach < handSize * activePalmThresholds.thumbReachRatio) return false;

  // (4) palm normal points toward the camera (palm-vs-back disambiguation).
  // skipped if handedness isn't available (e.g., the native plugin hasn't
  // been rebuilt with handedness extraction yet, or MediaPipe didn't classify
  // this hand confidently). in that case the earlier checks still apply.
  if (hand.handedness) {
    const v1x = lm[5].x - wrist.x;
    const v1y = lm[5].y - wrist.y;
    const v2x = lm[17].x - wrist.x;
    const v2y = lm[17].y - wrist.y;
    // cross product z component (we don't need the full 3D normal — only
    // the sign of the z component matters for palm-toward-camera).
    const normalZ = v1x * v2y - v1y * v2x;
    let expectedSign =
      hand.handedness === "Right" ? RIGHT_PALM_NORMAL_SIGN : -RIGHT_PALM_NORMAL_SIGN;
    // Android's mapMediaPipeToHands Y-flip inverts the 2D cross product sign
    // relative to iOS (see RIGHT_PALM_NORMAL_SIGN comment above for the full
    // coordinate-orientation explanation).
    if (Platform.OS === 'android') expectedSign = -expectedSign;
    if (normalZ * expectedSign <= 0) return false;
  }

  return true;
}

// returns true if ANY detected hand shows an open palm. either left or right
// hand counts — gesture detection is hand-agnostic.
function detectStartGesture(hands: Hand[]): boolean {
  for (const hand of hands) {
    if (detectOpenPalm(hand)) return true;
  }
  return false;
}

// dedupes by message and applies the 300ms persistence window. mutates
// startTimes in place: prunes keys whose rule passed this frame, adds new
// entries for newly-failing rules, and only emits violations whose start
// time is at least VIOLATION_SMOOTHING_MS in the past.
function smoothViolations(
  raw: FormViolation[],
  startTimes: Map<string, number>,
  now: number,
): FormViolation[] {
  const currentKeys = new Set(raw.map((v) => v.message));

  // sweep: rules that passed this frame have their timer cleared
  for (const key of Array.from(startTimes.keys())) {
    if (!currentKeys.has(key)) startTimes.delete(key);
  }

  const out: FormViolation[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (seen.has(v.message)) continue;
    seen.add(v.message);

    let firstAt = startTimes.get(v.message);
    if (firstAt === undefined) {
      startTimes.set(v.message, now);
      firstAt = now;
    }
    if (now - firstAt >= VIOLATION_SMOOTHING_MS) {
      out.push(v);
    }
  }
  return out;
}
