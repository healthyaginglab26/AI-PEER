# AI-PEER Mobile App

React Native mobile app for fall risk assessment and exercise interventions. Built for UCF Senior Design 2025-2026 in collaboration with UCF College of Medicine. This is a bare workflow project that uses Expo libraries but is NOT managed by Expo.

## Requirements

- **Node.js 24** — pinned via `.nvmrc`. Use `nvm use` (or `fnm use`/`asdf install`) to match.
- **Xcode 26 or later** — for iOS builds, macOS only.
- **CocoaPods 1.16+** — install via Homebrew: `brew install cocoapods`. (We intentionally don't use bundler/Gemfile — macOS system Ruby is too old, and managing a separate Ruby toolchain is more failure-prone than just using Homebrew's standalone CocoaPods.)
- **Android Studio** — for Android builds.

## Setup

```bash
nvm use                                # Use pinned Node version (.nvmrc)
npm install                            # JS dependencies
cd ios && pod install && cd ..         # iOS native dependencies (macOS only)
cp .env.example .env                   # Fill in Firebase and API credentials
npm run ios:doctor                     # Verify iOS environment is healthy (macOS)
npm run android:doctor                 # Verify Android environment is healthy
```

If either doctor reports failures, fix them before attempting a build. See **iOS Troubleshooting** and **Android Troubleshooting** below.

> **After pulling new changes** that touch `ios/Podfile`, `android/build.gradle`, `android/gradle.properties`, `package.json`, or any native code:
> - **iOS:** re-run `npm install`, then `cd ios && pod install && cd ..`, then `npm run ios:doctor`. If the build still misbehaves, `npm run ios:clean` is the one-command recovery.
> - **Android:** re-run `npm install`, then `cd android && ./gradlew clean && cd ..`, then `npm run android:doctor`. If the build still misbehaves, `npm run android:clean` is the one-command recovery.

> **Note:** `react-native-worklets-core` is a required direct dependency. It enables VisionCamera frame processors, which are what the custom MediaPipe Swift plugin (`PoseLandmarkerPlugin.swift`) builds on top of. It's distinct from the newer `react-native-worklets` package — both are needed but only `worklets-core` exposes VisionCamera's `FrameProcessorPlugin.h` headers to native code. If you ever see a "VisionCamera/FrameProcessorPlugin.h file not found" build error, the cause is `react-native-worklets-core` being missing from `node_modules`.

## iOS Troubleshooting

If an iOS build fails with C++ template errors (`Unknown type name 'requires'`, `JSArgT`, `ReturnT`), variable template errors, or any "works on my machine" weirdness, the cause is almost always environmental drift — stale Pods, wrong Command Line Tools selection, or a Clang module cache that predates a Podfile change.

**First, diagnose:**
```bash
npm run ios:doctor
```

This prints PASS/FAIL for every required piece of the iOS environment (Xcode version, Command Line Tools selection, Node version, CocoaPods, `Pods/`, `.env`, `react-native-worklets-core`). It is read-only and never modifies anything.

**Then, if doctor passes but the build still fails, nuke and rebuild:**
```bash
npm run ios:clean
```

This deintegrates and reinstalls Pods, wipes `~/Library/Developer/Xcode/DerivedData`, and reinstalls native dependencies from scratch. After it finishes, open Xcode → **Product → Clean Build Folder** (Cmd+Shift+K), then build.

> **Note:** `ios:clean` wipes DerivedData for **all** Xcode projects on this machine, not just AI-PEER. Other projects will rebuild from scratch on next open.

> **Why this happens:** VisionCamera and several other React Native libraries use C++20 features (concepts via `requires`, variable templates). Our `ios/Podfile` `post_install` hook forces `CLANG_CXX_LANGUAGE_STANDARD = c++20` on every pod target, but Xcode caches compiled headers in DerivedData and the Clang module cache — those caches can persist after Podfile changes and cause headers to be parsed against an older standard. `ios:clean` clears those caches.

