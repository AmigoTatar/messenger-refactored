import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import ProfilePanel from './components/ProfilePanel/ProfilePanel';
import Auth from './Auth';
import SearchModal from './components/SearchModal';
import { useSocket } from './hooks/useSocket';
import { useMessages } from './hooks/useMessages';
import { useChats } from './hooks/useChats';
import { useUnread } from './hooks/useUnread';
import { useMarkAsRead } from './hooks/useMarkAsRead';
import { useTheme } from './hooks/useTheme';
import { getChatIdFromMessage, getChatType, extractIdFromChatId } from './utils/chatUtils';
import { playNotificationSound } from './utils/soundUtils';
import { CHAT_IDS, API_BASE_URL } from './config';
import { apiClient } from './services/apiClient';
import { MessageContext } from './contexts/MessageContext';

export default function App() {
  // === Пользователь ===
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  // === Состояние активного чата ===
  const [activeChatId, setActiveChatId] = useState(null);
  const [activeChatData, setActiveChatData] = useState(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [groupChatsVersion, setGroupChatsVersion] = useState(0);
  const [chatsVersion, setChatsVersion] = useState(0);
  const [channelsVersion, setChannelsVersion] = useState(0);

  // === Хуки ===
  const { isDarkMode, toggleTheme } = useTheme();
  const { chats, channels, groupChats, addChannel, addGroupChat, removeChannel, removeGroupChat, setChannels, setGroupChats, setChats, reload: reloadChats } = useChats(user);
  const { unreadCounts, fetchUnread, updateUnread, resetUnread } = useUnread(user);
  const { getMessages, addMessage, addMessages, loadHistory, hasMore, loading, markMessageAsRead, deleteMessageLocally, setMessagesByChat } = useMessages(user?.id);
  const { markAsRead, debouncedMarkAsRead } = useMarkAsRead();
  
  // === Рефы для защиты от дублирования ===
  const processedEvents = useRef(new Set());
  const activeChatIdRef = useRef(activeChatId);
  const pinnedProcessingRef = useRef(new Set());
  

// Синхронизация activeChatData при изменении channels или groupChats
useEffect(() => {
  if (!activeChatId) return;

  let found = false;

  if (activeChatId.startsWith('channel_')) {
    const channel = channels.find(c => `channel_${c.id}` === activeChatId);
    if (channel) {
      setActiveChatData({
        name: channel.name,
        avatar: channel.avatar,
        type: 'channel',
        creatorId: channel.creatorId,
        members: channel.members || []
      });
      found = true;
    }
  } else if (activeChatId.startsWith('chat_')) {
    const group = groupChats.find(c => c.id === activeChatId || `chat_${c.dbId}` === activeChatId);
    if (group) {
      setActiveChatData({
        name: group.name,
        avatar: group.avatar,
        type: 'group',
        creatorId: group.creatorId,
        members: group.members || []
      });
      found = true;
    }
  } else if (activeChatId.startsWith('user_')) {
    const user = chats.find(c => c.id === activeChatId);
    if (user) {
      setActiveChatData({
        name: user.name,
        avatar: user.avatar,
        type: 'private',
        dbId: user.dbId
      });
      found = true;
    }
  }

  if (!found) {
    console.log('🔄 Чат не найден, сбрасываю activeChatId');
    setActiveChatId(null);
    setActiveChatData(null);
  }
}, [activeChatId, channels, groupChats, chats]);


 // ==============================================
// 🔌 СОКЕТ (создаём без обработчиков, чтобы избежать циклической зависимости)
// ==============================================
const { socket, emit, joinChat, sendMessage } = useSocket(user, {});

// ==============================================
// 📡 АВТОМАТИЧЕСКАЯ ПОДПИСКА НА ВСЕ КОМНАТЫ
// ==============================================
useEffect(() => {
  if (!socket || !socket.connected) return;

  // Подписываемся на все групповые чаты
  groupChats.forEach(chat => {
    const chatId = chat.id || `chat_${chat.dbId}`;
    if (chatId) {
      socket.emit('join_chat', chatId);
      console.log('📡 Подписываюсь на группу:', chatId);
    }
  });

  // Подписываемся на все каналы
  channels.forEach(channel => {
    const chatId = `channel_${channel.id}`;
    socket.emit('join_chat', chatId);
    console.log('📡 Подписываюсь на канал:', chatId);
  });

  // (Опционально) Подписываемся на приватные чаты
  chats.forEach(chat => {
    if (chat.id && chat.id !== 'chat_general' && !chat.id.startsWith('channel_') && !chat.id.startsWith('chat_')) {
      socket.emit('join_chat', chat.id);
    }
  });
}, [socket, groupChats, channels, chats]);
// --- 1. КАНАЛ СОЗДАН ---
const handleChannelCreated = useCallback(async (newChannel) => {
  const rawId = String(newChannel.id);
const numericId = parseInt(rawId.replace(/^channel_/, '').replace(/^chat_/, '').replace(/^user_/, ''), 10);
// Сохраняем канал с числовым id (без префикса)
addChannel({ ...newChannel, id: numericId, members: [] });
const idWithPrefix = `channel_${numericId}`;
joinChat(idWithPrefix);
  
  // ✅ Загружаем участников для нового канала (чтобы профиль сразу работал)
  try {
    const token = localStorage.getItem('token');
    const members = await apiClient(`/api/channels/${numericId}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Обновляем канал с загруженными участниками
    setChannels(prev => prev.map(ch =>
      String(ch.id) === String(numericId) || ch.id === idWithPrefix 
        ? { ...ch, members } 
        : ch
    ));
  } catch (err) {
    console.error('Ошибка загрузки участников нового канала:', err);
  }
}, [addChannel, joinChat, setChannels]);
  // --- 2. КАНАЛ УДАЛЁН ---
const handleChannelDeleted = useCallback(({ channelId }) => {
  console.log('🗑️ [handleChannelDeleted] channelId:', channelId);
  console.log('🗑️ [handleChannelDeleted] activeChatIdRef.current:', activeChatIdRef.current);
  removeChannel(channelId);
  
  const activeId = activeChatIdRef.current;
  if (activeId === `channel_${channelId}` || activeId === channelId || activeId === String(channelId)) {
    console.log('✅ Сбрасываю активный канал');
    setActiveChatId(null);
    setActiveChatData(null);
    setMessagesByChat(prev => {
      const newState = { ...prev };
      delete newState[`channel_${channelId}`];
      return newState;
    });
    setIsProfileOpen(false);
  } else {
    console.log('❌ Условие не сработало: activeId=', activeId, 'channelId=', channelId);
  }
}, [removeChannel, setActiveChatId, setActiveChatData, setMessagesByChat, setIsProfileOpen]);

const handleChatDeleted = useCallback(({ chatId }) => {
  console.log('🗑️ [handleChatDeleted] chatId:', chatId);
  console.log('🗑️ [handleChatDeleted] activeChatIdRef.current:', activeChatIdRef.current);
  removeGroupChat(chatId);
  
  const activeId = activeChatIdRef.current;
  if (activeId === `chat_${chatId}` || activeId === chatId || activeId === String(chatId)) {
    console.log('✅ Сбрасываю активный чат');
    setActiveChatId(null);
    setActiveChatData(null);
    setMessagesByChat(prev => {
      const newState = { ...prev };
      delete newState[`chat_${chatId}`];
      return newState;
    });
    setIsProfileOpen(false);
  } else {
    console.log('❌ Условие не сработало: activeId=', activeId, 'chatId=', chatId);
  }
}, [removeGroupChat, setActiveChatId, setActiveChatData, setMessagesByChat, setIsProfileOpen]);

  // --- 3. ГРУППА СОЗДАНА ---
const handleChatCreated = useCallback((newChat) => {
  console.log('🆕 [handleChatCreated] ВЫЗВАНА! newChat:', newChat);
  const rawId = String(newChat.id);
  const numericId = rawId.replace(/^chat_/, '').replace(/^channel_/, '').replace(/^user_/, '');
  const idWithPrefix = `chat_${numericId}`;
  const normalized = { ...newChat, id: idWithPrefix, dbId: parseInt(numericId, 10) };
  
  console.log('🆕 [handleChatCreated] Получено событие для группы:', idWithPrefix);
  console.log('🆕 [handleChatCreated] Сокет подключён?', socket?.connected);
  
  addGroupChat(normalized);
  joinChat(idWithPrefix);
  console.log('🆕 [handleChatCreated] Вызван joinChat для', idWithPrefix);
}, [addGroupChat, joinChat, socket]);;

  

  // --- 5. НОВОЕ СООБЩЕНИЕ ---
 const handleReceiveMessage = (newMessage) => {
  const chatId = getChatIdFromMessage(newMessage, user?.id);
  console.log('📩 Получено сообщение для чата:', chatId, 'Сообщение:', newMessage);
  
  // 📡 Автоматически подписываемся на комнату
  if (chatId && chatId !== 'chat_general') {
    joinChat(chatId);
    console.log('📡 Подписываюсь на комнату из сообщения:', chatId);
  }
  
  const msgKey = `${chatId}_${newMessage.id}`;
  if (processedEvents.current.has(msgKey)) return;
  processedEvents.current.add(msgKey);
  setTimeout(() => processedEvents.current.delete(msgKey), 1000);

  addMessage(chatId, newMessage);

  // ==========================================
  // 🆕 ОБНОВЛЯЕМ lastMessage В СПИСКАХ ЧАТОВ
  // ==========================================
  if (chatId.startsWith('chat_')) {
  const chatDbId = parseInt(chatId.replace('chat_', ''), 10);
  console.log('🔄 Обновляю lastMessage для группы:', chatDbId, 'Сообщение:', newMessage);
  
setGroupChats(prev => {
  const updated = prev.map(ch => {
    const id = ch.dbId || parseInt(ch.id?.replace('chat_', ''), 10);
    if (id === chatDbId) {
      return { ...ch, lastMessage: newMessage };
    }
    return ch;
  });
  return [...updated]; // обязательно создаём новый массив
});

 setGroupChatsVersion(prev => {
    console.log('📊 Увеличиваю groupChatsVersion до:', prev + 1);
    return prev + 1;
  });
}

   // ==========================================
  // 🆕 ОБНОВЛЯЕМ lastMessage ДЛЯ КАНАЛОВ
  // ==========================================
  if (chatId.startsWith('channel_')) {
    const channelId = parseInt(chatId.replace('channel_', ''), 10);
    console.log('🔄 Обновляю lastMessage для канала:', channelId, 'Сообщение:', newMessage);
    setChannels(prev => {
      const updated = prev.map(ch => {
        if (ch.id === channelId) {
          return { ...ch, lastMessage: newMessage };
        }
        return ch;
      });
      
     setChannelsVersion(prevVersion => prevVersion + 1);
    
    return [...updated];
  });
}
// ==========================================
// 🆕 ОБНОВЛЯЕМ lastMessage ДЛЯ ПРИВАТНЫХ ЧАТОВ
// ==========================================
if (chatId.startsWith('user_')) {
  const userId = parseInt(chatId.replace('user_', ''), 10);
  console.log('🔄 Обновляю lastMessage для приватного чата:', userId, 'Сообщение:', newMessage);
  setChats(prev => {
    const updated = prev.map(ch => {
      const id = ch.dbId || parseInt(ch.id?.replace('user_', ''), 10);
      if (id === userId) {
        return { ...ch, lastMessage: newMessage };
      }
      return ch;
    });
    setChatsVersion(prev => {
      console.log('📊 Увеличиваю chatsVersion до:', prev + 1);
      return prev + 1;
    });
    return [...updated];
  });
}

  

   // ==========================================
  // 📊 ОБНОВЛЯЕМ НЕПРОЧИТАННЫЕ (если чат не активен)
  // ==========================================
  

  if (String(newMessage.senderId) !== String(user?.id)) {
    playNotificationSound();
  }
};


  // --- 6. УДАЛЕНИЕ СООБЩЕНИЯ ---
  const handleMessageDeleted = ({ messageId }) => {
    setMessagesByChat(prev => {
      const newState = { ...prev };
      for (const chatId in newState) {
        newState[chatId] = newState[chatId].map(msg =>
          msg.id === messageId
            ? { ...msg, isDeleted: true, text: 'Сообщение удалено', mediaUrl: null, mediaType: null, reactions: [], threads: [] }
            : msg
        );
      }
      return newState;
    });
  };

  // --- 7. ОБНОВЛЕНИЕ РЕАКЦИЙ ---
  const handleReactionUpdated = ({ messageId, reactions }) => {
    setMessagesByChat(prev => {
      const newState = { ...prev };
      for (const chatId in newState) {
        newState[chatId] = newState[chatId].map(msg =>
          msg.id === messageId ? { ...msg, reactions } : msg
        );
      }
      return newState;
    });
  };
    
    
  // --- 8. НОВЫЙ КОММЕНТАРИЙ (ТРЕД) ---
  const handleThreadCreated = ({ thread, messageId }) => {
    setMessagesByChat(prev => {
      const newState = { ...prev };
      for (const chatId in newState) {
        newState[chatId] = newState[chatId].map(msg =>
          msg.id === messageId
            ? { ...msg, threads: [...(msg.threads || []), thread] }
            : msg
        );
      }
      return newState;
    });
  };

  // --- 9. ОБНОВЛЕНИЕ НЕПРОЧИТАННЫХ ---
const handleUnreadUpdated = useCallback((data) => {
  const { type, id, count } = data;
  let chatKey;
  if (type === 'channel') chatKey = `channel_${id}`;
  else if (type === 'chat') chatKey = `chat_${id}`;
  else if (type === 'private') chatKey = `user_${id}`;
  
  const currentActive = activeChatIdRef.current;
  console.log('📊 [handleUnreadUpdated] chatKey:', chatKey, 'active:', currentActive, 'count:', count);

  if (chatKey === currentActive) {
    // Если чат активен, сбрасываем счётчик принудительно (на случай, если сервер прислал 1)
    console.log('🔄 Сбрасываю unread для активного чата:', chatKey);
    updateUnread(chatKey, 0);
  } else {
    // Иначе обновляем
    updateUnread(chatKey, count);
  }
}, [updateUnread]);

  // --- 10. РЕДАКТИРОВАНИЕ СООБЩЕНИЯ ---
  const handleMessageEdited = ({ messageId, text }) => {
    setMessagesByChat(prev => {
      const newState = { ...prev };
      for (const chatId in newState) {
        newState[chatId] = newState[chatId].map(msg =>
          msg.id === messageId ? { ...msg, text, edited: true } : msg
        );
      }
      return newState;
    });
  };



  // --- 11. ЗАКРЕПЛЕНИЕ ---
const handlePin = useCallback(async (messageId) => {
  const id = typeof messageId === 'object' ? messageId.messageId || messageId.id : messageId;
  if (!id) return;

  // Защита от дублей
  if (pinnedProcessingRef.current.has(id)) return;
  pinnedProcessingRef.current.add(id);

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/api/messages/${id}/pin`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Ошибка закрепления');
    }
    const data = await response.json();
    // Обновляем стейт через setMessagesByChat
    setMessagesByChat(prev => {
      const newState = { ...prev };
      for (const chatId in newState) {
        newState[chatId] = newState[chatId].map(msg =>
          msg.id === id ? { ...msg, isPinned: data.isPinned } : msg
        );
      }
      return newState;
    });
  } catch (error) {
    console.error('Ошибка закрепления:', error);
    alert('Не удалось закрепить сообщение');
  } finally {
    pinnedProcessingRef.current.delete(id);
  }
}, [setMessagesByChat]);

// --- 12. ДОБАВЛЕНИЕ УЧАСТНИКА В КАНАЛ ---
const handleChannelMemberAdded = useCallback((data) => {
  setChannels(prev => {
    const updated = prev.map(ch => {
      if (ch.id === data.channelId) {
        const exists = ch.members?.some(m => m.userId === data.member.userId);
        if (exists) return ch;
        return { ...ch, members: [...(ch.members || []), data.member] };
      }
      return ch;
    });
    return [...updated];
  });
  
  // ✅ ФОРСИРУЕМ ОБНОВЛЕНИЕ САЙДБАРА
  setChannelsVersion(prev => prev + 1);
  
  // ✅ ОБНОВЛЯЕМ activeChatData (если этот канал активен)
  if (activeChatId === `channel_${data.channelId}`) {
    setActiveChatData(prev => ({
      ...prev,
      members: [...(prev?.members || []), data.member]
    }));
  }
  
  if (data.member?.userId === user?.id) {
    joinChat(`channel_${data.channelId}`);
  }
}, [setChannels, setActiveChatData, user, joinChat, activeChatId]);

 // --- 13. УДАЛЕНИЕ УЧАСТНИКА ИЗ КАНАЛА ---
  const handleChannelMemberRemoved = (data) => {
    setChannels(prev => prev.map(ch => {
      if (ch.id === data.channelId) {
        return { ...ch, members: ch.members?.filter(m => m.userId !== data.userId) || [] };
      }
      return ch;
    }));
    if (data.userId === user?.id) {
      removeChannel(data.channelId);
      if (activeChatIdRef.current === `channel_${data.channelId}`) {
        setActiveChatId('chat_general');
        setActiveChatData({ name: 'Общий чат', avatar: '💬', type: 'general' });
      }
    }
  };

  // --- 14. ДОБАВЛЕНИЕ УЧАСТНИКА В ГРУППУ ---
 const handleChatMemberAdded = useCallback((data) => {
  setGroupChats(prev => {
    const updated = prev.map(ch => {
      const chatId = ch.id?.toString() || `chat_${ch.dbId}`;
      if (chatId === `chat_${data.chatId}` || ch.dbId === data.chatId) {
        const exists = ch.members?.some(m => m.userId === data.member.userId);
        if (exists) return ch;
        return { ...ch, members: [...(ch.members || []), data.member] };
      }
      return ch;
    });
    return [...updated];
  });


  
  // ✅ ДОБАВЛЯЕМ ФОРСИРОВАННОЕ ОБНОВЛЕНИЕ
  
  setGroupChatsVersion(prev => prev + 1);
  
  if (data.member?.userId === user?.id) {
    joinChat(`chat_${data.chatId}`);
  }
}, [setGroupChats, user, joinChat]);
// --- 15. УДАЛЕНИЕ УЧАСТНИКА ИЗ ГРУППЫ ---
  const handleChatMemberRemoved = (data) => {
  setGroupChats(prev => {
    const updated = prev.map(ch => {
      const chatId = ch.id?.toString() || `chat_${ch.dbId}`;
      if (chatId === `chat_${data.chatId}` || ch.dbId === data.chatId) {
        return {
          ...ch,
          members: ch.members?.filter(m => m.userId !== data.userId) || []
        };
      }
      return ch;
    });
    
    setGroupChatsVersion(prevVersion => prevVersion + 1);
    return [...updated];
  });
  
  if (data.userId === user?.id) {
    removeGroupChat(data.chatId);
    if (activeChatIdRef.current === `chat_${data.chatId}`) {
      setActiveChatId('chat_general');
      setActiveChatData({ name: 'Общий чат', avatar: '💬', type: 'general' });
    }
  }
};

  // --- 16. ОБНОВЛЕНИЕ ПОЛЬЗОВАТЕЛЯ ---
  const handleUserUpdated = (data) => {
    if (data.userId === user?.id) {
      const updatedUser = { ...user, username: data.username, avatar: data.avatar };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
    }
  };

  // --- 17. СТАТУС ПРОЧТЕНИЯ ---
  const handleMessagesReadUpdate = useCallback(({ activeChatId: readChatId, readerId }) => {
  if (readerId === user?.id) return; // если я прочитал, то не обновляем (это мои сообщения)
  // Находим все сообщения в этом чате, где senderId === readerId (другой пользователь)
  // и обновляем их статус на read
  setMessagesByChat(prev => {
    const newState = { ...prev };
    for (const chatId in newState) {
      if (chatId === readChatId) {
        newState[chatId] = newState[chatId].map(msg =>
          msg.senderId === readerId ? { ...msg, status: 'read' } : msg
        );
      }
    }
    return newState;
  });
}, [setMessagesByChat, user]);


useEffect(() => {
  if (socket && activeChatId) {
    socket.emit('read_messages', { activeChatId });
  }
}, [socket, activeChatId]);



// ==============================================
// ⌨️ ВЫХОД ИЗ ЧАТА ПО ESCAPE
// ==============================================
useEffect(() => {
  const handleEsc = (e) => {
    if (e.key === 'Escape' && activeChatId) {
      setActiveChatId(null);
      setActiveChatData(null);
      setIsProfileOpen(false);
    }
  };
  window.addEventListener('keydown', handleEsc);
  return () => window.removeEventListener('keydown', handleEsc);
}, [activeChatId]);

// ==============================================
// 📡 ПОДПИСКА НА СОБЫТИЯ СОКЕТА (через useEffect)
// ==============================================
useEffect(() => {
  if (!socket) return;






  // ==============================================
  // 🎯 ПОДПИСЫВАЕМСЯ НА ВСЕ СОБЫТИЯ
  // ==============================================
  socket.on('channel_created', handleChannelCreated);
  socket.on('channel_deleted', handleChannelDeleted);
  socket.on('chat_created', handleChatCreated);
  socket.on('chat_deleted', handleChatDeleted);
  socket.on('receive_message', handleReceiveMessage);
  socket.on('message_deleted', handleMessageDeleted);
  socket.on('reaction_updated', handleReactionUpdated);
  socket.on('thread_created', handleThreadCreated);
  socket.on('unread_updated', handleUnreadUpdated);
  socket.on('message_edited', handleMessageEdited);
  socket.on('channel_member_added', handleChannelMemberAdded);
  socket.on('channel_member_removed', handleChannelMemberRemoved);
  socket.on('chat_member_added', handleChatMemberAdded);
  socket.on('chat_member_removed', handleChatMemberRemoved);
  socket.on('user_updated', handleUserUpdated);
  socket.on('messages_read_update', handleMessagesReadUpdate);

socket.on('message_pinned', ({ messageId, isPinned }) => {
  setMessagesByChat(prev => {
    const newState = { ...prev };
    for (const chatId in newState) {
      newState[chatId] = newState[chatId].map(msg =>
        msg.id === messageId ? { ...msg, isPinned } : msg
      );
    }
    return newState;
  });
});



  socket.on('kicked_from_channel', ({ channelId }) => {
    console.log(`👢 Вас удалили из канала ${channelId}`);
    setChannels(prev => prev.filter(ch => ch.id !== channelId));
    if (activeChatIdRef.current === `channel_${channelId}`) {
      setActiveChatId('chat_general');
      setActiveChatData({ name: 'Общий чат', avatar: '💬', type: 'general' });
      setMessagesByChat(prev => {
        const newState = { ...prev };
        delete newState[`channel_${channelId}`];
        return newState;
      });
    }
  });



  // ==============================================
  // 🧹 ОТПИСЫВАЕМСЯ ПРИ РАЗМОНТИРОВАНИИ
  // ==============================================
  return () => {
    socket.off('channel_created', handleChannelCreated);
    socket.off('channel_deleted', handleChannelDeleted);
    socket.off('chat_created', handleChatCreated);
    socket.off('chat_deleted', handleChatDeleted);
    socket.off('receive_message', handleReceiveMessage);
    socket.off('message_deleted', handleMessageDeleted);
    socket.off('reaction_updated', handleReactionUpdated);
    socket.off('thread_created', handleThreadCreated);
    socket.off('unread_updated', handleUnreadUpdated);
    socket.off('message_edited', handleMessageEdited);
    socket.off('channel_member_added', handleChannelMemberAdded);
    socket.off('channel_member_removed', handleChannelMemberRemoved);
    socket.off('chat_member_added', handleChatMemberAdded);
    socket.off('chat_member_removed', handleChatMemberRemoved);
    socket.off('user_updated', handleUserUpdated);
    socket.off('messages_read_update', handleMessagesReadUpdate);
    socket.off('kicked_from_channel');
    socket.off('message_pinned');

    
  };
}, [socket, joinChat, addChannel, removeChannel, addGroupChat, removeGroupChat, addMessage, setMessagesByChat, updateUnread, user, activeChatIdRef]);

// === Переключение чата ===
const handleSelectChat = useCallback(async (chatId, chatData = null) => {
  if (!chatId) return;
  
  // Нормализация ID
  let normalizedChatId = chatId;
  while (normalizedChatId.startsWith('chat_chat_') || 
         normalizedChatId.startsWith('channel_channel_') || 
         normalizedChatId.startsWith('user_user_')) {
    if (normalizedChatId.startsWith('chat_chat_')) {
      normalizedChatId = normalizedChatId.replace('chat_chat_', 'chat_');
    } else if (normalizedChatId.startsWith('channel_channel_')) {
      normalizedChatId = normalizedChatId.replace('channel_channel_', 'channel_');
    } else if (normalizedChatId.startsWith('user_user_')) {
      normalizedChatId = normalizedChatId.replace('user_user_', 'user_');
    }
  }
  
  if (normalizedChatId === activeChatId) return;

  setActiveChatId(normalizedChatId);
  activeChatIdRef.current = normalizedChatId;
  joinChat(normalizedChatId);
  console.log('🔄 Сброс непрочитанных для чата:', normalizedChatId);
  resetUnread(normalizedChatId);
  await loadHistory(normalizedChatId);

  // ✅ Определяем данные чата (используем другое имя)
  let activeData = chatData;
  if (!activeData) {
    if (normalizedChatId.startsWith('channel_')) {
      const ch = channels.find(c => `channel_${c.id}` === normalizedChatId);
      if (ch) {
        activeData = { 
          name: ch.name, 
          avatar: ch.avatar, 
          type: 'channel', 
          creatorId: ch.creatorId, 
          members: ch.members || [] 
        };
      }
    } else if (normalizedChatId.startsWith('chat_')) {
      const gr = groupChats.find(c => c.id === normalizedChatId || `chat_${c.dbId}` === normalizedChatId);
      if (gr) {
        activeData = { 
          name: gr.name, 
          avatar: gr.avatar, 
          type: 'group', 
          creatorId: gr.creatorId, 
          members: gr.members || [] 
        };
      }
    } else if (normalizedChatId.startsWith('user_')) {
      const pr = chats.find(c => c.id === normalizedChatId);
      if (pr) {
        activeData = { 
          name: pr.name, 
          avatar: pr.avatar, 
          type: 'private', 
          dbId: pr.dbId 
        };
      }
    }
  }

  // ✅ Устанавливаем данные (или fallback)
  setActiveChatData(activeData || { 
    name: 'Чат', 
    avatar: '💬', 
    type: 'general' 
  });
  
  setIsProfileOpen(false);
  if (socket) {
    socket.emit('read_messages', { activeChatId: normalizedChatId });
  }
}, [activeChatId, joinChat, resetUnread, loadHistory, channels, groupChats, chats, socket]);


  // === Функции для создания чатов ===

const handleCreateChannel = useCallback(async (channelData) => {
  try {
    const newChannel = await apiClient('/api/channels', {
      method: 'POST',
      body: JSON.stringify(channelData),
    });
    
    // ✅ Загружаем участников (хотя бы создателя)
    const members = await apiClient(`/api/channels/${newChannel.id}/members`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    
    const channelWithMembers = { ...newChannel, members };
    addChannel(channelWithMembers);
    const chatId = `channel_${newChannel.id}`;
    joinChat(chatId);
    
    // ✅ Передаём явные данные в handleSelectChat
    handleSelectChat(chatId, {
      name: channelData.name,
      avatar: channelData.avatar || '📢',
      type: 'channel',
      creatorId: user?.id,
      members: members, // ← участники загружены
    });
  } catch (err) {
    console.error(err);
    alert('Не удалось создать канал');
  }
}, [addChannel, joinChat, handleSelectChat, user]);


const handleCreateGroupChat = useCallback(async (chatData) => {
  try {
    const newChat = await apiClient('/api/chats', {
      method: 'POST',
      body: JSON.stringify(chatData),
    });

    const numericId = parseInt(String(newChat.id).replace('chat_', ''), 10);
    const chatId = `chat_${numericId}`;
    const normalized = { ...newChat, id: chatId, dbId: numericId };

    addGroupChat(normalized);
    joinChat(chatId); // подписываемся на своей стороне

    // ✅ Задержка 500 мс перед переключением на чат
    setTimeout(() => {
      handleSelectChat(chatId, {
        name: chatData.name,
        avatar: chatData.avatar || '💬',
        type: 'group',
        creatorId: user?.id,
        members: [{ userId: user?.id, user: { id: user?.id, username: user?.username, avatar: user?.avatar } }]
      });
    }, 500);
  } catch (err) {
    console.error(err);
    alert('Не удалось создать групповой чат');
  }
}, [addGroupChat, joinChat, handleSelectChat, user]);




  // === Отправка сообщения ===
  const handleSendMessage = useCallback((text, mediaUrl = null, mediaType = null) => {
  console.log('📤 handleSendMessage: activeChatId =', activeChatId, 'text =', text);
  if (!text && !mediaUrl) return;
  const messageData = { text, mediaUrl, mediaType, activeChatId };
  sendMessage(messageData);
}, [sendMessage, activeChatId]);

  // === Удаление сообщения ===
  const handleDeleteMessage = useCallback((msgId) => {
    deleteMessageLocally(activeChatId, msgId);
    emit('delete_message', { messageId: msgId, activeChatId });
  }, [activeChatId, deleteMessageLocally, emit]);

  // === Выход ===
  const handleLogout = useCallback(() => {
    if (socket) socket.disconnect();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setActiveChatId(null);
  }, [socket]);

  // === Авторизация ===
  const handleAuthSuccess = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  // === Рендер ===
  if (!user) {
    return <Auth onAuthSuccess={handleAuthSuccess} apiBaseUrl={API_BASE_URL} />;
  }

  // Собираем пропсы для компонентов
  const activeMessages = getMessages(activeChatId);
console.log('🔁 activeMessages обновлён:', activeMessages.length);

  return (
    <div className="bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white h-screen flex justify-center items-center font-sans antialiased transition-colors duration-300">
      <div className="w-full h-full md:max-w-5xl md:h-[90vh] md:rounded-2xl md:border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex overflow-hidden shadow-2xl transition-colors duration-300">
        
        <Sidebar
          chats={chats}
          channels={channels}
          groupChats={groupChats}
          activeChatId={activeChatId}
          unreadCounts={unreadCounts}
          onSelectChat={handleSelectChat}
          onCreateChannel={handleCreateChannel}
          onCreateGroupChat={handleCreateGroupChat}
          chatsVersion={chatsVersion}
          channelsVersion={channelsVersion}
          groupChatsVersion={groupChatsVersion}
          searchQuery="" // будет управляться в Sidebar или вынести
          setSearchQuery={() => {}}
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
          user={user}
          onUpdateUser={(u) => { localStorage.setItem('user', JSON.stringify(u)); setUser(u); }}
          formatMsgTime={(d) => d ? new Date(d).toLocaleTimeString() : ''}
        />
<MessageContext.Provider value={{ sendMessage: handleSendMessage }}>
        <ChatArea
    key={activeChatId || 'no-chat'}
    activeChatId={activeChatId}
    activeChatData={activeChatData}
    messages={activeMessages}
    currentUserId={user?.id}
    socketRef={socket}
    setMessages={setMessagesByChat}
    setActiveChatId={setActiveChatId}
    onDeleteMessage={handleDeleteMessage}
    onSelectChat={handleSelectChat}
    chatsProp={chats}
    groupChatsProp={groupChats}
    channelsProp={channels}
    onLoadMoreHistory={() => {
      const oldest = activeMessages.length > 0 ? activeMessages[0]?.id : null;
      loadHistory(activeChatId, oldest);
    }}
    hasMoreHistory={hasMore(activeChatId)}
    isHistoryLoading={loading(activeChatId)}
    onToggleProfile={() => setIsProfileOpen(!isProfileOpen)}
    onMarkAsRead={debouncedMarkAsRead}
    onPinMessage={handlePin}
          
        />
</MessageContext.Provider>



        <ProfilePanel
          activeChat={{ ...activeChatData, id: activeChatId, messages: activeMessages }}
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          socketRef={socket}
          onMemberRemoved={() => {}} // опционально
          onChatDeleted={() => {}}   // опционально
          onMemberAdded={(newMember) => {
    setActiveChatData(prev => ({
      ...prev,
      members: [...(prev?.members || []), newMember]
    }));
  }}
   onChatUpdate={(updated) => {
    if (updated.type === 'channel') {
      setChannels(prev => prev.map(ch =>
        ch.id === updated.id ? updated : ch
      ));
      // Если этот канал активен, обновляем activeChatData
      if (activeChatId === `channel_${updated.id}`) {
        setActiveChatData(prev => ({ ...prev, name: updated.name, avatar: updated.avatar }));
      }
    } else if (updated.type === 'group') {
      setGroupChats(prev => prev.map(ch =>
        ch.dbId === updated.id ? { ...ch, name: updated.name, avatar: updated.avatar } : ch
      ));
      if (activeChatId === `chat_${updated.id}`) {
        setActiveChatData(prev => ({ ...prev, name: updated.name, avatar: updated.avatar }));
      }
    }
  }}
        />
      </div>
    </div>
  );
}