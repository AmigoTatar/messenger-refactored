// hooks/useMessages.js
import { useState, useCallback, useRef } from 'react';
import { apiClient } from '../services/apiClient';
import { getChatIdFromMessage } from '../utils/chatUtils';

export function useMessages(currentUserId) {
  const [messagesByChat, setMessagesByChat] = useState({});
  const [hasMore, setHasMore] = useState({});
  const [loading, setLoading] = useState({});
  const loadingRef = useRef({});

  const getMessages = useCallback((chatId) => {
    return messagesByChat[chatId] || [];
  }, [messagesByChat]);

  const addMessage = useCallback((chatId, message) => {
    setMessagesByChat(prev => {
      const current = prev[chatId] || [];
      if (current.some(m => m.id === message.id)) return prev;
      return { ...prev, [chatId]: [...current, message] };
    });
  }, []);

  const addMessages = useCallback((chatId, newMessages, prepend = false) => {
    setMessagesByChat(prev => {
      const current = prev[chatId] || [];
      const existingIds = new Set(current.map(m => m.id));
      const uniqueNew = newMessages.filter(m => !existingIds.has(m.id));
      if (uniqueNew.length === 0) return prev;
      const combined = prepend ? [...uniqueNew, ...current] : [...current, ...uniqueNew];
      return { ...prev, [chatId]: combined };
    });
  }, []);

  const loadHistory = useCallback(async (chatId, cursorMessageId = null) => {
    if (loadingRef.current[chatId]) return;
    loadingRef.current[chatId] = true;
    setLoading(prev => ({ ...prev, [chatId]: true }));

    try {
      let url = `/api/messages?activeChatId=${chatId}`;
      if (cursorMessageId) {
        url += `&cursorMessageId=${cursorMessageId}`;
      }
      const data = await apiClient(url);
      const rawMessages = Array.isArray(data) ? data : (data.messages || data || []);
      if (rawMessages.length > 0) {
        addMessages(chatId, rawMessages, !!cursorMessageId);
      }
      setHasMore(prev => ({ ...prev, [chatId]: data.hasMore || false }));
    } catch (err) {
      console.error('Error loading history:', err);
    } finally {
      loadingRef.current[chatId] = false;
      setLoading(prev => ({ ...prev, [chatId]: false }));
    }
  }, [addMessages]);

  const markMessageAsRead = useCallback((chatId, messageId) => {
    setMessagesByChat(prev => {
      const updated = (prev[chatId] || []).map(m =>
        m.id === messageId ? { ...m, status: 'read' } : m
      );
      return { ...prev, [chatId]: updated };
    });
  }, []);

  // Удаление сообщения (локальное обновление)
  const deleteMessageLocally = useCallback((chatId, messageId) => {
    setMessagesByChat(prev => {
      const updated = (prev[chatId] || []).map(m =>
        m.id === messageId
          ? { ...m, isDeleted: true, text: 'Сообщение удалено', mediaUrl: null, mediaType: null, reactions: [], threads: [] }
          : m
      );
      return { ...prev, [chatId]: updated };
    });
  }, []);

  return {
    getMessages,
    addMessage,
    addMessages,
    loadHistory,
    hasMore: (chatId) => hasMore[chatId] || false,
    loading: (chatId) => loading[chatId] || false,
    markMessageAsRead,
    setMessagesByChat,
    deleteMessageLocally,
  };
}