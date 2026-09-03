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

export const filterDeals = (deals = [], { query = '', category = 'All' } = {}) => {
  const q = String(query).trim().toLowerCase();
  return deals.filter((deal) => {
    const categoryMatch = category === 'All' || deal.category === category;
    if (!categoryMatch) return false;
    if (!q) return true;
    return `${deal.title || ''} ${deal.category || ''} ${deal.seller || ''} ${deal.description || ''}`.toLowerCase().includes(q);
  });
};

export const sortDeals = (deals = [], sort = 'recommended') => {
  const result = [...deals];
  if (sort === 'price-low') result.sort((a,b) => Number(a.price || 0) - Number(b.price || 0));
  if (sort === 'price-high') result.sort((a,b) => Number(b.price || 0) - Number(a.price || 0));
  if (sort === 'rating') result.sort((a,b) => Number(b.rating || 0) - Number(a.rating || 0));
  return result;
};
