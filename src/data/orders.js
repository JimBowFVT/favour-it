export const orderStatuses = [
  'funded',
  'in_progress',
  'delivered',
  'completed',
  'disputed',
  'cancelled',
];

export const statusLabels = {
  funded: 'Payment secured',
  in_progress: 'In progress',
  delivered: 'Delivered',
  completed: 'Completed',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
};

export const demoOrders = [
  {
    id: 'FV-1042',
    title: 'Landing page redesign',
    seller: 'Maya Chen',
    category: 'Design',
    amount: 320,
    fee: 16,
    status: 'in_progress',
    updated: 'Today',
  },
  {
    id: 'FV-1037',
    title: 'React component cleanup',
    seller: 'Noah Chen',
    category: 'Development',
    amount: 240,
    fee: 12,
    status: 'completed',
    updated: 'Yesterday',
  },
];
