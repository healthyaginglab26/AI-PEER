/**
 * config.ts - LLM configuration constants
 *
 * Centralizing config makes it easy to:
 * - Swap models (0.6B vs 1.7B)
 * - Tune inference parameters
 * - Change URLs without hunting through code
 */

import { InferenceConfig } from './types';

/**
 * Model download URL is fetched at runtime via a signed URL from the API.
 * The API endpoint GET /model/getModelURL returns a 1-hour signed GCS URL.
 * No hardcoded URL needed -- the bucket is private.
 */

/** Filename for the downloaded model (stored in app's document directory) */
export const MODEL_FILENAME = 'Qwen3.5-2B-aipeer-Q4_K_M.gguf';

/** Expected model size in bytes (for download progress) - ~1.2GB */
export const MODEL_SIZE_BYTES = 1215 * 1024 * 1024;

/** Old model filenames to clean up when upgrading */
export const OLD_MODEL_FILENAMES = ['Qwen3-0.6B-Q4_K_M.gguf', 'Qwen3.5-0.8B-aipeer-Q4_K_M.gguf'];

/**
 * Inference configuration
 *
 * - maxTokens: Maximum response length (512 = ~400 words)
 * - temperature: Randomness (0.7 = balanced creativity/coherence)
 * - topP: Nucleus sampling (0.9 = consider top 90% probability tokens)
 * - contextSize: How much conversation history to remember (8192 tokens ≈ 6000 words)
 */
export const INFERENCE_CONFIG: InferenceConfig = {
  maxTokens: 256,
  temperature: 0.7,
  topP: 0.9,
  contextSize: 2048,
};

/** How long before conversations auto-archive (24 hours in milliseconds) */
export const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Storage keys for AsyncStorage/FileSystem */
export const STORAGE_KEYS = {
  conversations: 'aipeer_conversations',
  currentConversationId: 'aipeer_current_conversation',
};
