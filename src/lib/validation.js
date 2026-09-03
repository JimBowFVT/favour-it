export const validateDeal = (deal) => {
  const errors = {};
  if (!deal.title?.trim()) errors.title = 'Add a title';
  if (!deal.description?.trim()) errors.description = 'Add a description';
  if (!deal.category?.trim()) errors.category = 'Choose a category';
  const price = Number(deal.price);
  if (!Number.isFinite(price) || price <= 0) errors.price = 'Enter a valid FAV price';
  return errors;
};

export const isValidEmail = (email) => /\S+@\S+\.\S+/.test(email || '');
