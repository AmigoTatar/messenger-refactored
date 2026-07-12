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

  // === Хуки ===
  const { isDarkMode, toggleTheme } = useTheme();
  const { chats, channels, groupChats, addChannel, addGroupChat, removeChannel, removeGroupChat, setChannels, setGroupChats, setChats, reload: reloadChats } = useChats(user);
  const { unreadCounts, fetchUnread, updateUnread, resetUnread } = useUnread(user);
  const { getMessages, addMessage, addMessages, loadHistory, hasMore, loading, markMessageAsRead, deleteMessageLocally, setMessagesByChat } = useMessages(user?.id);
  const { markAsRead, debouncedMarkAsRead } = useMarkAsRead();
  
  // === Рефы для защиты от дублирования ===
  const processedEvents = useRef(new Set());
  const activeChatIdRef = useRef(activeChatId);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);



 // ==============================================
// 🔌 СОКЕТ (создаём без обработчиков, чтобы избежать циклической зависимости)
// ==============================================
const { socket, emit, joinChat, sendMessage } = useSocket(user, {});
// --- 1. КАНАЛ СОЗДАН ---
const handleChannelCreated = useCallback(async (newChannel) => {
  const rawId = String(newChannel.id);
  const numericId = rawId.replace(/^channel_/, '').replace(/^chat_/, '').replace(/^user_/, '');
  const idWithPrefix = `channel_${numericId}`;
  
  // Добавляем канал в стейт с пустым массивом участников
  addChannel({ ...newChannel, id: idWithPrefix, members: [] });
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
  const handleChannelDeleted = ({ channelId }) => {
    removeChannel(channelId);
    if (activeChatIdRef.current === `channel_${channelId}`) {
      setActiveChatId('chat_general');
      setActiveChatData({ name: 'Общий чат', avatar: '💬', type: 'general' });
    }
  };

  // --- 3. ГРУППА СОЗДАНА ---
const handleChatCreated = (newChat) => {
  const rawId = String(newChat.id);
  const numericId = rawId.replace(/^chat_/, '').replace(/^channel_/, '').replace(/^user_/, '');
  const idWithPrefix = `chat_${numericId}`;
  const normalized = { ...newChat, id: idWithPrefix, dbId: parseInt(numericId, 10) };
  addGroupChat(normalized);
  joinChat(idWithPrefix);
};

  // --- 4. ГРУППА УДАЛЕНА ---
  const handleChatDeleted = ({ chatId }) => {
    removeGroupChat(chatId);
    if (activeChatIdRef.current === `chat_${chatId}`) {
      setActiveChatId('chat_general');
      setActiveChatData({ name: 'Общий чат', avatar: '💬', type: 'general' });
    }
  };

  // --- 5. НОВОЕ СООБЩЕНИЕ ---
 const handleReceiveMessage = (newMessage) => {
  const chatId = getChatIdFromMessage(newMessage, user?.id);
  console.log('📨 Получено сообщение для чата:', chatId, 'активный чат:', activeChatIdRef.current);
  const msgKey = `${chatId}_${newMessage.id}`;
  if (processedEvents.current.has(msgKey)) return;
  processedEvents.current.add(msgKey);
  setTimeout(() => processedEvents.current.delete(msgKey), 1000);

  addMessage(chatId, newMessage);

  // ==========================================
  // 🆕 ОБНОВЛЯЕМ lastMessage В СПИСКАХ ЧАТОВ
  // ==========================================
  if (chatId.startsWith('channel_')) {
    const channelId = parseInt(chatId.replace('channel_', ''));
    setChannels(prev => prev.map(ch =>
      ch.id === channelId ? { ...ch, lastMessage: newMessage } : ch
    ));
  } else if (chatId.startsWith('chat_')) {
    const chatDbId = parseInt(chatId.replace('chat_', ''));
    setGroupChats(prev => prev.map(ch => {
      const id = ch.dbId || parseInt(ch.id?.replace('chat_', ''));
      return id === chatDbId ? { ...ch, lastMessage: newMessage } : ch;
    }));
  } else if (chatId.startsWith('user_')) {
    const userId = parseInt(chatId.replace('user_', ''));
    setChats(prev => prev.map(ch => {
      const id = ch.dbId || parseInt(ch.id?.replace('user_', ''));
      return id === userId ? { ...ch, lastMessage: newMessage } : ch;
    }));
  }
console.log('📨 Сообщение в чат:', chatId, 'активный чат:', activeChatIdRef.current);

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
 const handleUnreadUpdated = (data) => {
  const { type, id, count } = data;
  let chatKey;
  if (type === 'channel') chatKey = `channel_${id}`;
  else if (type === 'chat') chatKey = `chat_${id}`;
  else if (type === 'private') chatKey = `user_${id}`;
  // ✅ Игнорируем обновления для активного чата
  if (chatKey && chatKey !== activeChatIdRef.current) {
    updateUnread(chatKey, count);
  } else {
    console.log('⏭️ Пропускаем unread_updated для активного чата:', chatKey);
  }
};

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
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/api/messages/${messageId}/pin`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) throw new Error('Ошибка закрепления');
    const data = await response.json();
    setMessagesByChat(prev => {
      const newState = { ...prev };
      for (const chatId in newState) {
        newState[chatId] = newState[chatId].map(msg =>
          msg.id === messageId ? { ...msg, isPinned: data.isPinned } : msg
        );
      }
      return newState;
    });
  } catch (error) {
    console.error('Ошибка закрепления:', error);
  }
}, [setMessagesByChat]);

// --- 12. ДОБАВЛЕНИЕ УЧАСТНИКА В КАНАЛ ---
  const handleChannelMemberAdded = useCallback((data) => {
  setChannels(prev => prev.map(ch => {
    if (ch.id === data.channelId) {
      const exists = ch.members?.some(m => m.userId === data.member.userId);
      if (exists) return ch;
      return { ...ch, members: [...(ch.members || []), data.member] };
    }
    return ch;
  }));
  // ✅ Если добавили текущего пользователя, подписываемся на канал
  if (data.member?.userId === user?.id) {
    joinChat(`channel_${data.channelId}`);
  }
}, [setChannels, user, joinChat]);

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
  setGroupChats(prev => prev.map(ch => {
    const chatId = ch.id?.toString() || `chat_${ch.dbId}`;
    if (chatId === `chat_${data.chatId}` || ch.dbId === data.chatId) {
      const exists = ch.members?.some(m => m.userId === data.member.userId);
      if (exists) return ch;
      return { ...ch, members: [...(ch.members || []), data.member] };
    }
    return ch;
  }));
  // ✅ Если добавили текущего пользователя, подписываемся на группу
  if (data.member?.userId === user?.id) {
    joinChat(`chat_${data.chatId}`);
  }
}, [setGroupChats, user, joinChat]);
// --- 15. УДАЛЕНИЕ УЧАСТНИКА ИЗ ГРУППЫ ---
  const handleChatMemberRemoved = (data) => {
    setGroupChats(prev => prev.map(ch => {
      const chatId = ch.id?.toString() || `chat_${ch.dbId}`;
      if (chatId === `chat_${data.chatId}` || ch.dbId === data.chatId) {
        return { ...ch, members: ch.members?.filter(m => m.userId !== data.userId) || [] };
      }
      return ch;
    }));
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
  const handleMessagesReadUpdate = ({ activeChatId: readChatId }) => {
    // Можно обновить статусы сообщений или просто перезапросить непрочитанные
  };

useEffect(() => {
  if (socket && activeChatId) {
    socket.emit('read_messages', { activeChatId });
  }
}, [socket, activeChatId]);
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
  socket.off('message_pinned', handlePin);
  socket.on('channel_member_added', handleChannelMemberAdded);
  socket.on('channel_member_removed', handleChannelMemberRemoved);
  socket.on('chat_member_added', handleChatMemberAdded);
  socket.on('chat_member_removed', handleChatMemberRemoved);
  socket.on('user_updated', handleUserUpdated);
  socket.on('messages_read_update', handleMessagesReadUpdate);

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
    socket.off('message_pinned', handlePin);
    socket.off('channel_member_added', handleChannelMemberAdded);
    socket.off('channel_member_removed', handleChannelMemberRemoved);
    socket.off('chat_member_added', handleChatMemberAdded);
    socket.off('chat_member_removed', handleChatMemberRemoved);
    socket.off('user_updated', handleUserUpdated);
    socket.off('messages_read_update', handleMessagesReadUpdate);
  };
}, [socket, joinChat, addChannel, removeChannel, addGroupChat, removeGroupChat, addMessage, setMessagesByChat, updateUnread, user, activeChatIdRef]);

// === Переключение чата ===
const handleSelectChat = useCallback(async (chatId, chatData = null) => {
  if (!chatId) return;
  console.log('🔍 handleSelectChat вызван с chatId:', chatId, 'chatData:', chatData);
  // ✅ НОРМАЛИЗУЕМ ID – удаляем лишние префиксы
  let normalizedChatId = chatId;
  // Если в ID больше одного префикса (chat_chat_29 -> chat_29)
  while (normalizedChatId.startsWith('chat_chat_') || 
         normalizedChatId.startsWith('channel_channel_') || 
         normalizedChatId.startsWith('user_user_')) {
    // Убираем один префикс
    if (normalizedChatId.startsWith('chat_chat_')) {
      normalizedChatId = normalizedChatId.replace('chat_chat_', 'chat_');
    } else if (normalizedChatId.startsWith('channel_channel_')) {
      normalizedChatId = normalizedChatId.replace('channel_channel_', 'channel_');
    } else if (normalizedChatId.startsWith('user_user_')) {
      normalizedChatId = normalizedChatId.replace('user_user_', 'user_');
    }
  }
  
  // Если уже активен, не переключаем
  if (normalizedChatId === activeChatId) return;

  setActiveChatId(normalizedChatId);
  joinChat(normalizedChatId);
  console.log('🔄 Сброс непрочитанных для чата:', normalizedChatId);
  resetUnread(normalizedChatId);
  await loadHistory(normalizedChatId);
  
  let data = chatData;
  if (!data) {
    if (normalizedChatId.startsWith('channel_')) {
      const ch = channels.find(c => `channel_${c.id}` === normalizedChatId);
      if (ch) data = { name: ch.name, avatar: ch.avatar, type: 'channel', creatorId: ch.creatorId, members: ch.members };
    } else if (normalizedChatId.startsWith('chat_')) {
      const gr = groupChats.find(c => c.id === normalizedChatId || `chat_${c.dbId}` === normalizedChatId);
      console.log('🔍 Найдена группа:', gr);
      if (gr) data = { name: gr.name, avatar: gr.avatar, type: 'group', creatorId: gr.creatorId, members: gr.members };
    } else if (normalizedChatId.startsWith('user_')) {
      const pr = chats.find(c => c.id === normalizedChatId);
      if (pr) data = { name: pr.name, avatar: pr.avatar, type: 'private', dbId: pr.dbId };
    }
  }
  setActiveChatData(data || { name: 'Чат', avatar: '💬', type: 'general' });
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
      addChannel(newChannel);
      joinChat(`channel_${newChannel.id}`);
      // можно переключиться
      handleSelectChat(`channel_${newChannel.id}`);
    } catch (err) {
      console.error(err);
      alert('Не удалось создать канал');
    }
  }, [addChannel, joinChat, handleSelectChat]);


const handleCreateGroupChat = useCallback(async (chatData) => {
  try {
    const newChat = await apiClient('/api/chats', {
      method: 'POST',
      body: JSON.stringify(chatData),
    });

    // Безопасно извлекаем числовой ID
    let rawId = newChat.id;
    let numericId;
    if (typeof rawId === 'string') {
      // Если ID уже содержит префикс, убираем его
      if (rawId.startsWith('chat_')) {
        numericId = parseInt(rawId.replace('chat_', ''), 10);
      } else {
        numericId = parseInt(rawId, 10);
      }
    } else {
      numericId = parseInt(rawId, 10);
    }
    const chatId = `chat_${numericId}`;
    const dbId = numericId;
    const normalized = { ...newChat, id: chatId, dbId };

    addGroupChat(normalized);
    joinChat(chatId);
    handleSelectChat(chatId);
  } catch (err) {
    console.error(err);
    alert('Не удалось создать групповой чат');
  }
}, [addGroupChat, joinChat, handleSelectChat]);




  // === Отправка сообщения ===
  const handleSendMessage = useCallback((text, mediaUrl = null, mediaType = null) => {
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
    activeChatId={activeChatId}
    activeChatData={activeChatData}
    messages={activeMessages}
    currentUserId={user?.id}
    socketRef={socket}
    onDeleteMessage={handleDeleteMessage}
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
        />
      </div>
    </div>
  );
}