/**
 * types.ts - TypeScript interfaces for LLM integration
 *
 * These types define the "contract" for our data structures.
 * Having strict types catches bugs at compile time rather than runtime.
 */

/** A single message in a conversation */
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
};

/**
 * A conversation with metadata for 24-hour auto-archiving.
 * Conversations older than 24 hours get cleared to prevent context rot.
 */
export type Conversation = {
  id: string;
  createdAt: number;
  lastMessageAt: number;
  messages: ChatMessage[];
};

/** Current state of the LLM system */
export type LLMState = {
  isModelDownloaded: boolean;
  isModelLoaded: boolean;
  isGenerating: boolean;
  downloadProgress: number; // 0-100
  error: string | null;
};

/** Configuration for model inference */
export type InferenceConfig = {
  maxTokens: number;
  temperature: number;
  topP: number;
  repeatPenalty: number;
  contextSize: number;
};
