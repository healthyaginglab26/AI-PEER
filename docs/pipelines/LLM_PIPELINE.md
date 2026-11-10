# AI-PEER LLM Pipeline

Deep-dive reference for the on-device LLM path. Audience: senior design team members
doing LLM or chat work. Covers every layer from app launch to model download to chat
message to streamed response, plus a guide for safely swapping the model or adjusting
the system prompt.

---

## Overview

AI-PEER runs its language model entirely on-device. On first launch the AI Chat screen
detects that no model file exists, shows `ModelDownloadModal`, and — after the user
consents — calls the backend to obtain a 1-hour signed GCS URL and streams the
~1.2 GB GGUF file straight to the device's document directory. Every subsequent launch
skips the download: `LLMContext` checks the file on disk and calls `LLMService.initialize()`
to load the weights into llama.rn. When the user sends a message, `LLMService.generate()`
constructs a full ChatML prompt (system prompt + conversation history + user turn) and calls
llama.rn's `completion()` with a streaming token callback, progressively rendering sanitized
tokens into the assistant chat bubble in real time. Text-to-speech
is available in the app via `src/tts.ts:speak`, but as of the current codebase the AI Chat
screen does not invoke it — TTS is used by the vision pipeline for exercise countdowns and
rep announcements only. All inference is local: user messages never leave the device.

---

## Model Lifecycle

### First-launch download

`app/(tabs)/ai-chat.tsx:64-68` — on mount, if `needsDownload` is true the screen sets
`showDownloadModal = true`, which surfaces `ModelDownloadModal`. The modal displays the
file size (read from `getModelSizeMB()`) and a Wi-Fi warning. When the user taps Download,
`handleStartDownload` (`ai-chat.tsx:83-93`) calls `downloadAndInit()` from `useLLM`:

```ts
const downloadAndInit = useCallback(async (): Promise<void> => {
  if (!state.isModelDownloaded) {
    await startDownload();
  }
  await initializeModel();
}, [state.isModelDownloaded, startDownload, initializeModel]);
```
(`src/llm/useLLM.ts:105-110`)

`startDownload` (`LLMContext.tsx:181-201`) calls `downloadModel(token, onProgress)` from
`modelDownloader.ts`, passing the Firebase auth token and a progress callback that drives
the modal's progress bar.

### Signed URL from the API

`modelDownloader.ts:94` calls `api.getModelURL(token)`, which hits `GET /model/getModelURL`.
The route is mounted in `API/routes/modelRoutes.js:7`:

```js
router.get("/getModelURL", model.getModelURL);
```

`API/controllers/modelController.js:8-26` generates a signed URL via `generateSignedUrl`:

```js
const Model_ID = 'models/Qwen3.5-2B-aipeer-Q4_K_M.gguf';
const signedURL = await generateSignedUrl(Model_ID, MODEL_BUCKET);
res.json({ modelUrl: signedURL, filename: 'Qwen3.5-2B-aipeer-Q4_K_M.gguf', expiresIn: 3600 });
```

The signed URL expires in 1 hour. The GCS bucket is `qwenfinetune` (override via
`GCS_MODEL_BUCKET` env var). The returned URL is used immediately and is not cached.

### Expected filename and disk location

`src/llm/config.ts:19-22`:

```ts
export const MODEL_FILENAME = 'Qwen3.5-2B-aipeer-Q4_K_M.gguf';
export const MODEL_SIZE_BYTES = 1215 * 1024 * 1024;  // ~1.2 GB
```

`getModelPath()` (`modelDownloader.ts:25-27`) returns:
```
{documentDirectory}Qwen3.5-2B-aipeer-Q4_K_M.gguf
```
`documentDirectory` is the Expo FileSystem document directory — sandboxed to the app,
persists across app restarts, and survives OS upgrades.

### Cache check

