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

### Step 1: Clone Repository & Configure Local Dev Environment

```bash
git clone https://github.com/healthyaginglab26/AI-PEER.git
cd AI-PEER
```

Initialize your **local development** `.env` files from the provided `.env.example` templates (skips any `.env` file that already exists so you don't overwrite local edits):

```bash
# macOS / Linux / Git Bash:
./scripts/setup-env.sh

# Windows (PowerShell):
.\scripts\setup-env.ps1
```

*(Or manually copy them via `cp API/.env.example API/.env` and `cp front-end/AI-PEER/.env.example front-end/AI-PEER/.env`).*

> [!IMPORTANT]
> **Local Dev vs. Production Environment Files:**
> The `.env.example` templates are **pre-configured strictly for zero-credential local development** (`NODE_ENV=development`, `MOCK_AUTH=true`, deterministic `123456` test OTPs, 1-click test login bypass buttons, and `localhost` URLs).
> - **For Local Development:** No edits or cloud keys are needed—they work out of the box right after running `setup-env`.
> - **For Production Deployments:** Do **not** use the mock defaults from `.env.example`. Production runs require real GCP/Firebase credentials, your live Cloud Run URL, and disabling all mock/test flags (see tables below).

### Environment Variables Reference (Local Dev Defaults vs. Production)

**API Backend (`API/.env`):**
| Variable | Purpose | Local Dev Default (`.env.example`) | Production Requirement |
|---|---|---|---|
| `NODE_ENV` | Runtime environment | `development` | `production` |
| `PORT` | Container internal listening port | `8080` *(mapped to host `8085`)* | `8080` *(managed by Cloud Run)* |
| `MOCK_AUTH` | Deterministic `123456` OTP & mock store | `true` *(Dev only)* | `false` or unset |
| `GCS_PROJECT_ID` | GCP Project ID for Storage & Firebase Admin | `ai-peer` | Real GCP Project ID |
| `GCS_CLIENT_EMAIL` | Service Account email for signing URLs | *Empty (serves local mock assets)* | Service account email |
| `GCS_PRIVATE_KEY` | Service Account private key with literal `\n` | *Empty (serves local mock assets)* | Service account private key |
| `GCS_BUCKET_NAME` | Storage bucket for exercise demo videos | `aipeer_videos` | Production video bucket name |
| `GCS_MODEL_BUCKET` | Storage bucket for fine-tuned LLM model | `qwenfinetune` | Production model bucket name |
| `IDENTITY_PLATFORM_API_KEY` | Identity Platform API key for SMS 2FA | *Empty (uses mock OTP `123456`)* | Real Firebase / Identity Platform key |

**Mobile Frontend (`front-end/AI-PEER/.env`):**
| Variable | Purpose | Local Dev Default (`.env.example`) | Production Requirement |
|---|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Backend API base URL | `http://localhost:8085` *(use `http://10.0.2.2:8085` for Android Emulator, or `adb reverse tcp:8085 tcp:8085` / LAN IP for physical phone)* | Live Cloud Run HTTPS URL (`https://aipeer-api-...run.app`) |
| `EXPO_PUBLIC_ENABLE_TEST_LOGIN` | Shows 1-click test login bypass buttons | `true` *(Dev only)* | `false` |
| `EXPO_PUBLIC_MOCK_LLM` | Uses canned responses instead of 1.2 GB LLM | `false` *(Web Mode 1 automatically uses Mock LLM via `Platform.OS === 'web'`; `false` lets Android run the real 1.2 GB model)* | `false` |
| `EXPO_PUBLIC_USE_EMULATOR` | Connects client SDK to local emulator/mock | `true` *(Dev only)* | `false` |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase Web API key | `mock-api-key-for-local-dev` | Real Firebase Web API key |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Project ID | `ai-peer` | Real Firebase Project ID |

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

Stop or reset the API:
```bash
# Pause/stop API container:
docker compose stop api

# Rebuild & restart API container (after changing API/package.json or API/Dockerfile):
docker compose up -d --build --force-recreate api
```

---

### Step 3: Choose Your Frontend Mode (Pick What Fits Your Task!)

You do **not** need to wait for a full Android APK compilation just to test UI, login, API routes, or chat screens. Choose one of the **3 development modes** below based on what you are working on:

| Mode | Best For... | Wait Time | Hardware Needed |
|---|---|---|---|
| **Mode 1: Web / Mock Mode** *(Recommended for 80% of tasks)* | UI screens, login/2FA (`verify.tsx`), API integration, questionnaires, translations, and AI Chat UI layout (uses built-in Mock LLM) | **~5 seconds** after the first build (Instant hot-reload) | Any PC browser (`http://localhost:8081`) — **No phone required** |
| **Mode 2: Live Dev APK** *(Build Once, Instant Reload)* | Testing real on-device `llama.rn` LLM changes or `VisionCamera` pose tracking while actively editing `.ts`/`.tsx` files | **~10 mins once**, then **1 second** per save | Android Phone + USB Cable |
| **Mode 3: Standalone Release APK** | Final QA testing, clinical demos, or running the app unplugged from your computer | **~12 mins** first build, **~2–3 mins** cached rebuilds | Android Phone |

---

#### ⚡ Mode 1: Web / Mock Mode (5-Second Startup — Zero Android Compile)

If you are working on screens, navigation, backend API calls, Firebase Auth, or AI Chat UI, run the web container (or local Expo web). It automatically enables `EXPO_PUBLIC_MOCK_LLM=true` so you can test the AI Chat screen immediately without downloading the 1.2 GB model or compiling C++:

```bash
# Start both the API and Web dev server in Docker (zero Node.js install needed on host):
docker compose up -d api web

# View logs / wait until Metro says "Waiting on http://localhost:8081":
docker compose logs -f web
```
Then open **`http://localhost:8081`** in your browser! Every time you press Save in VS Code, the browser updates in 1 second.
*(If you already have Node.js installed locally, you can also just run `cd front-end/AI-PEER && npx expo start --web`).*

##### Mode 1 — Stop, Clear Cache & Reset Commands:
```bash
# Stop Mode 1 (keeps containers & cached node_modules intact for next time):
docker compose stop web api

# Restart Web & clear Metro bundler cache (use after changing metro.config.js or .env):
docker compose exec web npx expo start --web --clear --port 8081
# (Or recreate the containers cleanly):
docker compose up -d --force-recreate api web

# Full Reset for Mode 1 (removes web/api containers AND wipes cached frontend node_modules):
docker compose rm -f -s web api
docker volume rm aipeer-node-modules-cache
docker compose up -d --build api web
```

---

#### 🔄 Mode 2: Live-Reloading Android Dev Build (Compile Once, Edit Instantly)

If you need the real phone camera (`VisionCamera`) or real 1.2 GB `llama.rn` model on your Android phone, **do not rebuild the APK after every code change.** Build the `debug` APK **once**, then stream live JavaScript updates over USB:

**1. Build & install the Debug APK once:**
```powershell
# Windows (PowerShell):
.\scripts\build-android-docker.ps1 -BuildType debug -Install

# macOS / Linux / Git Bash:
./scripts/build-android-docker.sh debug --install
```
If you are experiencing "Permission denied" issues, navigate to troubleshooting step 5.

**2. Start the Metro live-reload server:**
```powershell
# Forward Metro port (8081) and API port (8085) to your USB-connected phone:
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8085 tcp:8085

# Start API + Metro (via Docker):
docker compose up -d api web
# OR locally: cd front-end/AI-PEER && npx expo start
```
Now, whenever you edit any `.tsx` or `.ts` file (like `ai-chat.tsx` or `systemPrompt.ts`) and press Save, your phone updates in **1–2 seconds** without ever running Docker Android compilation again!

##### Mode 2 — Stop, Clear Cache & Reset Commands:
```powershell
# Stop the Metro & API servers when finished for the day:
docker compose stop web api

# Clear USB port-forwarding rules on your phone (optional):
adb reverse --remove-all

# Soft Reset (clear Metro JS bundle cache if phone shows stale JS):
docker compose restart web
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8085 tcp:8085

# Full Native Reset (only needed if you add/change native Android packages in package.json):
docker compose down
docker volume rm aipeer-gradle-cache aipeer-node-modules-cache aipeer-android-cxx-cache aipeer-android-build-cache
# macOS / Linux / Git Bash:
./scripts/build-android-docker.sh debug --install
# Windows (PowerShell):
.\scripts\build-android-docker.ps1 -BuildType debug -Install
```

---

#### 📦 Mode 3: Standalone Release APK (Self-Contained, Runs Unplugged)

No Android Studio, Java JDK, or Android SDK installations are required on your host machine. The containerized builder (`Dockerfile.android`) encapsulates OpenJDK 17, Android SDK platforms 34/35, Build Tools 34/35, NDK 26.1 & 27.0, CMake 3.22, and caches `node_modules` and C++ `.cxx` objects in fast Linux volumes.

##### On Windows (PowerShell):
```powershell
# Standard release build:
.\scripts\build-android-docker.ps1

# Build AND automatically install + reverse port + launch on connected phone:
.\scripts\build-android-docker.ps1 -Install
```

##### On macOS / Linux / Git Bash:
```bash
# Standard release build:
./scripts/build-android-docker.sh

# Build AND automatically install + reverse port + launch on connected phone:
./scripts/build-android-docker.sh --install
```

##### Or Direct Docker Compose Command:
```bash
docker compose run --rm android-builder
```
**Unless something specifically prompts you to use this one, don't.**

##### Mode 3 — Stop & Reset Commands:
```powershell
# Stop an in-progress Android build (or stop all running containers):
docker compose stop

# Full Reset of Android Build Caches (wipes Gradle, C++ .cxx, build outputs, and node_modules volumes):
docker compose down
docker volume rm aipeer-gradle-cache aipeer-node-modules-cache aipeer-android-cxx-cache aipeer-android-build-cache

# Rebuild the Android Builder Docker image from scratch (if Dockerfile.android changed):
docker compose build --no-cache android-builder
```

##### What Happens During the Build:
1. Docker builds the compilation container and caches it locally.
2. Source files are mounted, while `node_modules`, Gradle caches, and C++ `.cxx` build outputs are persisted in fast Linux Docker volumes (`aipeer-node-modules-cache`, `aipeer-gradle-cache`, `aipeer-android-cxx-cache`, `aipeer-android-build-cache`) so subsequent builds only take a few minutes.
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
**DO NOT USE THE RECOMMENDATION MADE BY THE CONTAINER**

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
  - AI-PEER enforces `CMAKE_BUILD_PARALLEL_LEVEL=4` and Gradle `--max-workers=4` / `-Dorg.gradle.workers.max=4` by default to balance speed and memory usage.
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

### 5. Script Execution Permissions (Windows PowerShell & Linux / macOS)
- **Windows PowerShell (`running scripts is disabled on this system`):**
  Run with the bypass flag:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\build-android-docker.ps1
  ```
- **Linux / macOS (`Permission denied` or `sudo: ./scripts/...: command not found`):**
  Ensure the `.sh` scripts have executable permissions set:
  ```bash
  chmod +x scripts/*.sh front-end/AI-PEER/scripts/*.sh
  ```
  *(Tip for Linux users: To run `docker` and `./scripts/build-android-docker.sh` without `sudo`, add your user to the `docker` group via `sudo usermod -aG docker $USER` and log out/in).*

### 6. Rebuilding containers without cache
If dependencies in `package.json` or Dockerfiles change:
```bash
docker compose build --no-cache api
docker compose build --no-cache android-builder
```

### 7. Cleaning Gradle / Node / C++ cache volumes (Nuclear Reset)
If you change native dependencies in `package.json` and need to reset all persistent Docker containers and build volumes from scratch:
```bash
docker compose down -v
```
*(Or to remove specific named cache volumes individually):*
```bash
docker volume rm aipeer-gradle-cache aipeer-node-modules-cache aipeer-android-cxx-cache aipeer-android-build-cache
```

### 8. "Unable to load script" Red Screen on Android
- **Cause:** You installed `app-debug.apk` instead of `app-release.apk`. Debug APKs do not embed the JavaScript bundle and expect to load code dynamically from a local Metro dev server (`localhost:8081`).
- **Solution (Standalone Testing - Least Overhead):** Build and install the default release APK:
  ```powershell
  .\scripts\build-android-docker.ps1
  adb install -r build-output/app-release.apk
  ```
- **Solution (Live Metro Development):** Forward port 8081 and start the `web` Metro container:
  ```powershell
  adb reverse tcp:8081 tcp:8081
  docker compose up -d web
  ```

### 9. "Network request failed" or Login Timeout on Physical Android Phone
- **Cause:** When the app runs on a physical device, `http://localhost:8085` connects to loopback on the phone itself, not the Docker container running on your host computer.
- **Solution (USB Connected):** Forward port 8085 from the host machine to your device:
  ```powershell
  adb reverse tcp:8085 tcp:8085
  ```
- **Solution (Wi-Fi):** Set `EXPO_PUBLIC_API_BASE_URL` in `front-end/AI-PEER/.env` to your host computer's local Wi-Fi IP (e.g., `http://192.168.1.150:8085`), then recompile the APK with `.\scripts\build-android-docker.ps1`.

### 10. System Clock Skew (`Release file ... is not valid yet` or SSL / Auth Errors)
- **Cause:** Dual-booting Windows and Linux or waking a laptop/WSL2 VM from sleep can leave the system clock behind real UTC time. While `Dockerfile.android` ignores `apt` date checks automatically, large clock drift can still cause HTTPS certificate or Firebase token validation errors.
- **Solution (Linux):** Enable network time synchronization:
  ```bash
  sudo timedatectl set-ntp true
  ```
- **Solution (Windows WSL2):** Resync the WSL2 kernel clock from PowerShell:
  ```powershell
  wsl -d docker-desktop -e hwclock -s
  ```
