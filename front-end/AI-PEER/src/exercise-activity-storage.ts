import AsyncStorage from "@react-native-async-storage/async-storage";
import { BASE } from "./api";
import { auth } from "./firebaseClient";
import { getRefreshToken } from "./auth/tokenStore";

const EXERCISE_ACTIVITY_KEY = "exercise_activity_records_v1";
const MAX_RECORDS = 1000;

export type ExerciseActivityCategory =
  | "warmup"
  | "strength"
  | "balance"
  | "assessment"
  | "other";

/** Per-rep angle summary captured by RepCounter (Phase 3 fills this in). */
export type RepHistoryEntry = {
  startAngle: number;
  endAngle: number;
  peakAngle: number;
  romDeg: number;
  durationMs: number;
};

/** Angle summary for a single set. side='both' means a bilateral averaged exercise. */
export type AngleSummarySet = {
  setIndex: number;
  side: "left" | "right" | "both";
  reps: RepHistoryEntry[];
  bilateralAveraged?: boolean;
};

/** A form-check violation aggregated across a session (Phase 4 fills this in). */
export type FeedbackEvent = {
  message: string;
  severity: "mild" | "moderate" | "severe" | "warning" | "error";
  count: number;
  /** ms since session start at first occurrence */
  firstAt: number;
  /** ms since session start at most recent occurrence */
  lastAt: number;
};

export type ExerciseCompletionRecord = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  category: ExerciseActivityCategory;
  /** ISO timestamp of when the activity finished */
  completedAt: string;

  /** Legacy field — kept so the existing activity tab UI keeps working.
   *  For new records this equals totalReps; sanitizeRecord falls back to it
   *  when reading older v1 records that predate totalReps. */
  repCount: number;

  /** Always equals setsTarget when this record exists. An activity is only
   *  persisted once all sets have been completed. */
  setsCompleted: number;
  setsTarget: number;
  /** Total session duration summed across all sets (rounded to seconds). */
  durationSec: number;
  /** Sum of reps across all sets. */
  totalReps: number;
  /** Reps in each set in order, e.g. [10, 9, 10] for a 3-set exercise. */
  repsPerSet: number[];
  /** True for L/R-split exercises (knee extensor, knee flexor, hip abductor). */
  unilateral: boolean;
  /** Per-set angle history. Empty in Phase 2; populated by Phase 3. */
  angleSummaries: AngleSummarySet[];
  /** Aggregated form-check violations. Empty in Phase 2; populated by Phase 4. */
  feedbackEvents: FeedbackEvent[];
  /** Mean form score across all frames analyzed in this activity (0-100), or null. */
  avgScore: number | null;
  /** Total frames pose-analyzed across all sets. */
  framesAnalyzed: number;
  /** Optional free-form note (e.g., assessment band labels). */
  notes?: string;
  /** FES-I total score, present only for questionnaire assessment records. */
  fesI?: number;
  /** FES-I per-question answers {questionId: score}, questionnaire records only. */
  questionnaireAnswers?: Record<number, number>;
};

/** Input shape for submitCompletedActivity — id and completedAt are auto-generated if missing. */
export type NewActivityInput = Omit<
  ExerciseCompletionRecord,
  "id" | "completedAt" | "repCount"
> & {
  id?: string;
  completedAt?: string;
};

function isValidCategory(value: unknown): value is ExerciseActivityCategory {
  return (
    value === "warmup" ||
    value === "strength" ||
    value === "balance" ||
    value === "assessment" ||
    value === "other"
  );
}

/** Best-effort sanitizer that fills in defaults for fields missing from older records. */
function sanitizeRecord(
  raw: Partial<ExerciseCompletionRecord>
): ExerciseCompletionRecord | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string") return null;
  if (typeof raw.exerciseId !== "string") return null;
  if (typeof raw.exerciseName !== "string") return null;
  if (!isValidCategory(raw.category)) return null;
  if (typeof raw.completedAt !== "string") return null;
  if (Number.isNaN(new Date(raw.completedAt).getTime())) return null;
  if (typeof raw.durationSec !== "number") return null;
  if (
    raw.avgScore !== null &&
    raw.avgScore !== undefined &&
    typeof raw.avgScore !== "number"
  ) {
    return null;
  }
  if (typeof raw.framesAnalyzed !== "number") return null;

  // legacy v1 records used `repCount` only; new records carry both totalReps
  // and repCount (the latter as an alias). Fall back to repCount for old data.
  const legacyRepCount =
    typeof raw.repCount === "number" ? Math.max(0, Math.round(raw.repCount)) : 0;
  const totalReps =
    typeof raw.totalReps === "number"
      ? Math.max(0, Math.round(raw.totalReps))
      : legacyRepCount;

  return {
    id: raw.id,
    exerciseId: raw.exerciseId,
    exerciseName: raw.exerciseName,
    category: raw.category,
    completedAt: raw.completedAt,
    repCount: totalReps,
    setsCompleted:
      typeof raw.setsCompleted === "number" ? raw.setsCompleted : 1,
    setsTarget: typeof raw.setsTarget === "number" ? raw.setsTarget : 1,
    durationSec: raw.durationSec,
    totalReps,
    repsPerSet: Array.isArray(raw.repsPerSet)
      ? raw.repsPerSet.filter((n): n is number => typeof n === "number")
      : [totalReps],
    unilateral: typeof raw.unilateral === "boolean" ? raw.unilateral : false,
    angleSummaries: Array.isArray(raw.angleSummaries) ? raw.angleSummaries : [],
    feedbackEvents: Array.isArray(raw.feedbackEvents) ? raw.feedbackEvents : [],
    avgScore: raw.avgScore ?? null,
    framesAnalyzed: raw.framesAnalyzed,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    fesI: typeof raw.fesI === "number" ? raw.fesI : undefined,
    questionnaireAnswers:
      raw.questionnaireAnswers &&
      typeof raw.questionnaireAnswers === "object" &&
      Object.values(raw.questionnaireAnswers).every(
        (v) => typeof v === "number"
      )
        ? (raw.questionnaireAnswers as Record<number, number>)
        : undefined,
  };
}

