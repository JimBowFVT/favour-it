import { supabase } from './supabase';

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const getMyStaffRole = () => rpc('get_my_staff_role');
export const getAdminDashboardMetrics = () => rpc('admin_get_dashboard_metrics');
export const getAdminMediationOrders = () => rpc('admin_list_mediation_orders').then(data => Array.isArray(data) ? data : []);
export const getAdminMiddlemen = () => rpc('admin_list_middlemen').then(data => Array.isArray(data) ? data : []);
export const assignOrderMiddleman = (orderId, middlemanId) => rpc('assign_order_middleman', { p_order_id: orderId, p_middleman_id: middlemanId });
export const unassignOrderMiddleman = orderId => rpc('unassign_order_middleman', { p_order_id: orderId });
export const getMyMiddlemanQueue = () => rpc('get_my_middleman_queue').then(data => Array.isArray(data) ? data : []);
