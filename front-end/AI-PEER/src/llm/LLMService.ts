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
 * - Text generation (inference)
 * - Cleanup (releasing memory)
 *
 * Model: Qwen3.5-2B (non-thinking mode, finetuned on YsK-dev/geriatric-health-advice, Apache 2.0)
 */

import { Platform } from 'react-native';
import { INFERENCE_CONFIG } from './config';
import { getModelPath } from './modelDownloader';
import { formatPrompt } from './systemPrompt';
import { ChatMessage } from './types';

type LlamaContextLike = {
  completion: (params: {
    prompt: string;
    n_predict: number;
    temperature: number;
    top_p: number;
    stop: string[];
  }) => Promise<{ text: string }>;
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

    if (process.env.EXPO_PUBLIC_MOCK_LLM === 'true' || Platform.OS === 'web') {
      console.log('[MOCK LLM] Initializing lightweight mock LLM service');
      this.context = {
        completion: async () => ({
          text: "Hello! I am your AI PEER exercise assistant running in offline local mode. For balance exercises like Knee Bends and Single Leg Stands, remember to keep a stable support nearby, look straight ahead, and move at a controlled pace."
        }),
        release: async () => {
          this.context = null;
        }
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
   * Generate a response from the LLM
   *
   * @param messages - Conversation history (user and assistant messages)
   * @returns The generated response text
   */
  async generate(messages: ChatMessage[]): Promise<string> {
    if (!this.context) {
      throw new Error('LLM not initialized. Call initialize() first.');
    }

    // Format messages into prompt
    const prompt = formatPrompt(
      messages.map((m) => ({ role: m.role, content: m.content }))
    );

    console.log('Generating response...');
    const startTime = Date.now();

    try {
      const result = await this.context.completion({
        prompt,
        n_predict: INFERENCE_CONFIG.maxTokens,
        temperature: INFERENCE_CONFIG.temperature,
        top_p: INFERENCE_CONFIG.topP,
        stop: ['<|im_end|>', '<|im_start|>'], // Stop at chat markers
      });

      const elapsed = Date.now() - startTime;
      console.log(`Generated ${result.text.length} chars in ${elapsed}ms`);

      // Clean up the response
      let text = result.text.trim();

      // Remove Qwen3 thinking tags (model outputs <think>reasoning</think> before response)
      const thinkEndIndex = text.indexOf('</think>');
      if (thinkEndIndex !== -1) {
        text = text.slice(thinkEndIndex + 8).trim();
      }

      // Remove any trailing chat markers
      if (text.endsWith('<|im_end|>')) {
        text = text.slice(0, -10).trim();
      }

      return text;
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
