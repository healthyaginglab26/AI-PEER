/**
 * useLLM.ts - Simplified hook for LLM interaction
 *
 * This hook provides a clean, simple API for components.
 * It wraps the context and handles common patterns like:
 * - Checking if download/init is needed
 * - Combined loading states
 * - Easy message sending
 * - Multiple conversation management
 *
 * Usage in a component:
 *   const { isReady, needsDownload, isGenerating, messages, send } = useLLM();
 */

import { useMemo, useCallback } from 'react';
import { useLLMContext } from './LLMContext';
import { ChatMessage, Conversation } from './types';
import { useTranslation } from "react-i18next";

export function useLLM() {
  const {
    state,
    conversation,
    allConversations,
    startDownload,
    initializeModel,
    releaseModel,
    sendMessage,
    clearConversation,
    selectConversation,
    startNewConversation,
    deleteConversation,
  } = useLLMContext();
  const { t } = useTranslation();

  /**
   * Whether the model needs to be downloaded
   * Show download modal when this is true
   */
  const needsDownload = !state.isModelDownloaded;

  /**
   * Whether the model needs to be loaded into memory
   * Show loading indicator when this is true after download
   */
  const needsInit = state.isModelDownloaded && !state.isModelLoaded;

  /**
   * Whether the model is ready for chat
   * Only allow sending messages when this is true
   */
  const isReady = state.isModelDownloaded && state.isModelLoaded;

  /**
   * Whether the model is currently generating a response
   * Show typing indicator when this is true
   */
  const isGenerating = state.isGenerating;

  /**
   * Current download progress (0-100)
   */
  const downloadProgress = state.downloadProgress;

  /**
   * Current error message, if any
   */
  const error = state.error;

  /**
   * Current conversation messages
   * Excludes system messages, only user and assistant
   */
  const messages: ChatMessage[] = useMemo(() => {
    if (!conversation) return [];
    return conversation.messages.filter((m) => m.role !== 'system');
  }, [conversation]);

  /**
   * All conversations sorted by most recent
   */
  const conversations: Conversation[] = useMemo(() => {
    return [...allConversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [allConversations]);

  /**
   * Current conversation ID
   */
  const currentConversationId = conversation?.id || null;

  /**
   * Send a message and get a response
   * Throws if model not ready
   */
  const send = useCallback(
    async (content: string): Promise<void> => {
      await sendMessage(content);
    },
    [sendMessage]
  );

  /**
   * Start download and then initialize model
   * Call this when user confirms download
   */
  const downloadAndInit = useCallback(async (): Promise<void> => {
    if (!state.isModelDownloaded) {
      await startDownload();
    }
    await initializeModel();
  }, [state.isModelDownloaded, startDownload, initializeModel]);

  /**
   * Clear current conversation and start fresh
   */
  const clear = useCallback(() => {
    clearConversation();
  }, [clearConversation]);

  /**
   * Select a conversation by ID
   */
  const select = useCallback(
    (id: string) => {
      selectConversation(id);
    },
    [selectConversation]
  );

  /**
   * Start a new conversation
   */
  const startNew = useCallback(() => {
    startNewConversation();
  }, [startNewConversation]);

  /**
   * Delete a conversation by ID
   */
  const remove = useCallback(
    (id: string) => {
      deleteConversation(id);
    },
    [deleteConversation]
  );

  /**
   * Get preview text for a conversation (first user message or default)
   */
  const getPreview = useCallback((convo: Conversation): string => {
    const userMessage = convo.messages.find((m) => m.role === 'user');
    if (userMessage) {
      return userMessage.content.length > 50
        ? userMessage.content.substring(0, 50) + '...'
        : userMessage.content;
    }
    return t("chat-history.llm_newConversation");
  }, []);

  return {
    // State
    needsDownload,
    needsInit,
    isReady,
    isGenerating,
    downloadProgress,
    error,
    messages,

    // Multi-conversation state
    conversations,
    currentConversationId,

    // Actions
    send,
    downloadAndInit,
    startDownload,
    initializeModel,
    releaseModel,
    clear,

    // Multi-conversation actions
    select,
    startNew,
    remove,
    getPreview,
  };
}
