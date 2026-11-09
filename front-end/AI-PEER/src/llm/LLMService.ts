/**
 * LLMService.ts - Singleton service for llama.rn
 *
 * Why a Singleton?
 * - Loading a ~1.2GB model into memory is expensive (several seconds)
 * - We want ONE instance that persists across component unmounts
 * - Prevents accidentally loading multiple copies (memory explosion)
 *
 * This class handles:
 * - Model initialization (loading into memory)
 * - Text generation (inference) with real-time token streaming
 * - Cleanup (releasing memory)
 *
 * Model: Qwen3.5-2B (non-thinking mode, finetuned on YsK-dev/geriatric-health-advice, Apache 2.0)
 */

import { Platform } from 'react-native';
import { INFERENCE_CONFIG } from './config';
import { getModelPath } from './modelDownloader';
import { formatPrompt } from './systemPrompt';
import { ChatMessage } from './types';

type TokenCallbackData = {
  token: string;
};

type LlamaContextLike = {
  completion: (
    params: {
      prompt: string;
      n_predict: number;
      temperature: number;
      top_p: number;
      penalty_repeat?: number;
      stop: string[];
    },
    callback?: (data: TokenCallbackData) => void
  ) => Promise<{ text: string; timings?: { predicted_per_second?: number } }>;
  release: () => Promise<void>;
};

type LlamaModule = {
  initLlama: (params: {
    model: string;
    n_ctx: number;
    n_threads: number;
    n_gpu_layers: number;
  }) => Promise<LlamaContextLike>;
};

const STOP_MARKERS = ['<|im_end|>', '<|im_start|>'];
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * Strip trailing partial control tag prefixes (e.g. "<", "<|", "<|im", "</", "</think")
 * so raw marker fragments never flash at the end of the chat bubble while streaming.
 */
function stripTrailingPartialTag(text: string): string {
  const tagsToGuard = [...STOP_MARKERS, THINK_OPEN, THINK_CLOSE];
  for (const tag of tagsToGuard) {
    for (let len = tag.length - 1; len >= 1; len--) {
      const prefix = tag.slice(0, len);
      if (text.endsWith(prefix)) {
        return text.slice(0, -len);
      }
    }
  }
  return text;
}

/**
 * Filter raw accumulated tokens during streaming so <think>...</think> blocks
 * and <|im_end|> / <|im_start|> markers never appear in the UI.
 */
export function sanitizeStreamedText(rawText: string): string {
  let text = rawText.trimStart();
  if (!text) return '';

  // 1. If the output is still typing the opening "<think>" tag itself, buffer it
  if (THINK_OPEN.startsWith(text)) {
    return '';
  }

  // 2. If a <think> block opened, hide everything until </think> is complete
  const thinkStartIdx = text.indexOf(THINK_OPEN);
  if (thinkStartIdx !== -1) {
    const thinkCloseIdx = text.indexOf(THINK_CLOSE, thinkStartIdx + THINK_OPEN.length);
    if (thinkCloseIdx === -1) {
      // Still inside <think>... waiting for </think>
      return stripTrailingPartialTag(text.slice(0, thinkStartIdx)).trimStart();
    }
    text = (
      text.slice(0, thinkStartIdx) +
      text.slice(thinkCloseIdx + THINK_CLOSE.length)
    ).trimStart();
  }

  // 3. Also handle case where </think> appears without an explicit opening <think>
  const strayThinkCloseIdx = text.indexOf(THINK_CLOSE);
  if (strayThinkCloseIdx !== -1) {
    text = text.slice(strayThinkCloseIdx + THINK_CLOSE.length).trimStart();
  }

  // 4. Cut off at any complete stop marker (<|im_end|> or <|im_start|>)
  for (const marker of STOP_MARKERS) {
    const markerIdx = text.indexOf(marker);
    if (markerIdx !== -1) {
      text = text.slice(0, markerIdx);
    }
  }

  // 5. Strip any trailing partial tag fragment at the end of the stream
  text = stripTrailingPartialTag(text);

  return text;
}

/**
 * Clean up the final completed response text.
 */
export function sanitizeFinalText(rawText: string): string {
  let text = sanitizeStreamedText(rawText).trim();
  for (const marker of STOP_MARKERS) {
    if (text.endsWith(marker)) {
      text = text.slice(0, -marker.length).trim();
    }
  }
  return text;
}

class LLMService {
  private static instance: LLMService;
  private context: LlamaContextLike | null = null;
  private isInitializing = false;

  /** Private constructor enforces singleton pattern */
  private constructor() {}

  /** Get the singleton instance */
  static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  /** Check if model is loaded and ready */
  isReady(): boolean {
    return this.context !== null;
  }

