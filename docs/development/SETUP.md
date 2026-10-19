# AI-PEER Developer Setup Guide

Welcome to the AI-PEER development setup guide. AI-PEER adopts a **Docker-first, zero-host-install** development approach. You do not need to install local runtimes (Node.js, OpenJDK 17, Android SDK tools, Gradle, or C++ compilers) on your host operating system to run backend services or compile Android test APKs.

---

## Prerequisites (Universal: Windows, macOS, Linux)

To clone and run AI-PEER, you only need two core tools installed on your host machine:

1. **Git** — [git-scm.com](https://git-scm.com/)
2. **Docker Desktop** (macOS / Windows) or **Docker Engine + Docker Compose** (Linux) — [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)

> [!NOTE]
> Ensure Docker Desktop is allocated at least **4 GB of RAM** (6 GB+ recommended) in *Settings → Resources → Advanced* to accommodate multi-threaded C++ and Gradle compilations.

### Optional Host Utilities:
- **`adb` (Android Debug Bridge):** Required only if you plan to sideload compiled APKs directly to a physical Android device plugged into your computer via USB.
- **Xcode & CocoaPods (macOS Only):** Required **only** if you are explicitly developing or building the native iOS client. *(See [iOS Scope Note](#ios-native-development-macos-only) below).*

---

## Quickstart (Zero to Running in 3 Steps)

### Step 1: Clone Repository & Configure Secrets

```bash
git clone https://github.com/healthyaginglab26/AI-PEER.git
cd AI-PEER
```

Configure your local environment variables from the provided examples:

```bash
# 1. Configure API backend environment
cp API/.env.example API/.env

# 2. Configure Mobile frontend environment
cp front-end/AI-PEER/.env.example front-end/AI-PEER/.env
```

#### Key Environment Variables

**API Backend (`API/.env`):**
| Variable | Description | Source / Default |
|---|---|---|
| `GCS_PROJECT_ID` | GCP Project ID for Storage & Firebase Admin | Team Lead / GCP Console |
| `GCS_CLIENT_EMAIL` | Service Account email for signing URLs | Service account JSON |
| `GCS_PRIVATE_KEY` | Service Account private key with literal `\n` | Service account JSON |
| `GCS_BUCKET_NAME` | Storage bucket for exercise demo videos | `aipeer_videos` |
| `GCS_MODEL_BUCKET` | Storage bucket for fine-tuned LLM model | `qwenfinetune` |
| `IDENTITY_PLATFORM_API_KEY` | Identity Platform API key for SMS 2FA | Firebase Console → General |
| `PORT` | Listening port for Express API | `8080` (or `3000`) |
| `NODE_ENV` | Runtime environment | `development` |

**Mobile Frontend (`front-end/AI-PEER/.env`):**
| Variable | Description | Source / Default |
|---|---|---|
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase Web API key | Firebase Console |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Project ID | Firebase Console |
| `EXPO_PUBLIC_API_BASE_URL` | Local API URL for development | Default: `http://localhost:8080` *(use LAN IP when testing on physical phone)* |

---

### Step 2: Spin Up Backend API (Dockerized)

The Express API is containerized using `API/Dockerfile` and managed via Docker Compose:

```bash
# Start API backend in the background
docker compose up -d api
```

Verify that the backend is running and healthy:

```bash
curl http://localhost:8080/health
# Expected response: {"status":"OK","message":"AI PEER API is running"}
```

View live server logs:
```bash
docker compose logs -f api
```

Stop the API:
```bash
docker compose stop api
```

---

### Step 3: Compile Android Mobile App (Containerized)

No Android Studio, Java JDK, or Android SDK installations are required on your host machine. The containerized builder (`Dockerfile.android`) encapsulates OpenJDK 17, Android SDK platforms 34/35, NDK 26.1, CMake 3.22, and all required tools.

#### On Windows (PowerShell):
```powershell
.\scripts\build-android-docker.ps1
```
*(To produce a release APK: `.\scripts\build-android-docker.ps1 -BuildType release`)*

#### On macOS / Linux / Git Bash:
```bash
./scripts/build-android-docker.sh
```
*(To produce a release APK: `./scripts/build-android-docker.sh release`)*

#### Or Direct Docker Compose Command:
```bash
docker compose run --rm android-builder
```

#### What Happens During the Build:
1. Docker builds the compilation container and caches it locally.
2. Source files and Gradle dependencies are mounted into the container.
3. Gradle wrapper executes `assembleDebug` with `arm64-v8a` native architecture.
4. The compiled APK is automatically saved to your host workspace at:
   ```
   build-output/app-debug.apk
   ```

#### Installing on a Test Device:
Connect your Android phone with USB debugging enabled, then run:
```bash
adb install -r build-output/app-debug.apk
```

---

## iOS Native Development (macOS Only)

> [!IMPORTANT]
> **Why iOS is not containerized:**
> Apple's software license agreement restricts macOS and Xcode from running in standard Linux Docker environments. Building the native iOS target (`.xcworkspace`) requires macOS hardware and local developer tools.

If you are on macOS and developing for iOS:

1. **Install Prerequisites (macOS):**
   ```bash
   brew install cocoapods watchman
   sudo xcode-select -s /Applications/Xcode.app
   sudo xcodebuild -license accept
   ```
2. **Install Pods:**
   ```bash
   cd front-end/AI-PEER
   nvm use # Activates Node 24 from .nvmrc
   npm install
   cd ios && pod install && cd ..
   ```
3. **Verify Environment:**
   ```bash
   npm run ios:doctor
   ```
4. **Run in Xcode:**
   ```bash
   npm run ios
   # Opens ios/AIPEER.xcworkspace in Xcode
   ```
   Select simulator or physical device and press **Cmd+R** to build. *(Do not use `npx expo run:ios` as this is an Expo bare workflow project).*

---

## Local Firebase Functions Emulator (Optional)

If testing the REDCap sync scheduled Cloud Function locally:

```bash
cd functions
npm install
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-service-account.json
npx firebase emulators:start --only functions
```

Functions emulator UI is accessible at `http://localhost:4000`.

---

## Troubleshooting Containerized Workflows

### 1. Docker daemon is not running
```
failed to connect to the docker API at ...
```
- **Solution:** Ensure Docker Desktop is launched and running in your taskbar / menu bar before running `docker compose` or build scripts.

### 2. Gradle Out-Of-Memory (OOM) / WSL2 Freezes during native C++ compilation
- **Cause:** Compiling native C++ libraries (`llama.rn`, `VisionCamera`, `reanimated`) on high-core CPUs can spawn many parallel Clang processes, exhausting host WSL2 memory.
- **Solution & Built-in Protection:**
  - AI-PEER enforces `CMAKE_BUILD_PARALLEL_LEVEL=2` and Gradle `--max-workers=2` / `-Dorg.gradle.workers.max=2` by default to cap concurrency.
  - In Docker Desktop, ensure at least **4 GB to 6 GB** of memory is allocated (*Settings → Resources → Advanced*).

### 3. Missing `debug.keystore` Error (`validateSigningDebug FAILED`)
- **Cause:** Android Gradle requires a debug keystore to sign the debug APK, but `*.keystore` files are ignored in `.gitignore`.
- **Solution:** Both `build-android-docker.ps1` and `build-android-docker.sh` automatically detect if `debug.keystore` is missing and generate one via `keytool` before invoking Gradle.

### 4. Port `8080` already allocated
- **Symptom:** `Bind for 0.0.0.0:8080 failed: port is already allocated` (common if running Postgres, Adminer, or another web service).
- **Solution:** Override the host port at runtime without editing code:
  - **PowerShell:** `$env:PORT="8085"; docker compose up -d api`
  - **Bash / Linux / macOS:** `PORT=8085 docker compose up -d api`
  - Or permanently change `PORT=8085` in `API/.env`.

### 5. Windows PowerShell Execution Policy Restrictions
- **Symptom:** `File ...build-android-docker.ps1 cannot be loaded because running scripts is disabled on this system.`
- **Solution:** Run with the bypass flag:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\build-android-docker.ps1
  ```

### 6. Rebuilding containers without cache
If dependencies in `package.json` or Dockerfiles change:
```bash
docker compose build --no-cache api
docker compose build --no-cache android-builder
```

### 7. Cleaning Gradle cache volume
If you need to reset the persistent Gradle volume:
```bash
docker volume rm aipeer-gradle-cache
```
