import { supabase } from './supabase';

export async function getNotifications(limit = 30) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, order_id, conversation_id, actor_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(notificationId) {
  const { data, error } = await supabase.rpc('mark_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function markAllNotificationsRead() {
  const { data, error } = await supabase.rpc('mark_all_notifications_read');
  if (error) throw error;
  return Number(data || 0);
}

export async function markConversationRead(conversationId) {
  const { data, error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return Number(data || 0);
}