`isModelDownloaded()` (`modelDownloader.ts:30-47`) calls `getInfoAsync` on the path.
If the file exists but is smaller than `MODEL_SIZE_BYTES * 0.9` (i.e., less than 90% of
expected 1.2 GB), the file is treated as a corrupt or partial download and deleted so the
downloader will start fresh on the next call.

### Resumable download

`createDownloadResumable` from `expo-file-system/legacy` (`modelDownloader.ts:101-112`)
streams the file directly to disk without loading into memory and reports
`totalBytesWritten / totalBytesExpectedToWrite` on each progress tick. If the download
throws, the partial file is deleted (`modelDownloader.ts:124-125`). The current
implementation does not persist the `DownloadResumable` object to AsyncStorage, so a
mid-download app kill restarts from zero on next launch. However, `isModelDownloaded()`'s
90% threshold means that if the partial file is large enough to pass the check on a
subsequent launch (possible if the kill was very late), the bad file is accepted —
see the Gotchas section.

### Old model cleanup

Before each download, `cleanupOldModels()` (`modelDownloader.ts:56-65`) iterates
`OLD_MODEL_FILENAMES` (currently `['Qwen3-0.6B-Q4_K_M.gguf', 'Qwen3.5-0.8B-aipeer-Q4_K_M.gguf']`)
and deletes any that exist on disk, freeing space for the current model.

### Ready-to-load flag

After `downloadModel` resolves, `LLMContext.tsx:191` sets `isModelDownloaded: true`. The
`needsInit` flag in `useLLM.ts:45` becomes true (`isModelDownloaded && !isModelLoaded`),
which triggers the `useEffect` at `ai-chat.tsx:71-75` to call `initializeModel()`.

### Load-time: GGUF into llama.rn

`LLMService.initialize()` (`LLMService.ts:73-111`) calls `llamaModule.initLlama`:

```ts
this.context = await llamaModule.initLlama({
  model: modelPath,
  n_ctx: INFERENCE_CONFIG.contextSize,   // 2048 tokens
  n_threads: 4,
  n_gpu_layers: 0,                        // CPU-only
});
```

`contextSize` is set at `config.ts:39`. Four CPU threads, no GPU offload (`n_gpu_layers: 0`).
This keeps the build simple and avoids the Metal/ANE allocation failures that can occur on
older iPhones with limited GPU memory. The comment in `LLMService.ts:100` reads
"CPU-only for broad compatibility." Load time is commented as "~5-10 seconds"
(`LLMService.ts:71`); the elapsed time is logged to the console.

---

## Inference Path (One Chat Message)

**1. User taps Send** (`app/(tabs)/ai-chat.tsx:96-106`)

`handleSend` trims the input, guards against an empty string / model not ready / already
generating, clears the `TextInput`, and calls `send(trimmed)`. The send button is disabled
while `isGenerating` is true, preventing double-submission.

**2. `useLLM.send` delegates to context** (`src/llm/useLLM.ts:94-98`)

`send` is a thin wrapper that calls `sendMessage(content)` from `useLLMContext`.

**3. `LLMContext.sendMessage` builds state** (`src/llm/LLMContext.tsx:227-295`)

The user message is appended to `conversation.messages` immediately — before the model
responds — so the bubble appears in the chat while generation runs. `isGenerating` is
set to `true`. Then `LLMService.generate(updatedMessages)` is awaited.

**4. `LLMService.generate` formats the prompt** (`src/llm/LLMService.ts:119-163`)

`formatPrompt` from `systemPrompt.ts` is called with the full message array:

```ts
const prompt = formatPrompt(
  messages.map((m) => ({ role: m.role, content: m.content }))
);
```

Then `this.context.completion(...)` is called with:
- `prompt` — the full ChatML string (including an empty `<think>\n\n</think>\n\n` prefill to bypass Qwen3.5 chain-of-thought latency)
- `n_predict: INFERENCE_CONFIG.maxTokens` (150)
- `temperature: 0.7`, `top_p: 0.9`, `penalty_repeat: 1.15`
- `stop: ['<|im_end|>', '<|im_start|>']`

