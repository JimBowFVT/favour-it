export const ORDER_STATUS = {
  PENDING: 'pending',
  FUNDED: 'funded',
  IN_PROGRESS: 'in_progress',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  DISPUTED: 'disputed',
  CANCELLED: 'cancelled',
};

export const nextOrderStatus = (status) => {
  const flow = {
    [ORDER_STATUS.PENDING]: ORDER_STATUS.FUNDED,
    [ORDER_STATUS.FUNDED]: ORDER_STATUS.IN_PROGRESS,
    [ORDER_STATUS.IN_PROGRESS]: ORDER_STATUS.DELIVERED,
    [ORDER_STATUS.DELIVERED]: ORDER_STATUS.COMPLETED,
  };
  return flow[status] || status;
};

export const canAdvanceOrder = (status) => Boolean(nextOrderStatus(status) !== status);

export const formatFAV = (amount) => `${Number(amount || 0).toLocaleString()} FAV`;
