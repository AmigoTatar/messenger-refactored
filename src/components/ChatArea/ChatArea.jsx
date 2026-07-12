import React, { useState, useCallback } from 'react';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import ContextMenu from './ContextMenu';
import ForwardModal from './ForwardModal';
import EditModal from './EditModal';
import { useMarkAsRead } from '../../hooks/useMarkAsRead';
import { API_BASE_URL } from '../../config';

export default function ChatArea({ 
  activeChatId, 
  activeChat, 
  setActiveChatId, 
  inputValue, 
  setInputValue, 
  onSendMessage, 
  messagesEndRef,
  isTyping,
  onDeleteMessage,
  onSendImage,
  onToggleProfile,
  onSendAudio,
  activeChatData,
  messages,
  setMessages, 
  currentUserId,
  socketRef,
  typingUser,
  onLoadMoreHistory,
  hasMoreHistory,
  apiBaseUrl = API_BASE_URL,
  isHistoryLoading,
  onMarkAsRead,
  chatsProp,        
  groupChatsProp,   
  onSelectChat,
  channelsProp,
  onPinMessage, 
}) {
  // ==============================================
  // 🧠 СОСТОЯНИЯ ДЛЯ UI
  // ==============================================
  
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    message: null,
  });

  const [forwardModal, setForwardModal] = useState({
    visible: false,
    message: null,
  });

  const [editingMessage, setEditingMessage] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);

  // ==============================================
  // 🎯 ОБРАБОТЧИКИ ДЛЯ КОНТЕКСТНОГО МЕНЮ
  // ==============================================

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
  };

  const handleEdit = (msg) => {
    setEditingMessage(msg);
  };

  const handleReply = (msg) => {
    setReplyingTo({ messageId: msg.id, text: msg.text || 'Сообщение' });
  };

  const handleForward = (msg) => {
    setForwardModal({ visible: true, message: msg });
  };

  const handleForwardSend = (targetChatId, msg) => {
    if (socketRef?.current) {
      socketRef.current.emit('send_message', {
        text: msg.text || '📤 Пересланное сообщение',
        mediaUrl: msg.mediaUrl || null,
        mediaType: msg.mediaType || null,
        activeChatId: targetChatId,
        isForwarded: true,
      });
      if (typeof onSelectChat === 'function') {
        onSelectChat(targetChatId);
      }
    }
    setForwardModal({ visible: false, message: null });
  };

  const handlePin = async (messageId) => {
    console.log('📌 Закрепление:', messageId);
    if (onPinMessage) onPinMessage(messageId);
  };

  const handleDelete = (messageId) => {
    if (onDeleteMessage) onDeleteMessage(messageId);
  };

  const handleReaction = async (messageId, emoji) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: emoji }),
      });
      if (!response.ok) {
        if (response.status === 429) {
          alert('❌ Слишком много реакций, подождите');
          return;
        }
        throw new Error('Ошибка');
      }
      const data = await response.json();
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId ? { ...m, reactions: data.reactions } : m
        )
      );
    } catch (error) {
      console.error('Ошибка реакции:', error);
    }
  };

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, message: null });
  };

  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      message: msg,
    });
  };

  // Проверка, можно ли писать в канал (только админы)
  const isReadOnly = activeChatData?.type === 'channel' 
  ? (activeChatData?.creatorId !== Number(currentUserId) &&
     !activeChatData?.members?.some(m => m.userId === Number(currentUserId) && m.role === 'admin'))
  : false;

  // Заглушки для недостающих функций
  const pinnedMessages = [];
  const handleMarkAsRead = () => {};
  const handleReactionToggle = () => {};
  const handleThreadReply = () => {};
  
  const getChatName = () => {
  if (!activeChatId) return 'Выберите чат';
  if (activeChatId === 'chat_general') return 'Общий чат';
  if (activeChatData?.name) return activeChatData.name;
  if (activeChatId.startsWith('channel_')) {
    const ch = channelsProp?.find(c => `channel_${c.id}` === activeChatId);
    return ch?.name || 'Канал';
  }
  if (activeChatId.startsWith('chat_')) {
    const gr = groupChatsProp?.find(c => c.id === activeChatId);
    return gr?.name || 'Групповой чат';
  }
  if (activeChatId.startsWith('user_')) {
    const pr = chatsProp?.find(c => c.id === activeChatId);
    return pr?.name || 'Пользователь';
  }
  return 'Чат';
};

  return (
  <div className="flex-col flex-1 h-full bg-zinc-100 dark:bg-zinc-900">
    {!activeChatId ? (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 p-4 text-center bg-zinc-100 dark:bg-zinc-900">
        <span className="text-4xl mb-2">💬</span>
        <p className="text-sm">Выберите чат, чтобы начать общение</p>
      </div>
    ) : (
      // ✅ Добавляем обёртку flex flex-col h-full
      <div className="flex flex-col h-full">
        <ChatHeader
          chatName={getChatName()}
          chatAvatar={activeChatData?.avatar}
          chatType={activeChatData?.type}
          isOnline={activeChatData?.isOnline}
          isTyping={false}
          isDataLoading={!activeChatData && activeChatId !== 'chat_general'}
          pinnedCount={pinnedMessages?.length || 0}
          onToggleProfile={onToggleProfile}
          onBack={() => setActiveChatId(null)}
        />

        <MessageList
          messages={messages}
          currentUserId={currentUserId}
          activeChatId={activeChatId}
          onLoadMore={onLoadMoreHistory}
          hasMore={hasMoreHistory}
          loading={isHistoryLoading}
          onMarkAsRead={handleMarkAsRead}
          onContextMenu={handleContextMenu}
          onReactionToggle={handleReactionToggle}
          onThreadReply={handleThreadReply}
          onForward={handleForward}
          onEdit={handleEdit}
          onPin={handlePin}
          onDelete={handleDelete}
        />

        <MessageInput
          activeChatId={activeChatId}
          socketRef={socketRef}
          isChannelReadOnly={isReadOnly}
          currentUserId={currentUserId}
          activeChatData={activeChatData}
          apiBaseUrl={apiBaseUrl}
        />

        {/* Контекстное меню */}
        {contextMenu.visible && (
          <ContextMenu
            message={contextMenu.message}
            currentUserId={currentUserId}
            onClose={closeContextMenu}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onCopy={handleCopy}
            onEdit={handleEdit}
            onReply={handleReply}
            onForward={handleForward}
            onPin={handlePin}
            onDelete={handleDelete}
            onReaction={handleReaction}
            canDelete={
              Number(contextMenu.message?.senderId) === Number(currentUserId) ||
              (activeChatData?.type === 'channel' && activeChatData?.creatorId === Number(currentUserId)) ||
              (activeChatData?.type === 'group' && activeChatData?.creatorId === Number(currentUserId))
            }
          />
        )}

        {/* Модалка пересылки */}
        {forwardModal.visible && (
          <ForwardModal
            visible={forwardModal.visible}
            onClose={() => setForwardModal({ visible: false, message: null })}
            message={forwardModal.message}
            chats={chatsProp}
            groupChats={groupChatsProp}
            channels={channelsProp}
            onForward={handleForwardSend}
            currentUserId={currentUserId}
          />
        )}

        {/* Модалка редактирования */}
        {editingMessage && (
          <EditModal
            message={editingMessage}
            onSave={onSave}
            onClose={() => setEditingMessage(null)}
          />
        )}
      </div>
    )}
  </div>
);
}