`completion()` streams tokens via its callback parameter (`onToken`), calling `sanitizeStreamedText()` on the accumulated output so partial control tags or `<think>...</think>` blocks are never shown in the UI. Once generation finishes, `LLMService.generate()` logs total duration and throughput (`tokens/sec` from `result.timings.predicted_per_second`).

**5. Response cleanup** (`LLMService.ts:144-157`)

Qwen3.5 can output `<think>...</think>` chain-of-thought reasoning before the actual
answer (thinking mode). The service strips it:

```ts
const thinkEndIndex = text.indexOf('</think>');
if (thinkEndIndex !== -1) {
  text = text.slice(thinkEndIndex + 8).trim();
}
```

Any trailing `<|im_end|>` marker is also stripped.

**6. Assistant message persisted** (`LLMContext.tsx:263-280`)

The cleaned response string is wrapped in a `ChatMessage` object (role `'assistant'`,
`timestamp: Date.now()`) and merged into the conversation in `allConversations`. The
`useEffect` at `LLMContext.tsx:161-168` auto-saves the entire conversations array to
AsyncStorage under `STORAGE_KEYS.conversations` (`'aipeer_conversations'`) whenever
it changes.

**7. `isGenerating` cleared** (`LLMContext.tsx:291`)

The `finally` block sets `isGenerating: false`, re-enabling the send button.

**8. TTS**

`src/tts.ts:speak` exists and is used by the vision pipeline for exercise countdowns and
rep announcements. The AI Chat screen does not currently call `speak()` after receiving a
response. If TTS read-aloud for chat responses is added in the future, the correct call
site is after `LLMService.generate()` resolves in `LLMContext.sendMessage`, using
`speak(response)` from `src/tts.ts`.

---

## The PEER Framework System Prompt

`src/llm/systemPrompt.ts` defines two exports: `SYSTEM_PROMPT` (the raw string) and
`formatPrompt` (the ChatML formatter). The prompt establishes the model's identity,
behavioral rules, and output style.

**Role:** The model is told it is "AI-PEER — the calm, focused coach inside the PEER
fall-prevention exercise program for older adults." It is explicitly not a generic
wellness chatbot; every response must serve the user's PEER journey.

**Length and repetition rules (critical for on-device UX):**
```
Maximum 3 sentences per response. Period.
Never repeat the same idea twice in a single response.
```
These rules exist because the 2B model, without constraints, tends to pad responses to
the full 512-token budget.

**Forbidden patterns:** The prompt explicitly bans phrases like "I'm glad you reached
out," "I believe that you can do this," "Take this time to," and trailing off into
unrelated topics. It also bans emojis and unsolicited URLs.

**Style anchor:** Every answer must reference PEER by name — "your PEER program," "today's
PEER session," "your next PEER exercise" — and name which PEER category an exercise
belongs to (warmup, strength, balance, or assessment).

**Medical guardrail:**
```
You are not a medical professional. For symptoms, pain, injuries, or medication
questions, redirect to their healthcare provider in one sentence.
```

**Focus areas:** Fall prevention, PEER exercise guidance, and emotional support for
users who express fear of falling. Example responses in the prompt cover: greeting,
fear acknowledgment, chest pain redirection, exercise instruction, and fatigue handling.

**ChatML formatting** (`systemPrompt.ts:66-83`): `formatPrompt` wraps the system prompt
with `<|im_start|>system` / `<|im_end|>`, then interleaves `<|im_start|>user` and
`<|im_start|>assistant` blocks for each turn. The final line is
`<|im_start|>assistant\n<think>\n\n</think>\n\n` (prefilling an empty think block) to
signal that the model should respond immediately without spending tokens on hidden
chain-of-thought reasoning.

Note from the training plan: the inference-time system prompt intentionally diverges from
the training-time one in `Training/slm/finetune.py`. The training prompt is a historical
record; the inference prompt is the active iteration surface. Tone changes and new guardrails
belong here, not in a re-training run.

---

