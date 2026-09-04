export function getVisibleUnreadCount(conversations, activeConversationId, messengerOpen) {
  return (Array.isArray(conversations) ? conversations : []).reduce((sum, conversation) => {
    if (messengerOpen && conversation.conversation_id === activeConversationId) return sum;
    return sum + Number(conversation.unread_count || 0);
  }, 0);
}

export function isConversationUnreadVisible(conversation, activeConversationId, messengerOpen) {
  if (!conversation) return false;
  if (messengerOpen && conversation.conversation_id === activeConversationId) return false;
  return Number(conversation.unread_count || 0) > 0;
}
