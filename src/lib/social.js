import { supabase } from './supabase';

function requireClient() { if (!supabase) throw new Error('Favourit backend is not configured yet.'); }
function call(name, args = {}) { requireClient(); return supabase.rpc(name, args).then(({ data, error }) => { if (error) throw error; return data; }); }

export const getMySocialGraph = () => call('get_my_social_graph');
export const searchCommunityPeople = query => call('search_community_people', { p_query: query });
export const sendFriendRequest = userId => call('send_friend_request', { p_user_id: userId });
export const respondFriendRequest = (requestId, action) => call('respond_friend_request', { p_request_id: requestId, p_action: action });
export const cancelFriendRequest = requestId => call('cancel_friend_request', { p_request_id: requestId });
export const removeFriend = userId => call('remove_friend', { p_user_id: userId });
export const blockUser = userId => call('block_user', { p_user_id: userId });
export const unblockUser = userId => call('unblock_user', { p_user_id: userId });
export const listCommunityGroups = () => call('list_public_community_groups');
export const joinCommunityGroup = groupId => call('join_community_group', { p_group_id: groupId });
export const leaveCommunityGroup = groupId => call('leave_community_group', { p_group_id: groupId });
export const getCommunityGroupMessages = groupId => call('get_community_group_messages', { p_group_id: groupId });
export const sendCommunityGroupMessage = (groupId, body) => call('send_community_group_message', { p_group_id: groupId, p_body: body });
export const getCommunityGroupMembers = groupId => call('get_community_group_members', { p_group_id: groupId });
