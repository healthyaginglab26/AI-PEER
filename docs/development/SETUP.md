# AI-PEER Developer (Local) Setup Guide

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

### Key Environment Variables

**These only ever need to be modified if you are starting for production.**

**API Backend (`API/.env`):**
| Variable | Description | Source / Default |
|---|---|---|
| `GCS_PROJECT_ID` | GCP Project ID for Storage & Firebase Admin | Team Lead / GCP Console |
| `GCS_CLIENT_EMAIL` | Service Account email for signing URLs | Service account JSON |
| `GCS_PRIVATE_KEY` | Service Account private key with literal `\n` | Service account JSON |
| `GCS_BUCKET_NAME` | Storage bucket for exercise demo videos | `aipeer_videos` |
| `GCS_MODEL_BUCKET` | Storage bucket for fine-tuned LLM model | `qwenfinetune` |
| `IDENTITY_PLATFORM_API_KEY` | Identity Platform API key for SMS 2FA | Firebase Console → General |
| `PORT` | Container internal listening port for Express API | `8080` (mapped to host `8085` by default) |
| `NODE_ENV` | Runtime environment | `development` |

**Mobile Frontend (`front-end/AI-PEER/.env`):**
| Variable | Description | Source / Default |
|---|---|---|
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase Web API key | Firebase Console |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Project ID | Firebase Console |
| `EXPO_PUBLIC_API_BASE_URL` | Local API URL for development | Default: `http://localhost:8085` *(matches docker-compose default; use `http://10.0.2.2:8085` in Android Emulator; use `http://localhost:8085` with `adb reverse tcp:8085 tcp:8085` or your PC's local Wi-Fi IP for physical devices)* |
| `EXPO_PUBLIC_ENABLE_TEST_LOGIN` | Enables 1-click test login buttons on local builds | `true` |

---

### Step 2: Spin Up Backend API

The Express API is containerized using `API/Dockerfile` and managed via Docker Compose (mapped to host port **8085** by default to prevent conflicts with other services on 8080 and Expo Metro on 8081):

```bash
# Start API backend in the background
docker compose up -d api
```

Verify that the backend is running and healthy:

```bash
# On macOS / Linux / Git Bash:
curl http://localhost:8085/health

# On Windows PowerShell:
curl.exe http://localhost:8085/health
# Or: Invoke-RestMethod http://localhost:8085/health

# Expected response: {"status":"OK","message":"AI PEER API is running"}
```

View live server logs:
```bash
docker compose logs -f api
```

Stop the API (when you're done):
```bash
docker compose stop api
```

---

### Step 3: Compile Android Mobile App

No Android Studio, Java JDK, or Android SDK installations are required on your host machine. The containerized builder (`Dockerfile.android`) encapsulates OpenJDK 17, Android SDK platforms 34/35, NDK 26.1, CMake 3.22, and all required tools.

#### On Windows (PowerShell):
```powershell
# Standard release build:
.\scripts\build-android-docker.ps1

# Build AND automatically install + reverse port + launch on connected phone:
.\scripts\build-android-docker.ps1 -Install

# Live-development debug build (requires Metro for hot-reloading). Recommended if you are writing frontend end and want to see the UI change as you press save:
.\scripts\build-android-docker.ps1 -BuildType debug -Install
```

#### On macOS / Linux / Git Bash:
```bash
# Standard release build:
./scripts/build-android-docker.sh

# Build AND automatically install + reverse port + launch on connected phone:
./scripts/build-android-docker.sh --install

# Live-development debug build (requires Metro for hot-reloading). Recommended if you are writing frontend end and want to see the UI change as you press save:
./scripts/build-android-docker.sh debug --install
```

#### Or Direct Docker Compose Command:
```bash
docker compose run --rm android-builder
```
**Unless something specifically prompts you to use this one, don't.**

#### What Happens During the Build:
1. Docker builds the compilation container and caches it locally.
2. Source files and Gradle dependencies are mounted into the container.
3. Gradle wrapper executes `assembleRelease` with `arm64-v8a` native architecture.
4. The JavaScript bundle is automatically compiled and embedded directly inside the APK, signed with the debug keystore.
5. The compiled standalone APK is automatically saved to your host workspace at:
   ```
   build-output/app-release.apk
   ```

#### Installing and Launching on a Test Device:
Connect your Android phone with USB debugging enabled, then run:
```bash
adb install -r build-output/app-release.apk
adb shell am start -n com.anonymous.aipeer/.MainActivity
```

The app will launch immediately and run completely offline on your device without needing Node.js or Metro running on your PC.

> [!TIP]
> **Connecting a Physical Android Phone to the Local Backend API:**
> On a physical device, `http://localhost:8085` looks for an API running on the phone itself, not your PC.
> - **USB Connection (Recommended):** If your phone is plugged in via USB, forward port `8085` once:
>   ```powershell
>   adb reverse tcp:8085 tcp:8085
>   ```
> - **Wi-Fi Connection:** In `front-end/AI-PEER/.env`, update `EXPO_PUBLIC_API_BASE_URL` to your PC's local network IP address (e.g. `http://192.168.1.X:8085`) before building the APK.

> [!NOTE]
> **Local Testing Login Options:**
> When opening the app on a local test build, you will see two developer buttons below the login form:
> - **`⚡ Use Default Test Login (Skip)`**: Bypasses the SMS verification screen completely, logging you straight into the dashboard as the pre-seeded patient (John Senior).
> - **`📝 Fill Test Credentials`**: Fills in the mock credentials (`5555555555` / `password123`) so you can test the form manually.

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

### 4. Port Conflict (`8080` or `8085` already allocated)
- **Symptom:** `Bind for 0.0.0.0:8085 failed: port is already allocated` (or `8080` if overridden).
- **Default Port Behavior:** `docker-compose.yml` binds host port **`8085`** to container port `8080` by default (`"${PORT:-8085}:8080"`) to avoid common conflicts with other local databases on 8080 and Expo's Metro Bundler on 8081.
- **How to Override the Host Port:**
  > [!NOTE]
  > Docker Compose evaluates `${PORT}` from your host terminal environment or a root-level `.env` file (`AI-PEER/.env`), **not** from `API/.env`.
  - **PowerShell (Terminal):** `$env:PORT="8086"; docker compose up -d api`
  - **Bash / macOS / Linux (Terminal):** `PORT=8086 docker compose up -d api`
  - **Permanent Root `.env`:** Create `AI-PEER/.env` with `PORT=8086`.
  - **Update Mobile Frontend:** Remember to update `EXPO_PUBLIC_API_BASE_URL` in `front-end/AI-PEER/.env` to match the chosen host port (e.g., `http://localhost:8086`).

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

### 8. "Unable to load script" Red Screen on Android
- **Cause:** You installed `app-debug.apk` instead of `app-release.apk`. Debug APKs do not embed the JavaScript bundle and expect to load code dynamically from a local Metro dev server (`localhost:8081`).
- **Solution (Standalone Testing - Least Overhead):** Build and install the default release APK:
  ```powershell
  .\scripts\build-android-docker.ps1
  adb install -r build-output/app-release.apk
  ```
- **Solution (Live Metro Development):** If you specifically want hot-reloading with a debug build, you need Node.js installed on your host:
  ```powershell
  adb reverse tcp:8081 tcp:8081
  cd front-end/AI-PEER
  npx expo start
  ```

### 9. "Network request failed" or Login Timeout on Physical Android Phone
- **Cause:** When the app runs on a physical device, `http://localhost:8085` connects to loopback on the phone itself, not the Docker container running on your host computer.
- **Solution (USB Connected):** Forward port 8085 from the host machine to your device:
  ```powershell
  adb reverse tcp:8085 tcp:8085
  ```
- **Solution (Wi-Fi):** Set `EXPO_PUBLIC_API_BASE_URL` in `front-end/AI-PEER/.env` to your host computer's local Wi-Fi IP (e.g., `http://192.168.1.150:8085`), then recompile the APK with `.\scripts\build-android-docker.ps1`.