function sortByNewest(
  records: ExerciseCompletionRecord[]
): ExerciseCompletionRecord[] {
  return [...records].sort(
    (a, b) =>
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
  );
}

export async function getExerciseActivityRecords(): Promise<
  ExerciseCompletionRecord[]
> {
  const raw = await AsyncStorage.getItem(EXERCISE_ACTIVITY_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Partial<ExerciseCompletionRecord>[];
    if (!Array.isArray(parsed)) return [];

    const validRecords = parsed
      .map((item) => sanitizeRecord(item))
      .filter((item): item is ExerciseCompletionRecord => item !== null);

    return sortByNewest(validRecords);
  } catch {
    return [];
  }
}

export async function clearExerciseActivityRecords(): Promise<void> {
  await AsyncStorage.removeItem(EXERCISE_ACTIVITY_KEY);
}

/** Returns a Set of YYYY-MM-DD date strings where at least one exercise was completed. */
export function getActiveDays(
  records: ExerciseCompletionRecord[]
): Set<string> {
  const days = new Set<string>();
  for (const r of records) {
    if (r.repCount <= 0) continue;
    const d = new Date(r.completedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.add(key);
  }
  return days;
}

function buildRecord(input: NewActivityInput): ExerciseCompletionRecord {
  const id =
    input.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const completedAt = input.completedAt ?? new Date().toISOString();
  const totalReps = Math.max(0, Math.round(input.totalReps));
  return {
    id,
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
    category: input.category,
    completedAt,
    repCount: totalReps, // keep the legacy alias populated for the activity tab
    setsCompleted: input.setsCompleted,
    setsTarget: input.setsTarget,
    durationSec: Math.max(0, Math.round(input.durationSec)),
    totalReps,
    repsPerSet: input.repsPerSet.map((n) => Math.max(0, Math.round(n))),
    unilateral: input.unilateral,
    angleSummaries: input.angleSummaries,
    feedbackEvents: input.feedbackEvents,
    avgScore:
      input.avgScore === null || input.avgScore === undefined
        ? null
        : Math.round(input.avgScore),
    framesAnalyzed: Math.max(0, Math.round(input.framesAnalyzed)),
    notes: input.notes,
    fesI: input.fesI,
    questionnaireAnswers: input.questionnaireAnswers,
  };
}

/** POST a completed activity to the backend. Returns true on success.
 *  Logs the failure and returns false on any error — does not throw, so
 *  callers can fall back to local-only persistence as a degraded mode.
 *
 *  Token freshness: calls auth.currentUser?.getIdToken(true) inline to force
 *  a refresh against Firebase's internal refresh token. The previous version
 *  trusted a stale token from useAuth() state which never auto-refreshed —
 *  any session older than ~1 hour was silently failing with 401. The app's
 *  custom /auth/refresh path (in AuthContext.restoreSession) is unaffected;
 *  it still handles cold-start session restore from the AsyncStorage refresh
 *  token. The two systems coexist orthogonally. */
export async function submitActivityToBackend(
  record: ExerciseCompletionRecord
): Promise<boolean> {
  try {
    let freshToken = await auth.currentUser?.getIdToken(true);
    if (!freshToken) {
      // Fallback for offline/zero-credential local dev mode where a mock token is used
      const refreshToken = await getRefreshToken();
      if (refreshToken) {
        freshToken = "mock-custom-token-mock-user-john-senior";
      }
    }
    if (!freshToken) {
      console.warn(
        "[ActivityStorage] No authenticated user; skipping backend submit"
      );
      return false;
    }

    const res = await fetch(`${BASE}/activities/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${freshToken}`,
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.message) msg = body.message;
        else if (body?.error) msg = body.error;
      } catch {}
      console.warn("[ActivityStorage] Backend submit failed:", msg);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(
      "[ActivityStorage] Backend submit error:",
      err?.message || err
    );
    return false;
  }
}

/** Persist a completed activity locally AND attempt to write it to the backend.
 *  The local AsyncStorage write happens first and always runs. The backend
 *  POST is fire-and-forget — failures are logged, not surfaced. Callers should
 *  only invoke this when an activity is fully complete (all sets done). */
export async function submitCompletedActivity(
  input: NewActivityInput
): Promise<ExerciseCompletionRecord> {
  const record = buildRecord(input);

  try {
    const existing = await getExerciseActivityRecords();
    const merged = sortByNewest([record, ...existing]).slice(0, MAX_RECORDS);
    await AsyncStorage.setItem(EXERCISE_ACTIVITY_KEY, JSON.stringify(merged));
  } catch (err) {
    console.error("[ActivityStorage] Local write failed:", err);
  }

  void submitActivityToBackend(record);

  return record;
}
