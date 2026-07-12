export const getChatIdFromMessage = (msg, currentUserId) => {
  if (msg.channelId) return `channel_${msg.channelId}`;
  if (msg.chatId) {
    // Убедимся, что chatId уже с префиксом
    const chatId = String(msg.chatId);
    return chatId.startsWith('chat_') ? chatId : `chat_${chatId}`;
  }
  if (msg.receiverId && msg.senderId) {
    return Number(msg.senderId) === Number(currentUserId)
      ? `user_${msg.receiverId}`
      : `user_${msg.senderId}`;
  }
  return 'chat_general';
};

export const getChatType = (chatId) => {
  if (!chatId) return null;
  if (chatId === 'chat_general') return 'general';
  if (chatId.startsWith('channel_')) return 'channel';
  if (chatId.startsWith('user_')) return 'private';
  if (chatId.startsWith('chat_')) return 'group';
  return null;
};

export const extractIdFromChatId = (chatId) => {
  if (!chatId) return null;
  const parts = chatId.split('_');
  return parts.length > 1 ? parts[1] : null;
};