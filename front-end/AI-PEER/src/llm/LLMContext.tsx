/**
 * LLMContext.tsx - React Context for LLM state management
 *
 * Why both a Singleton AND a Context?
 * - Singleton (LLMService): Holds the actual model, survives component unmounts
 * - Context (this file): Provides React state that triggers re-renders
 *
 * This context handles:
 * - Download state and progress
 * - Model initialization state
 * - Generation state (for loading indicators and real-time token streaming)
 * - Multiple conversation management with 24-hour TTL
 *
 * PHI INVARIANT: conversations live in AsyncStorage on THIS device only.
 * Do NOT upload to Firestore, GCS, the API, or any other backend.
 * 24h max on-device retention — enforced at load, on every save, every 15
 * minutes, and on app foreground. See filterExpiredConversations below.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LLMState, ChatMessage, Conversation } from './types';
import { STORAGE_KEYS, CONVERSATION_TTL_MS } from './config';
import LLMService from './LLMService';
import {
  isModelDownloaded,
  downloadModel,
} from './modelDownloader';
import { useAuth } from '../auth';

/** Context value type */
type LLMContextValue = {
  // State
  state: LLMState;
  conversation: Conversation | null;
  allConversations: Conversation[];

  // Actions
  startDownload: () => Promise<void>;
  initializeModel: () => Promise<void>;
  sendMessage: (content: string) => Promise<string>;
  clearConversation: () => void;

  // Multi-conversation actions
  selectConversation: (id: string) => void;
  startNewConversation: () => void;
  deleteConversation: (id: string) => void;
};

const LLMContext = createContext<LLMContextValue | null>(null);

/** Generate a unique ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/** Create a fresh conversation */
function createNewConversation(): Conversation {
  const now = Date.now();
  return {
    id: generateId(),
    createdAt: now,
    lastMessageAt: now,
    messages: [
      {
        id: generateId(),
        role: 'assistant',
        content:
          "Hi, I'm AI-PEER! I'm here to help you with the PEER exercise program for fall prevention. How can I support you today?",
        timestamp: now,
      },
    ],
  };
}

/** Check if conversation is expired (older than 24 hours) */
function isConversationExpired(conversation: Conversation): boolean {
  return Date.now() - conversation.lastMessageAt > CONVERSATION_TTL_MS;
}

/** Filter out expired conversations */
function filterExpiredConversations(conversations: Conversation[]): Conversation[] {
  return conversations.filter((c) => !isConversationExpired(c));
}