**Common doctor failures:**
- *"Command Line Tools points at /Library/Developer/CommandLineTools"* — fix with `sudo xcode-select -s /Applications/Xcode.app`. This is the most common silent cause of toolchain drift.
- *"Node version mismatch"* — run `nvm use` (or `nvm install` if you don't have the pinned version).
- *"react-native-worklets-core missing"* — run `npm install`. It's a direct dependency required by the custom MediaPipe Swift plugin.
- *"pod not found"* or *"CocoaPods version too old"* — run `brew install cocoapods` or `brew upgrade cocoapods`.

## Android Troubleshooting

If an Android build fails with `Fail to run Gradle Worker Daemon`, OOM during `:react-native-screens:compileReleaseJavaWithJavac`, JDK toolchain mismatches, or any "works on my pixel 7 setup but not theirs" weirdness, the cause is almost always environmental drift — JDK version, Android SDK env vars, Gradle daemon memory, or stale build caches. The Gradle Worker Daemon failure mode in particular almost always means the OS couldn't fork a worker JVM (OOM, JDK env not set, daemon dead).

**First, diagnose:**
```bash
npm run android:doctor
```

This prints PASS/FAIL for every required piece of the Android environment (JDK version, `JAVA_HOME`, Android SDK location, `ANDROID_SDK_ROOT` / `ANDROID_HOME`, Gradle wrapper, gradle.properties, build tools, daemon health). It is read-only and never modifies anything. Cross-platform: macOS, Linux, Windows (via WSL or Git Bash).

**Then, if doctor passes but the build still fails, nuke and rebuild:**
```bash
npm run android:clean
```

This runs `./gradlew clean`, wipes `android/build/`, `android/app/build/`, `android/.gradle/`, and stops any running Gradle daemons. After it finishes, fresh-build with `npm run android` (or open `android/` in Android Studio and Sync → Rebuild). The script deliberately leaves `node_modules/`, `android/local.properties`, and `android/keystores/` alone — those are slow to recreate or contain user-specific config.

> **Why this happens:** Gradle Worker Daemons are forked JVMs that run compilation tasks in parallel. They inherit the JDK, the Android SDK location, and Gradle's memory configuration from the parent process. If any of those is misconfigured (wrong JDK on PATH, missing `ANDROID_HOME`, daemon out of memory) the worker fork fails with the generic "Fail to run Gradle Worker Daemon" message — Gradle's diagnostics are intentionally vague at that layer because the actual failure happens inside the OS exec call. `android:doctor` checks every environment variable and config knob that affects worker daemon health, and `android:clean` resets the build cache + kills any zombie daemons.

**Common doctor failures:**
- *"JDK version mismatch"* / *"Wrong JDK on PATH"* — install the JDK version that React Native + AGP expect (usually JDK 17). Set `JAVA_HOME` accordingly.
- *"ANDROID_HOME / ANDROID_SDK_ROOT not set"* — point them at your Android SDK install (typically `~/Library/Android/sdk` on macOS, `~/Android/Sdk` on Linux).
- *"Gradle daemon OOM"* — bump `org.gradle.jvmargs` in `android/gradle.properties` (the hardened defaults from commit `f061acd9` should already cover this; only escalate if you're hitting it on a memory-constrained machine).
- *"Build tools version not installed"* — open Android Studio → SDK Manager → install the build tools version that matches `android/build.gradle`.

## Running the App

Expo Go will not work. You must build the native app.

**iOS (macOS only) — recommended workflow:**
```bash
# Terminal 1: Start Metro bundler
npm start

# Terminal 2: Open Xcode workspace, then Cmd+R to build & run
npm run ios
```

The `npm run ios` script is just `open ios/AIPEER.xcworkspace` — it opens the project in Xcode rather than triggering a CLI build. From Xcode you can pick the device, see real-time compile errors, and hit Cmd+R to build + run. JS-only changes hot-reload via Metro automatically; only native code changes (Swift / Pods) require a fresh Xcode build.

**Android:**
```bash
# Terminal 1: Start Metro bundler
npm start

# Terminal 2: Build and run
npm run android
```

Or open `android/` directly in Android Studio.

## Dev Loop

**iOS canonical workflow:**

1. Start Metro bundler: `npx expo start`
2. Open the Xcode workspace: `open ios/AIPEER.xcworkspace` (or `npm run ios`, which does the same)
3. Select a connected device or simulator in the Xcode toolbar
4. Cmd+R to build and run

Do NOT use `npx expo run:ios`. This is a bare workflow project — the native side must be built through Xcode for reliable native dependency compilation (Swift plugins, CocoaPods, C++ flags). `npx expo run:ios` can silently skip post-install Podfile hooks and miss the `CLANG_CXX_LANGUAGE_STANDARD = c++20` injection that the VisionCamera plugin requires.

JS-only changes hot-reload via Metro without a rebuild. Only Swift / Objective-C / Podfile changes require a fresh Xcode build.

## Features

- Fall risk assessment with FRA matrix visualization and FES-I questionnaire
- SMS 2FA authentication via Google Identity Platform with two-token persistence (refresh token in AsyncStorage → /auth/refresh → custom token → ID token)
- On-device AI chat powered by Qwen3.5-2B (finetuned on [YsK-dev/geriatric-health-advice](https://huggingface.co/datasets/YsK-dev/geriatric-health-advice) (Apache 2.0), ~1.2GB, no data leaves phone)
- Conversation history with 24-hour auto-archive
- Real-time pose + hand estimation via MediaPipe Pose Landmarker AND Hand Landmarker (~9MB + ~7MB models, GPU-accelerated, single custom native plugin returning both per frame)
- Open-palm gesture-confirm start flow on every monitored exercise session — replaces direct Start Monitoring with a "hold up an open palm → 5-second countdown → tracking" flow
- 23 exercises with pose-based form analysis (2 clinical fall-risk assessments, 5 warmup, 5 strength, 11 balance)
- Two clinical fall-risk assessments: Chair Rise (30-second sit-to-stand) and Timed Up and Go (TUG)
- Rep counting with state machine (1.2s cooldown, 3D angle support, bilateral averaging) and per-rep angle history captured into the activity record
- Form score = percentage of frames where all checks passed (binary per-frame, averaged across the activity)
- Per-user exercise activity history persisted to Firestore via the backend `/activities` endpoint, with automatic Firebase ID-token refresh per request
- Exercise video library with signed URL delivery from GCS
- Daily workout recommendations with compliance tracking
- Activity tracking with weekly summaries and monthly heatmap
- Accessibility preferences (font scaling, high contrast)
- HIPAA-compliant design (all ML inference on-device)

## Project Structure

```
app/                              # Expo Router screens
  _layout.tsx                     # Root layout (providers: Auth, LLM, Vision, Prefs)
  index.tsx                       # Login/Register
  verify.tsx                      # SMS code verification — routes to /welcome (new user) or /(tabs) (returning user)
  welcome.tsx                     # Onboarding
  questionnaire.tsx               # FES-I fall risk questionnaire
  chat-history.tsx                # Conversation history list
  (tabs)/
    _layout.tsx                   # Tab navigator (5 visible tabs + hidden routes)
    index.tsx                     # Home -- FRA matrix, scores, activity
    ai-chat.tsx                   # On-device AI chat
    exercise.tsx                  # Exercise category selector
    exercise-session.tsx          # Multi-set exercise w/ camera + gesture-confirm + rep counter
    activity.tsx                  # Activity tracking, compliance heatmap
    balance-test.tsx              # Fall-risk assessments landing (Chair Rise + TUG)
    chair-rise-test.tsx           # 30-second sit-to-stand assessment
    tug-test.tsx                  # Timed Up and Go assessment
    video-confirm.tsx             # Video playback before exercise
    contacts.tsx                  # Emergency contacts
    settings.tsx                  # User preferences

src/
  api.ts                          # HTTP client for backend API
  firebaseClient.ts               # Firebase Auth SDK init
  video.ts                        # Exercise video URL mapping
  daily-workout.ts                # Workout recommendation logic
  workout-combos.ts               # Exercise combinations
  exercise-activity-storage.ts    # Local + backend dual-write activity persistence
  fra-storage.ts                  # AsyncStorage for FRA results
  prefs-context.tsx               # Accessibility preferences context
  theme.ts                        # Colors, typography, spacing

  auth/
    AuthContext.tsx               # Two-token persistence + restoreSession on launch

  llm/
    LLMService.ts                 # Singleton llama.rn wrapper (load, generate, release)
    LLMContext.tsx                # React Context (download, init, generate state)
    modelDownloader.ts            # Signed URL fetch + streaming download
    config.ts                     # Model filename, size, inference params
    systemPrompt.ts               # PEER framework persona + ChatML formatting
    useLLM.ts                     # Hook for components
    types.ts                      # ChatMessage, Conversation, LLMState

  vision/
    VisionService.ts              # MediaPipe pose + hand landmark mappers
    VisionContext.tsx             # Tracking state machine + open-palm detector + smoother
    FormAnalyzer.ts               # Per-frame check loop with rep-zone gating + severity
    RepCounter.ts                 # Rep state machine + per-rep angle history
    frameProcessor.ts             # VisionCamera worklet bridge to native plugin
    config.ts                     # Vision module config
    constants.ts                  # COCO keypoint names, skeleton edges
    types.ts                      # Pose, Keypoint, FormFeedback, FormViolation
    useVision.ts                  # Hook exposing vision state + actions
    exercises/                    # 23 exercise rule definitions
      assessment/                 # Chair rise, TUG (4-stage parked stub)
      warmup/                     # Head, neck, back, trunk, ankle
      strength/                   # Knee ext/flex, hip abd, calf/toe raises
      balance/                    # 11 balance exercises
    components/
      GuideOverlay.tsx            # Camera positioning guide
      SkeletonOverlay.tsx         # Skeleton visualization

ios/AIPEER/
  PoseLandmarkerPlugin.swift      # Custom VisionCamera plugin: Pose + Hand from one call
  PoseLandmarkerPlugin.m          # ObjC registration for the Swift plugin
  pose_landmarker_full.task       # MediaPipe Pose model (~9MB)
  hand_landmarker.task            # MediaPipe Hand model (~7MB)

android/app/src/main/
  java/com/anonymous/aipeer/poselandmarker/
    PoseLandmarkerFrameProcessorPlugin.kt   # Kotlin port of the Swift plugin
  assets/
    pose_landmarker_full.task     # MediaPipe Pose model (Android copy)
    hand_landmarker.task          # MediaPipe Hand model (Android copy)

assets/models/                    # Canonical model files (sources of truth)
  pose_landmarker_full.task
  hand_landmarker.task

scripts/                          # Build doctors + clean recovery
  ios-doctor.sh                   # iOS environment diagnostics
  ios-clean.sh                    # iOS pod deintegrate + DerivedData wipe
  android-doctor.sh               # Android environment diagnostics
  android-clean.sh                # Gradle clean + build cache wipe

components/
  ModelDownloadModal.tsx          # LLM download dialog with progress bar
  FRAMatrixCard.tsx               # FRA matrix visualization
  GestureCountdownOverlay.tsx     # Gesture-confirm + countdown overlay (Hold up an open palm)
  graphs/                         # FRA and line graph components
```

## On-Device LLM

The AI chat uses Qwen3.5-2B finetuned on [YsK-dev/geriatric-health-advice](https://huggingface.co/datasets/YsK-dev/geriatric-health-advice) (Apache 2.0, 10,813 rows of short-form geriatric health coaching) running locally via llama.rn. On first use, the model (~1.2GB Q4_K_M GGUF) is downloaded from GCS via a signed URL (requires authentication). All inference happens on-device for HIPAA compliance.

Configuration in `src/llm/config.ts`:
- Max tokens: 150
- Context size: 2048
- Temperature: 0.7
- Repeat penalty: 1.15
- Conversation TTL: 24 hours

## i18n and TTS

**Supported locales.** The app ships with three languages: English (`en`), Spanish (`es`), and Haitian Creole (`ht`). Translation files live at `src/locales/{en,es,ht}/translation.json`, each containing a single top-level JSON object whose keys mirror the English file.

**Initialization.** `src/i18n.ts` imports all three JSON files and passes them to `i18next` via `initReactI18next`. The initial language is `en`; the fallback is also `en`. The instance is exported as the default export and is also consumed directly by `src/tts.ts`.

**Persisting the active language.** `src/prefs-context.tsx` stores the active language inside the `Prefs` object (`language: "en" | "es" | "ht"`) which is serialized to AsyncStorage under the key `accessibility_prefs_v1`. When `prefs.language` changes, a `useEffect` in `PrefsProvider` calls `i18n.changeLanguage(prefs.language)` so the i18next instance stays in sync. The language selector in `app/(tabs)/settings.tsx` calls `updatePrefs("language", lang)`, which triggers the effect.

**TTS.** `src/tts.ts` exports two functions:
- `speak(text, opts?)` — calls `expo-speech`'s `Speech.speak` with the correct `language` option derived from the active locale at call-time.
- `stopSpeech()` — calls `Speech.stop()`.

The locale-to-voice mapping in `ttsLanguage()` is: `en` → `en-US`, `es` → `es-ES`, `ht` → `fr-FR`. The Haitian Creole fallback to French (`fr-FR`) is intentional — iOS ships no native Creole voice.

Every `Speech.speak` call in the codebase must go through `src/tts.ts:speak` (never call `Speech.speak` directly). This ensures locale changes in settings are automatically honored without any call-site changes.

**Adding a new locale.** To add a new language:

1. Create `src/locales/<lang>/translation.json` mirroring all keys from `src/locales/en/translation.json`.
2. Import and register it in `src/i18n.ts` (add to the `resources` object).
3. Extend the `Prefs["language"]` union in `src/prefs-context.tsx` to include the new code.
4. Extend `ttsLanguage()` in `src/tts.ts` with a new `if (lang.startsWith("<lang>")) return "<BCP-47-voice>";` branch.
5. Add a new language button to the language selector in `app/(tabs)/settings.tsx` (the `["en", "es", "ht"]` array and the corresponding `languages` label array).

## Vision Pipeline

Real-time exercise form monitoring AND open-palm gesture-confirm start flow, both running on the same single-call native plugin.

**Dual-task plugin.** A single custom VisionCamera frame processor plugin (`PoseLandmarkerPlugin.swift` on iOS, `PoseLandmarkerFrameProcessorPlugin.kt` on Android — both registered as `'poseLandmarker'`) runs Google MediaPipe Pose Landmarker AND MediaPipe Hand Landmarker on each camera frame, returning a unified `{ pose: [...33], hands: [{ landmarks: [...21], handedness }] }` result. The two MediaPipe tasks share the same `MediaPipeTasksVision` pod (iOS) / `tasks-vision` artifact (Android) — adding the Hand task did NOT require a new dependency or any new C++ compilation.

**Pose** (33 landmarks per person, mapped to 17 COCO-compatible keypoints in `VisionService.mapMediaPipeToPose`). 23 exercises have rules in `src/vision/exercises/` (angle, alignment, position, distance checks). Form scores derive from the percentage of frames where ALL form checks passed during the active rep period — binary 100/0 per frame, averaged over the activity for the final score. The form analyzer supports rep-zone gating (skip the check while the user is in the start or end zone — only fire warnings in the dead zone between) and severity gradation (mild/moderate/severe based on degrees outside the acceptable range), both in `src/vision/exercises/types.ts`.

**Rep counting** lives in `RepCounter.ts`: a state machine (`idle → in_start → in_end`) with a 1.2-second cooldown, 2-frame zone persistence, 15° minimum movement validation, and bilateral keypoint averaging for two-leg exercises (e.g., knee bends). Each counted rep is logged into a per-rep history (`{ startAngle, endAngle, peakAngle, romDeg, durationMs }`) which the activity-record persistence layer pulls into the Firestore record at end of session.

**Form-check smoothing.** `VisionContext` wraps `analyzePose` with a per-rule violation-start map: a violation must be continuously failing for ≥300ms before it surfaces to the user. This catches single-frame keypoint glitches without hiding sustained out-of-form positions. The smoothed violations also feed the binary form score (so a one-frame glitch doesn't tank the score).

**Gesture-confirm start flow.** Tapping Start Monitoring (or Start Test on the assessments) doesn't immediately begin tracking. Instead, `VisionContext` enters a `waiting_for_gesture` state and runs the `detectOpenPalm` check on each detected hand. The detector requires (1) all four non-thumb fingers extended in 3D (extension ratio ≥ 0.92), (2) all fingertips above the wrist in image y, (3) thumb extended away from the wrist (≥ 1.2× hand-size scale), and (4) the palm-normal cross product pointing toward the camera. The cross-product sign depends on which hand it is and the underlying coordinate transform — see the next section. Once the user holds the gesture continuously for `GESTURE_HOLD_MS` (1000ms), VisionContext enters `countdown` for 5 seconds (audible 5-4-3-2-1 via expo-speech) and then transitions to `tracking`. The `GestureCountdownOverlay` component renders the prompt + the countdown number visually on top of the camera.

**TrackingMode state machine.** The whole lifecycle is `idle → waiting_for_gesture → countdown → tracking → idle` with explicit transitions in `VisionContext.tsx`. The camera + skeleton overlay render in any non-idle state; the rep counter UI only renders in `tracking`. Between sets of a multi-set exercise, the screen re-enters `waiting_for_gesture` and the user re-confirms with another open-palm gesture.

**Cross-platform coordinates and the Android handedness gotcha.** `mapMediaPipeToPose` and `mapMediaPipeToHands` both apply a landscape→portrait coordinate rotation. iOS uses `(x: lm.y, y: lm.x)` (transpose only); Android uses `(x: lm.y, y: 1 - lm.x)` (transpose with Y-flip, because CameraX delivers the front camera buffer in the opposite vertical orientation from iOS). The Y-flip on Android inverts the sign of the cross product computed in `detectOpenPalm`, so the iOS detector logic runs inverted on Android. **An earlier implementation assumed this was canceled by an inverted handedness label on Android (per the MediaPipe selfie convention warning), but Pixel 7 device testing disproved that assumption** — MediaPipe reports handedness correctly on Android, only the cross-product sign flips. The detector now branches on `Platform.OS === 'android'` and negates the expected sign. If a future device test ever finds palm-vs-back inverted again, the fix is to flip the `RIGHT_PALM_NORMAL_SIGN` constant in `VisionContext.tsx`.

**Native plugin lifecycle differences.** iOS uses constructor-time GPU init (the plugin is instantiated once when VisionCamera registers it). Android uses lazy thread-affine init in the first `callback()` call — MediaPipe's GPU delegate has thread affinity, and the constructor runs on the wrong thread, so we defer init to the videoQueue thread where `callback()` runs. Both platforms hold the landmarkers in process-wide singletons so React Native fast-refresh / HMR doesn't leak instances across reloads.

**Build dependency note.** The custom Swift plugin only compiles because `react-native-worklets-core` is declared as a direct npm dependency in `package.json`. VisionCamera's frame processor support is gated on this package — without it, VisionCamera does not expose `FrameProcessorPlugin.h` and `PoseLandmarkerPlugin.swift` fails to compile.

### How to add a new exercise

See [`docs/pipelines/VISION_PIPELINE.md`](../../docs/pipelines/VISION_PIPELINE.md) for the complete specification. The high-level steps are:

- Create a new rule file in the appropriate subdirectory under `src/vision/exercises/` (e.g., `src/vision/exercises/balance/myExercise.ts`). Export a rule object conforming to the `ExerciseRule` type defined in `src/vision/exercises/types.ts`.
- Register the new rule in the subdirectory's `index.ts` and in the top-level `src/vision/exercises/index.ts`. The exercise ID must be unique across all categories.
- Add any assets: a demo video (uploaded to GCS and mapped in `src/video.ts`) and a thumbnail image if needed.
- Optionally add a translation key under the `exercise.*` namespace in each of the three locale files (`src/locales/{en,es,ht}/translation.json`) for the exercise display name and any coaching cues.
- Test the rule end-to-end via `app/(tabs)/exercise-session.tsx` — select the exercise, trigger the gesture-confirm start flow, and confirm rep counting and form feedback behave as expected.

## Environment Variables

See `.env.example` for required Firebase and API configuration.
