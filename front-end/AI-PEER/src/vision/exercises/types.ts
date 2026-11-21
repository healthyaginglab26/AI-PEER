/**
 * types.ts - Type definitions for exercise rules
 *
 * These types define how exercise form checks are structured.
 */

/** A check that verifies an angle between 3 body points */
export type AngleCheck = {
  type: 'angle';
  /** Three keypoint names that form the angle (vertex is middle point) */
  keypoints: [string, string, string];
  /** Minimum acceptable angle in degrees */
  min: number;
  /** Maximum acceptable angle in degrees */
  max: number;
  /** Feedback message when angle is out of range */
  message: string;
  /** Severity of violation. Used as the default; when severityThresholds is
   *  set, the analyzer overrides this with mild/moderate/severe based on how
   *  far the measured angle is outside [min, max]. */
  severity: 'warning' | 'error';
  /** Optional graded severity. Both values are degrees outside [min, max].
   *  outsideBy < moderate → 'mild', < severe → 'moderate', else → 'severe'.
   *  Leave unset to keep using the default severity field. */
  severityThresholds?: {
    moderate: number;
    severe: number;
  };
  /** When true, the form analyzer skips this check if the current angle is
   *  inside the exercise's rep start zone OR end zone. Use this for "you're
   *  not at peak X" warnings on rep-counted exercises so they only fire in
   *  the dead zone between start and end positions, not while the user is
   *  correctly resting in either zone. Requires the rule to have a repConfig. */
  gateOnRepZones?: boolean;
};

/** A check that verifies two body parts are aligned (vertical or horizontal) */
export type AlignmentCheck = {
  type: 'alignment';
  /** Two keypoint names to check alignment between */
  keypoints: [string, string];
  /** 'vertical' = stacked top-to-bottom, 'horizontal' = side-by-side level */
  direction: 'vertical' | 'horizontal';
  /** Degrees off-axis allowed before violation */
  tolerance: number;
  /** Feedback message when misaligned */
  message: string;
  /** Severity of violation. Default; overridden when severityThresholds set. */
  severity: 'warning' | 'error';
  /** Optional graded severity. Both values are degrees over tolerance.
   *  overBy < moderate → 'mild', < severe → 'moderate', else → 'severe'. */
  severityThresholds?: {
    moderate: number;
    severe: number;
  };
};

/** A check that verifies a keypoint is above/below another */
export type PositionCheck = {
  type: 'position';
  /** The keypoint to check */
  keypoint: string;
  /** Reference keypoint to compare against */
  reference: string;
  /** Required relationship */
  relation: 'above' | 'below' | 'left_of' | 'right_of';
  /** Feedback message when position is wrong */
  message: string;
  /** Severity of violation */
  severity: 'warning' | 'error';
};

/** A check that verifies distance/spread between two points */
export type DistanceCheck = {
  type: 'distance';
  /** Two keypoint names to measure distance between */
  keypoints: [string, string];
  /** Reference keypoints for relative distance (e.g., shoulder width) */
  referenceKeypoints: [string, string];
  /** Minimum ratio of distance to reference */
  minRatio: number;
  /** Maximum ratio of distance to reference */
  maxRatio: number;
  /** Feedback message when distance is wrong */
  message: string;
  /** Severity of violation */
  severity: 'warning' | 'error';
};

/** Union of all check types */
export type FormCheck = AngleCheck | AlignmentCheck | PositionCheck | DistanceCheck;

/** Second configuration for bilateral rep-counted exercises */
export type SecondaryRepConfig = {
  /** Measurement mode: 'angle' (default), 'distance', or 'angle3d' (uses z-coordinate) */
  mode?: 'angle' | 'distance' | 'angle3d';
  /** For angle mode: [p1, vertex, p3] — angle measured at vertex */
  /** For distance mode: [movingKp, anchorKp, referenceKp1] — tracks horizontal distance between movingKp and anchorKp, normalized by referenceKp1-to-anchorKp vertical height */
  keypoints: [string, string, string];
  /** Optional second triplet for bilateral exercises (e.g. squats). When set,
   *  the rep counter computes the angle on both sides and uses their average
   *  as the gating value. Both sides must have confident keypoints or the
   *  frame is dropped. Only supported in default 'angle' mode. */
  startMin: number;
  startMax: number;
  /** "End" zone of the rep (angle in degrees, or normalized distance ratio) */
  endMin: number;
  endMax: number;
  /** Number of reps per set */
  targetReps: number;
  /** Secondary rule set for bilateral exercises */
}

/** Configuration for rep-counted exercises */
export type RepConfig = {
  /** Measurement mode: 'angle' (default), 'distance', or 'angle3d' (uses z-coordinate) */
  mode?: 'angle' | 'distance' | 'angle3d';
  /** For angle mode: [p1, vertex, p3] — angle measured at vertex */
  /** For distance mode: [movingKp, anchorKp, referenceKp1] — tracks horizontal distance between movingKp and anchorKp, normalized by referenceKp1-to-anchorKp vertical height */
  keypoints: [string, string, string];
  /** Optional second triplet for bilateral exercises (e.g. squats). When set,
   *  the rep counter computes the angle on both sides and uses their average
   *  as the gating value. Both sides must have confident keypoints or the
   *  frame is dropped. Only supported in default 'angle' mode. */
  secondaryKeypoints?: [string, string, string];
  /** "Start" zone of the rep (angle in degrees, or normalized distance ratio) */
  startMin: number;
  startMax: number;
  /** "End" zone of the rep (angle in degrees, or normalized distance ratio) */
  endMin: number;
  endMax: number;
  /** Number of reps per set */
  targetReps: number;
  /** Secondary rule set for bilateral exercises */
  secondaryConfig?: SecondaryRepConfig;
};

/** Complete rule set for an exercise */
export type ExerciseRule = {
  /** Unique identifier (e.g., 'balance-1') */
  id: string;
  /** Display name (e.g., 'Knee Bends') */
  name: string;
  /** Category for grouping */
  category: 'assessment' | 'warmup' | 'strength' | 'balance' | 'upperBody' | 'lowerBody' | 'core' | 'dynamicBalance';
  /** Difficulty level (1 = easiest, 3 = hardest) */
  level?: number;
  /** List of form checks to perform */
  checks: FormCheck[];
  /** Minimum confidence to trust keypoints for this exercise */
  minConfidence?: number;
  /** Rep-counting config (mutually exclusive with timerSeconds) */
  repConfig?: RepConfig;
  /** Duration per set in seconds for timed exercises */
  timerSeconds?: number;
  /** Number of sets (default 3) */
  totalSets?: number;
  /** Whether this exercise is performed one side at a time (left then right) */
  unilateral?: boolean;
  /** Camera positioning guidance shown before exercise starts */
  cameraPrompt?: string;
};