export function LLMProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [state, setState] = useState<LLMState>({
    isModelDownloaded: false,
    isModelLoaded: false,
    isGenerating: false,
    downloadProgress: 0,
    error: null,
  });

  const [allConversations, setAllConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  // Derive current conversation from allConversations
  const conversation = allConversations.find((c) => c.id === currentConversationId) || null;

  // Check model status and load conversations on mount
  useEffect(() => {
    async function init() {
      try {
        // Check if model is downloaded
        const downloaded = await isModelDownloaded();
        setState((s) => ({ ...s, isModelDownloaded: downloaded }));

        // Load saved conversations
        const savedData = await AsyncStorage.getItem(STORAGE_KEYS.conversations);
        const savedCurrentId = await AsyncStorage.getItem(STORAGE_KEYS.currentConversationId);

        let conversations: Conversation[] = [];

        if (savedData) {
          const parsed = JSON.parse(savedData);
          // Handle both old format (single conversation) and new format (array)
          if (Array.isArray(parsed)) {
            conversations = filterExpiredConversations(parsed);
          } else if (parsed.id) {
            // Old format - single conversation object
            if (!isConversationExpired(parsed)) {
              conversations = [parsed];
            }
          }
        }

        // If no conversations or all expired, create a new one
        if (conversations.length === 0) {
          const newConvo = createNewConversation();
          conversations = [newConvo];
        }

        setAllConversations(conversations);

        // Set current conversation
        if (savedCurrentId && conversations.some((c) => c.id === savedCurrentId)) {
          setCurrentConversationId(savedCurrentId);
        } else {
          // Default to most recent conversation
          const sorted = [...conversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
          setCurrentConversationId(sorted[0].id);
        }

        // If model is downloaded and service is already initialized, sync state
        if (downloaded && LLMService.isReady()) {
          setState((s) => ({ ...s, isModelLoaded: true }));
        }
      } catch (error) {
        console.error('LLMContext init error:', error);
        setState((s) => ({ ...s, error: String(error) }));
      }
    }
    init();
  }, []);

  // Save conversations once generation finishes (or when conversations change outside active streaming).
  // Skipping AsyncStorage writes while state.isGenerating is true avoids writing to disk on every
  // streamed token and persists the final completed response when generation finishes.
  useEffect(() => {
    if (allConversations.length > 0 && !state.isGenerating) {
      const toPersist = filterExpiredConversations(allConversations);
      AsyncStorage.setItem(
        STORAGE_KEYS.conversations,
        JSON.stringify(toPersist)
      ).catch(console.error);
    }
  }, [allConversations, state.isGenerating]);

  // Continuous sweep: every 15 minutes and whenever the app returns to the
  // foreground, drop any conversation that has aged past the TTL. updating
  // state triggers the save effect above, which rewrites AsyncStorage.
  useEffect(() => {
    const sweep = () => {
      setAllConversations((prev) => {
        const alive = filterExpiredConversations(prev);
        return alive.length === prev.length ? prev : alive;
      });
    };
    const interval = setInterval(sweep, 15 * 60 * 1000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') sweep();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  // Save current conversation ID whenever it changes
  useEffect(() => {
    if (currentConversationId) {
      AsyncStorage.setItem(
        STORAGE_KEYS.currentConversationId,
        currentConversationId
      ).catch(console.error);
    }
  }, [currentConversationId]);

  /** Start downloading the model */
  const startDownload = useCallback(async () => {
    if (!token) {
      throw new Error('Not authenticated - cannot download model');
    }
    setState((s) => ({ ...s, error: null, downloadProgress: 0 }));

    try {
      await downloadModel(token, (progress) => {
        setState((s) => ({ ...s, downloadProgress: progress }));
      });
      setState((s) => ({ ...s, isModelDownloaded: true, downloadProgress: 100 }));
    } catch (error) {
      console.error('Download failed:', error);
      setState((s) => ({
        ...s,
        error: `Download failed: ${error}`,
        downloadProgress: 0,
      }));
      throw error;
    }
  }, [token]);

  /** Initialize the model (load into memory) */
  const initializeModel = useCallback(async () => {
    if (LLMService.isReady()) {
      setState((s) => ({ ...s, isModelLoaded: true }));
      return;
    }

    setState((s) => ({ ...s, error: null }));

    try {
      await LLMService.initialize();
      setState((s) => ({ ...s, isModelLoaded: true }));
    } catch (error) {
      console.error('Model initialization failed:', error);
      setState((s) => ({
        ...s,
        error: `Failed to load model: ${error}`,
        isModelLoaded: false,
      }));
      throw error;
    }
  }, []);

  /** Send a message and stream the assistant response token-by-token */
  const sendMessage = useCallback(
    async (content: string): Promise<string> => {
      if (!LLMService.isReady()) {
        throw new Error('Model not loaded');
      }

      if (!conversation) {
        throw new Error('No conversation');
      }

      const now = Date.now();
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: now,
      };

      const assistantMessageId = generateId();
      const placeholderAssistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: now + 1,
      };

      const promptMessages = [...conversation.messages, userMessage];

      setState((s) => ({ ...s, isGenerating: true, error: null }));

      // Add user message and empty assistant bubble immediately so tokens can stream into it
      setAllConversations((convos) =>
        convos.map((c) =>
          c.id === currentConversationId
            ? {
                ...c,
                messages: [...promptMessages, placeholderAssistantMessage],
                lastMessageAt: Date.now(),
              }
            : c
        )
      );

      try {
        // Stream response tokens progressively into the assistant bubble
        const response = await LLMService.generate(
          promptMessages,
          (_token, visibleText) => {
            setAllConversations((convos) =>
              convos.map((c) =>
                c.id === currentConversationId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantMessageId
                          ? { ...m, content: visibleText }
                          : m
                      ),
                      lastMessageAt: Date.now(),
                    }
                  : c
              )
            );
          }
        );

        // Finalize assistant message content when generation completes
        setAllConversations((convos) =>
          convos.map((c) =>
            c.id === currentConversationId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, content: response, timestamp: Date.now() }
                      : m
                  ),
                  lastMessageAt: Date.now(),
                }
              : c
          )
        );

        return response;
      } catch (error) {
        console.error('Generation error:', error);
        // Remove empty placeholder assistant bubble if generation failed before producing text
        setAllConversations((convos) =>
          convos.map((c) =>
            c.id === currentConversationId
              ? {
                  ...c,
                  messages: c.messages.filter(
                    (m) => !(m.id === assistantMessageId && !m.content)
                  ),
                }
              : c
          )
        );
        setState((s) => ({
          ...s,
          error: `Generation failed: ${error}`,
        }));
        throw error;
      } finally {
        setState((s) => ({ ...s, isGenerating: false }));
      }
    },
    [conversation, currentConversationId]
  );

  /** Clear current conversation and start fresh */
  const clearConversation = useCallback(() => {
    const newConvo = createNewConversation();
    setAllConversations((convos) => [
      newConvo,
      ...convos.filter((c) => c.id !== currentConversationId),
    ]);
    setCurrentConversationId(newConvo.id);
  }, [currentConversationId]);

  /** Select a conversation by ID */
  const selectConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
  }, []);

  /** Start a new conversation */
  const startNewConversation = useCallback(() => {
    const newConvo = createNewConversation();
    setAllConversations((convos) => [newConvo, ...convos]);
    setCurrentConversationId(newConvo.id);
  }, []);

  /** Delete a conversation by ID */
  const deleteConversation = useCallback(
    (id: string) => {
      setAllConversations((convos) => {
        const filtered = convos.filter((c) => c.id !== id);

        // If we deleted the current conversation, switch to another or create new
        if (id === currentConversationId) {
          if (filtered.length > 0) {
            const sorted = [...filtered].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
            setCurrentConversationId(sorted[0].id);
          } else {
            const newConvo = createNewConversation();
            setCurrentConversationId(newConvo.id);
            return [newConvo];
          }
        }

        return filtered;
      });
    },
    [currentConversationId]
  );

  return (
    <LLMContext.Provider
      value={{
        state,
        conversation,
        allConversations,
        startDownload,
        initializeModel,
        sendMessage,
        clearConversation,
        selectConversation,
        startNewConversation,
        deleteConversation,
      }}
    >
      {children}
    </LLMContext.Provider>
  );
}

/** Hook to access LLM context */
export function useLLMContext(): LLMContextValue {
  const context = useContext(LLMContext);
  if (!context) {
    throw new Error('useLLMContext must be used within LLMProvider');
  }
  return context;
}
