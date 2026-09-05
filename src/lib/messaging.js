import { supabase } from './supabase';

export async function getOrCreateOrderConversation(orderId) {
  const { data, error } = await supabase.rpc('get_or_create_order_conversation', { p_order_id: orderId });
  if (error) throw error;
  return data;
}

export async function getMyConversations() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in to view messages.');

  const { data, error } = await supabase
    .from('conversation_members')
    .select('conversation_id, joined_at, conversations(id, created_at, updated_at, order_conversations(order_id))')
    .eq('user_id', userData.user.id)
    .order('joined_at', { ascending: false });
  if (error) throw error;

  const rows = data || [];
  const ids = rows.map(row => row.conversation_id).filter(Boolean);
  if (!ids.length) return [];

  const { data: readStates, error: readError } = await supabase
    .from('conversation_read_state')
    .select('conversation_id, last_read_at')
    .eq('user_id', userData.user.id)
    .in('conversation_id', ids);
  if (readError) throw readError;
  const readMap = Object.fromEntries((readStates || []).map(row => [row.conversation_id, row.last_read_at]));

  const { data: messages, error: messageError } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false });
  if (messageError) throw messageError;

  const latest = {};
  (messages || []).forEach(message => {
    if (!latest[message.conversation_id]) latest[message.conversation_id] = message;
  });

  return rows.map(row => {
    const latestMessage = latest[row.conversation_id] || null;
    const lastReadAt = readMap[row.conversation_id] || null;
    const unread = Boolean(latestMessage && latestMessage.sender_id !== userData.user.id && (!lastReadAt || latestMessage.created_at > lastReadAt));
    return {
      id: row.conversation_id,
      joinedAt: row.joined_at,
      updatedAt: row.conversations?.updated_at || row.joined_at,
      orderId: row.conversations?.order_conversations?.[0]?.order_id || null,
      latestMessage,
      unread,
    };
  });
}

export async function getConversationMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, updated_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function sendMessage(conversationId, body) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Message cannot be empty.');
  if (text.length > 5000) throw new Error('Message is too long.');

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in to send messages.');

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: userData.user.id, body: text })
    .select('id, conversation_id, sender_id, body, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export function subscribeToConversation(conversationId, onMessage) {
  if (!conversationId || typeof onMessage !== 'function') return () => {};
  const channel = supabase
    .channel(`conversation:${conversationId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, payload => onMessage(payload.new))
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

export async function markConversationRead(conversationId) {
  const { data, error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return Number(data || 0);
}