## Chat History Storage

All conversation state is stored locally — nothing is sent to the backend or Firestore.

**Storage layer:** AsyncStorage, via `LLMContext.tsx:163-168`. Two keys are used:

| Key | Value |
|---|---|
| `aipeer_conversations` | JSON array of `Conversation[]` |
| `aipeer_current_conversation` | String ID of the active conversation |

(`config.ts:46-49`)

**`Conversation` shape** (`types.ts:19-25`):

| Field | Description |
|---|---|
| `id` | Base-36 + random string (generated by `generateId()`) |
| `createdAt` | Unix ms |
| `lastMessageAt` | Unix ms (updated on each message) |
| `messages` | `ChatMessage[]` (role + content + timestamp) |

**24-hour TTL:** `isConversationExpired` (`LLMContext.tsx:79-81`) returns true if
`Date.now() - conversation.lastMessageAt > CONVERSATION_TTL_MS` (24 hours). Expired
conversations are filtered out on init; if all conversations have expired, a fresh one
is created automatically.

**Listing conversations:** `app/chat-history.tsx` reads `conversations` from `useLLM`,
sorted by `lastMessageAt` descending (`useLLM.ts:81-83`). Each card shows a preview
(first user message, truncated to 50 characters) and a relative timestamp ("2 hours
ago," "Yesterday").

**Delete:** Soft in UI — the user taps the trash icon on a `ConversationCard`, an
`Alert.alert` confirm dialog fires, and on confirm `remove(id)` calls
`deleteConversation(id)` in context (`LLMContext.tsx:320-341`), which filters the
conversation out of `allConversations`. The subsequent `useEffect` persists the new
array to AsyncStorage, overwriting the old one. There is no hard-delete / server-side
path; history never leaves the device.

---

## Model Format and Swapping

### GGUF and quantization

GGUF (GPT-Generated Unified Format) is the on-disk format for llama.cpp-family runtimes,
including llama.rn. It packages weights, tokenizer vocabulary, and model metadata in a
single binary. Q4_K_M quantization maps each weight to 4 bits using a "K-quant medium"
scheme that balances perplexity loss against size. For Qwen3.5-2B, this reduces a ~5 GB
BF16 checkpoint to ~1.2 GB, which fits on a modern iPhone without exhausting RAM.
llama.rn on iOS loads the GGUF via the Metal-backed llama.cpp; the current build sets
`n_gpu_layers: 0` (CPU-only), so no Metal kernels are used.

### Current model

Base: `Qwen/Qwen3.5-2B` (instruction-tuned by default; note the 3.5 lineage dropped the
`-Instruct` suffix). Fine-tuned on `YsK-dev/geriatric-health-advice` using 4-bit QLoRA.
Quantized to Q4_K_M GGUF. Shipped filename: `Qwen3.5-2B-aipeer-Q4_K_M.gguf`.
GCS path: `gs://qwenfinetune/models/Qwen3.5-2B-aipeer-Q4_K_M.gguf`.

### How to swap the model

1. **Train and export.** Follow `Training/slm/TRAINING_PLAN.md`. The export produces
   `Qwen3.5-2B.Q4_K_M.gguf`; rename it to the new app filename during `scp`.

2. **Upload to GCS.**
   ```bash
   gsutil cp <local>.gguf gs://qwenfinetune/models/<new-filename>.gguf
   ```

3. **Update `API/controllers/modelController.js:9`.** Change `Model_ID` to match the
   new GCS object path.

4. **Update `front-end/AI-PEER/src/llm/config.ts`.**
   - Set `MODEL_FILENAME` to the new filename.
   - Set `MODEL_SIZE_BYTES` to the actual file size (get from `gsutil ls -l`).
   - Move the old `MODEL_FILENAME` into `OLD_MODEL_FILENAMES` so it is deleted from
     devices on next launch.

5. **Redeploy the API** (Cloud Run, region `us-central1`):
   ```bash
   cd API && gcloud run deploy aipeer-api --source . --region us-central1 \
     --no-invoker-iam-check \
     --service-account "munish@research-ai-peer-dev.iam.gserviceaccount.com"
   ```

6. **Test.** On a device that has the old model, open AI Chat and confirm the old file
   is cleaned up and the new download starts. Run a short conversation that exercises:
   a greeting, a fall-fear response, a medical question (must redirect), and an exercise
   instruction request. Check Metro logs for the `LLM initialized` message and the
   `Generated N chars in Xms` line.

---

## Model Fine-tuning (Handoff)

`Training/slm/TRAINING_PLAN.md` is the complete guide for re-training the model.
It covers: the `YsK-dev/geriatric-health-advice` dataset (10,813 rows, Apache 2.0),
the QLoRA recipe (4-bit, rank 16, 3 epochs via unsloth on a CUDA GPU), the reference
run results (RTX 5090, 2h 11m, final eval_loss 0.1286), known setup gotchas for
Blackwell GPUs and `libnvJitLink.so.13`, the GGUF export commands, and the full
ship-to-device procedure including the GCS upload and API/config changes. Go there
when you need to retrain from a new base model, fine-tune on a new dataset, or
change the training-time system prompt.

---

## Performance and Device Considerations

**Inference speed.** The `LLMService.generate` method logs
`Generated N chars in Xms (Y.Z tokens/sec)` using `result.timings.predicted_per_second`. With `n_gpu_layers: 0` on a modern phone, expect
roughly 8-12 tokens/sec; older devices will be slower. The 150-token
cap (`INFERENCE_CONFIG.maxTokens`) and empty `<think></think>` prefill keep responses fast and concise on typical hardware.

**Memory.** The comment at `LLMService.ts:6` describes the model as "~1.2GB" in memory.
`initialize()` is commented as taking "~5-10 seconds" (`LLMService.ts:71`). On devices
with less than ~2.5 GB of available RAM (iPhone 8 or older, or a heavily loaded device),
`initLlama` may throw an OOM error. The `catch` block in `LLMService.initialize()` rethrows,
which propagates to `initializeModel` in `LLMContext.tsx:215-220`, which sets
`state.error` and rethrows. The AI Chat screen renders the error string from `useLLM().error`
in the subtitle row.

**Context window.** `n_ctx: 2048` tokens (~1,500 words). No explicit truncation is
implemented in the current code — if `conversation.messages` grows long enough that
the formatted ChatML prompt exceeds 2048 tokens, llama.rn will silently truncate the
front of the context.

**Thermal throttling.** `n_gpu_layers: 0` avoids the GPU, so the main thermal vector
is the 4 CPU cores held at near-100% during generation. The app does not implement
explicit thermal-state monitoring or graceful degradation. In practice, iOS will clock
down the CPUs under thermal pressure, which increases generation time but does not crash
the model context.

**Low battery.** No special handling. The model context persists as long as the process
lives; the singleton pattern (`LLMService.getInstance()`) means the context is not
released between navigations.

---

## Known Gotchas

**Signed URL expiry during download.** The signed URL has a 1-hour TTL
(`modelController.js:13`, `expiresIn: 3600`). The URL is fetched immediately before the
download starts (`modelDownloader.ts:93-94`), so a slow download (1.2 GB on a congested
connection) can time out partway through. `createDownloadResumable.downloadAsync()` will
throw with a network error, the partial file is deleted (`modelDownloader.ts:124-125`),
and the `LLMContext` sets `state.error`. The `ModelDownloadModal` shows a Retry button
which re-fetches a fresh signed URL. For full diagnosis steps, see the
"Model download hangs or returns an invalid GGUF" entry in `TROUBLESHOOTING.md`.

**Partial file passing the 90% threshold.** A force-quit at exactly >90% completion
leaves a file large enough to pass `isModelDownloaded()` but too truncated to be a valid
GGUF. `initLlama` will fail with a parse error. The fix is the same as above: clear app
data or delete the document-directory file and restart.

**Model loading UI.** While `initializeModel()` runs (the 5-10 second llama.rn load),
the chat header shows `t("ai-chat.loadingModel")` as the subtitle
(`ai-chat.tsx:136-143`) and the `TextInput` is disabled (`ai-chat.tsx:243`). There is no
full-screen loading overlay; the screen is usable but the input is grayed out. This is
the expected design.

**Token streaming and AsyncStorage persistence.** `llama.rn`'s `completion()` streams tokens in real time into the placeholder assistant message in `LLMContext.sendMessage`. While `state.isGenerating` is `true`, `LLMContext` skips writing `allConversations` to `AsyncStorage` on every token tick and persists once generation finishes.

**Singleton survives navigation but not process kill.** The `LLMService` singleton
persists across tab navigations, so navigating away from AI Chat and back does not reload
the model. A hard app kill (swipe up in the app switcher) destroys the process; on
next launch `LLMService.isReady()` returns false and `needsInit` becomes true, triggering
a fresh `initializeModel()` call.

**Qwen3 thinking tags.** Qwen3.5-2B can emit `<think>...</think>` prefixes even without
explicit thinking mode prompting. The strip logic in `LLMService.ts:148-152` handles this,
but if a future model changes the tag format, responses will leak raw reasoning text into
the chat bubble. Check the `thinkEndIndex` logic when upgrading the base model.

---

## Sequence Diagram — First Chat Message After App Launch

```
User                    App (React Native)                   API / GCS
 |                             |                                  |
 |-- cold launch ------------->|                                  |
 |                             |-- LLMContext init effect         |
 |                             |   isModelDownloaded() → false    |
 |                             |   (LLMContext.tsx:105-158)       |
 |                             |                                  |
 |-- taps AI Chat tab -------->|                                  |
 |                             |-- ai-chat.tsx mounts             |
 |                             |   needsDownload = true           |
 |                             |   showDownloadModal = true       |
 |                             |   (ai-chat.tsx:64-68)            |
 |                             |                                  |
 |<-- ModelDownloadModal -------|                                  |
 |   (components/ModelDownloadModal.tsx)                          |
 |                             |                                  |
 |-- taps Download ----------->|                                  |
 |                             |-- handleStartDownload()          |
 |                             |   downloadAndInit()              |
 |                             |   (ai-chat.tsx:83-93)            |
 |                             |                                  |
 |                             |-- api.getModelURL(token) ------->|
 |                             |   (modelDownloader.ts:94)        |
 |                             |   GET /model/getModelURL         |
 |                             |                              (modelController.js:8-26)
 |                             |<-- { modelUrl, expiresIn:3600 } -|
 |                             |                                  |
 |                             |-- createDownloadResumable(       |
 |                             |   modelUrl, modelPath)           |
 |                             |   .downloadAsync()               |
 |                             |   (modelDownloader.ts:101-115)   |
 |<-- progress bar updates ----|   (streams ~1.2 GB to disk)  --->|
 |                             |                                  |
 |                             |-- isModelDownloaded: true        |
 |                             |   (LLMContext.tsx:191)           |
 |                             |                                  |
 |                             |-- initializeModel()              |
 |                             |   LLMService.initialize()        |
 |                             |   initLlama({ n_ctx:2048,        |
 |                             |     n_threads:4, n_gpu_layers:0 })|
 |                             |   (LLMService.ts:96-101)         |
 |<-- model loads (~5-10s) ----|                                  |
 |   header: "Ask AI"          |-- isModelLoaded: true            |
 |   TextInput enabled         |   (LLMContext.tsx:214)           |
 |                             |                                  |
 |-- types message, taps Send->|                                  |
 |                             |-- handleSend()                   |
 |                             |   send(trimmed)                  |
 |                             |   (ai-chat.tsx:96-106)           |
 |                             |                                  |
 |<-- user bubble appears -----|-- user message + placeholder     |
 |   streaming bubble starts   |   assistant bubble appended      |
 |                             |   isGenerating = true            |
 |                             |   (LLMContext.tsx:244-256)       |
 |                             |                                  |
 |                             |-- LLMService.generate(messages)  |
 |                             |   formatPrompt() →               |
 |                             |   <|im_start|>system…            |
 |                             |   (systemPrompt.ts:66-83)        |
 |                             |                                  |
 |                             |-- context.completion({           |
 |                             |   prompt, n_predict:150,         |
 |                             |   temperature:0.7, top_p:0.9,    |
 |                             |   penalty_repeat:1.15,           |
 |                             |   stop:['<|im_end|>',…]}, onToken)|
 |                             |   [streams tokens — on-device]   |
 |                             |                                  |
 |                             |-- strip <think>…</think> if any  |
 |                             |   (LLMService.ts:148-152)        |
 |                             |                                  |
 |<-- assistant bubble --------|-- assistant message appended     |
 |   ActivityIndicator hidden  |   allConversations updated       |
 |                             |   AsyncStorage.setItem(          |
 |                             |   'aipeer_conversations', …)     |
 |                             |   (LLMContext.tsx:161-168)       |
 |                             |   isGenerating = false           |
```

TTS is not invoked by the AI Chat path in the current codebase. If read-aloud is added,
the `speak(response)` call from `src/tts.ts` should be placed immediately after
`LLMService.generate()` resolves in `LLMContext.tsx:260`.

---

## Related Files

- `front-end/AI-PEER/src/llm/LLMContext.tsx` — React context; owns download state,
  model-loaded flag, conversation array, and all actions exposed to UI.
- `front-end/AI-PEER/src/llm/useLLM.ts` — Component-facing hook; derives `needsDownload`,
  `needsInit`, `isReady`, `isGenerating`; provides `send`, `downloadAndInit`, multi-conversation actions.
- `front-end/AI-PEER/src/llm/LLMService.ts` — Singleton wrapping llama.rn; owns the
  `LlamaContext` instance; exposes `initialize()`, `generate()`, `release()`.
- `front-end/AI-PEER/src/llm/systemPrompt.ts` — `SYSTEM_PROMPT` string and `formatPrompt`
  ChatML formatter.
- `front-end/AI-PEER/src/llm/modelDownloader.ts` — Signed-URL fetch, resumable download,
  cache check, old-model cleanup.
- `front-end/AI-PEER/src/llm/config.ts` — `MODEL_FILENAME`, `MODEL_SIZE_BYTES`,
  `OLD_MODEL_FILENAMES`, `INFERENCE_CONFIG`, `CONVERSATION_TTL_MS`, `STORAGE_KEYS`.
- `front-end/AI-PEER/src/llm/types.ts` — `ChatMessage`, `Conversation`, `LLMState`,
  `InferenceConfig` type definitions.
- `front-end/AI-PEER/src/llm/index.ts` — Public module barrel export.
- `front-end/AI-PEER/app/(tabs)/ai-chat.tsx` — AI Chat screen; mounts the modal, renders
  the message list and input row, calls `useLLM`.
- `front-end/AI-PEER/app/chat-history.tsx` — Conversation list screen; lists, selects,
  creates, and deletes conversations via `useLLM`.
- `front-end/AI-PEER/components/ModelDownloadModal.tsx` — Download consent modal with
  progress bar and error/retry state.
- `API/controllers/modelController.js` — `getModelURL` handler; calls `generateSignedUrl`
  and returns `{ modelUrl, filename, expiresIn }`.
- `API/routes/modelRoutes.js` — Mounts `GET /getModelURL` on the `/model` prefix.
- `front-end/AI-PEER/src/tts.ts` — `speak()` wrapper over `expo-speech`; handles locale
  fallback (`ht` → `fr-FR`). Not currently called by AI Chat.
- `Training/slm/TRAINING_PLAN.md` — Dataset, QLoRA recipe, reference run, GGUF export,
  GCS upload, and app/API update procedure for shipping a new model.