  /** Check if currently initializing */
  isLoading(): boolean {
    return this.isInitializing;
  }

  /**
   * Initialize the LLM context (load model into memory)
   * This is slow (~5-10 seconds) so call it once at app start
   */
  async initialize(): Promise<void> {
    if (this.context) {
      console.log('LLM already initialized');
      return;
    }

    if (Platform.OS === 'web') {
      console.log('[MOCK LLM] Initializing lightweight mock LLM service with token streaming (Web only)');
      this.context = {
        completion: async (_params, callback) => {
          const mockVisibleReply =
            '[WEB MOCK MODE] Hello! I am your AI-PEER exercise coach. (Note: Real on-device Qwen3.5-2B C++ inference only runs on Android/iOS devices, not in a web browser.)';
          // Include a simulated <think> block and <|im_end|> stop token to verify streaming sanitization in mock mode
          const mockTokens = [
            '<think>',
            'Checking ',
            'PEER ',
            'balance ',
            'protocol...',
            '</think>\n',
            ...mockVisibleReply.match(/\S+\s*/g)!,
            '<|im_end|>',
          ];

          let fullRaw = '';
          for (const tok of mockTokens) {
            await new Promise((resolve) => setTimeout(resolve, 35));
            fullRaw += tok;
            if (callback) {
              callback({ token: tok });
            }
          }
          return { text: fullRaw };
        },
        release: async () => {
          this.context = null;
        },
      };
      return;
    }

    if (this.isInitializing) {
      console.log('LLM initialization already in progress');
      return;
    }

    this.isInitializing = true;
    const modelPath = getModelPath();

    try {
      console.log('Initializing LLM with model:', modelPath);
      const startTime = Date.now();
      const llamaModule = (await import('llama.rn')) as unknown as LlamaModule;

      this.context = await llamaModule.initLlama({
        model: modelPath,
        n_ctx: INFERENCE_CONFIG.contextSize,
        n_threads: 4, // Use 4 CPU threads for inference
        n_gpu_layers: 0, // CPU-only for broad compatibility
      });

      const elapsed = Date.now() - startTime;
      console.log(`LLM initialized in ${elapsed}ms`);
    } catch (error) {
      console.error('Failed to initialize LLM:', error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Generate a response from the LLM with optional token-by-token streaming.
   *
   * @param messages - Conversation history (user and assistant messages)
   * @param onToken - Optional callback invoked with (token, visibleTextSoFar) as tokens arrive
   * @returns The final sanitized response text
   */
  async generate(
    messages: ChatMessage[],
    onToken?: (token: string, visibleText: string) => void
  ): Promise<string> {
    if (!this.context) {
      throw new Error('LLM not initialized. Call initialize() first.');
    }

    // Format messages into prompt
    const prompt = formatPrompt(
      messages.map((m) => ({ role: m.role, content: m.content }))
    );

    console.log('Generating response...');
    const startTime = Date.now();
    let accumulatedRaw = '';
    let lastVisibleText = '';

    try {
      const result = await this.context.completion(
        {
          prompt,
          n_predict: INFERENCE_CONFIG.maxTokens,
          temperature: INFERENCE_CONFIG.temperature,
          top_p: INFERENCE_CONFIG.topP,
          penalty_repeat: 1.15,
          stop: STOP_MARKERS, // Stop at chat markers
        },
        onToken
          ? (data: TokenCallbackData) => {
              if (!data?.token) return;
              accumulatedRaw += data.token;
              const visibleText = sanitizeStreamedText(accumulatedRaw);
              if (visibleText !== lastVisibleText) {
                lastVisibleText = visibleText;
                onToken(data.token, visibleText);
              }
            }
          : undefined
      );

      const elapsed = Date.now() - startTime;
      const finalSource = result?.text ?? accumulatedRaw;
      const tps = result?.timings?.predicted_per_second;
      console.log(
        `Generated ${finalSource.length} chars in ${elapsed}ms${
          tps ? ` (${tps.toFixed(1)} tokens/sec)` : ''
        }`
      );

      const finalCleanText = sanitizeFinalText(finalSource);
      if (onToken && finalCleanText !== lastVisibleText) {
        onToken('', finalCleanText);
      }

      return finalCleanText;
    } catch (error) {
      console.error('Generation failed:', error);
      throw error;
    }
  }

  /**
   * Release the LLM context and free memory
   * Call this when the app is backgrounded or memory is low
   */
  async release(): Promise<void> {
    if (this.context) {
      console.log('Releasing LLM context');
      await this.context.release();
      this.context = null;
    }
  }
}

// Export the singleton instance
export default LLMService.getInstance();
