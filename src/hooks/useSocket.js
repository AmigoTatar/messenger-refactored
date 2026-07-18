// hooks/useSocket.js
import { useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { API_BASE_URL } from '../config';

export function useSocket(user, eventHandlers) {
  const socketRef = useRef(null);
  const handlersRef = useRef(eventHandlers);

  useEffect(() => {
    handlersRef.current = eventHandlers;
  }, [eventHandlers]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    const socket = io(API_BASE_URL, {
      transports: ['websocket'],
      auth: { token },
    });
    socketRef.current = socket;

    // Подписываемся на события из handlersRef
    const handlers = handlersRef.current;
    if (handlers) {
      Object.entries(handlers).forEach(([event, handler]) => {
        socket.on(event, handler);
      });
    }

    // Базовые события
    socket.on('connect', () => {
      console.log('✅ Socket connected');
      socket.emit('join_chat', `user_${user.id}`);
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
    });

    return () => {
      // Удаляем все пользовательские обработчики
      if (handlers) {
        Object.keys(handlers).forEach((event) => {
          socket.off(event);
        });
      }
      socket.off('connect');
      socket.off('disconnect');
      socket.offAny();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]); // Зависимость только от user (не пересоздаём при изменении handlers)

  const emit = useCallback((event, data) => {
    if (socketRef.current) {
      socketRef.current.emit(event, data);
    }
  }, []);

  const joinChat = useCallback((chatId) => {
  if (!socketRef.current) {
    console.warn('⚠️ joinChat: сокет отсутствует');
    return;
  }
  console.log('📡 joinChat: отправляю join_chat для', chatId);
  socketRef.current.emit('join_chat', chatId);
}, []);

  const sendMessage = useCallback((messageData) => {
    if (socketRef.current) {
      socketRef.current.emit('send_message', messageData);
    }
  }, []);

  return { socket: socketRef.current, emit, joinChat, sendMessage };
}