import { supabase } from './supabase';
import { resolveServiceCategory, serviceCategoryLabels } from '../data/serviceCategories';

const MICRO_FAV = 1000000;
const PACKAGE_TIERS = ['basic', 'standard', 'premium'];
const SERVICE_TYPES = ['deliverable', 'session', 'managed', 'audit'];

function normalizePackage(raw = {}) {
  const priceFav = Number(raw.price_fav ?? raw.priceFav ?? (Number(raw.price || 0) * MICRO_FAV) ?? 0);
  const deliveryDays = Number(raw.delivery_days ?? raw.deliveryDays ?? 1);
  return {
    tier: String(raw.tier || 'basic').toLowerCase(),
    title: String(raw.title || 'Basic'),
    description: String(raw.description || ''),
    priceFav,
    price: priceFav / MICRO_FAV,
    deliveryDays,
    delivery: `${deliveryDays} day${deliveryDays === 1 ? '' : 's'}`,
    revisions: Number(raw.revisions ?? 0),
    sessionMinutes: Number(raw.session_minutes ?? raw.sessionMinutes ?? 0) || null,
  };
}

function normalizePackages(row) {
  const raw = Array.isArray(row?.packages) ? row.packages : [];
  if (raw.length) {
    return raw.map(normalizePackage).sort((a, b) => PACKAGE_TIERS.indexOf(a.tier) - PACKAGE_TIERS.indexOf(b.tier));
  }
  return [normalizePackage({
    tier: 'basic',
    title: 'Basic',
    description: 'Core service package',
    price_fav: Number(row?.price_fav || 0),
    delivery_days: Number(row?.delivery_days || 1),
    revisions: 1,
  })];
}

function normalizeDeal(row, seller = {}, stats = {}) {
  const packages = normalizePackages(row);
  const starting = packages.reduce((lowest, item) => (!lowest || item.price < lowest.price ? item : lowest), null);
  const selectedCategory = resolveServiceCategory(row?.category);
  const sellerName = seller.display_name || seller.displayName || row?.seller_name || row?.seller || 'Favourit seller';
  const rating = Number(stats.rating ?? row?.rating ?? 0);
  const reviewCount = Number(stats.reviews ?? row?.reviews ?? 0);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    seller: sellerName,
    sellerId: row.seller_id || seller.id,
    sellerUsername: seller.username || row.seller_username || '',
    sellerAvatarUrl: seller.avatar_url || row.seller_avatar_url || '',
    sellerBio: seller.bio || row.seller_bio || '',
    sellerVerified: Boolean(seller.is_verified ?? row.seller_verified),
    rating: rating || null,
    reviews: reviewCount,
    completedOrders: Number(stats.completed_orders ?? row.completed_orders ?? 0),
    price: starting?.price ?? Number(row.price_fav || 0) / MICRO_FAV,
    priceFav: starting?.priceFav ?? Number(row.price_fav || 0),
    category: selectedCategory?.label || row.category,
    delivery: starting?.delivery || `${row.delivery_days || 1} days`,
    deliveryDays: starting?.deliveryDays || Number(row.delivery_days || 1),
    serviceType: SERVICE_TYPES.includes(row.service_type) ? row.service_type : 'deliverable',
    buyerRequirements: row.buyer_requirements || '',
    packages,
    faqs: Array.isArray(row.faqs) ? row.faqs : [],
    portfolio: Array.isArray(row.portfolio) ? row.portfolio : [],
    status: row.status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function getSellerProfiles(rows) {
  const sellerIds = [...new Set((rows || []).map(row => row.seller_id).filter(Boolean))];
  if (!sellerIds.length) return {};
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio, is_verified')
    .in('id', sellerIds);
  if (error) throw error;
  return Object.fromEntries((profiles || []).map(profile => [profile.id, profile]));
}

async function getSellerReviewStats(rows) {
  const sellerIds = [...new Set((rows || []).map(row => row.seller_id).filter(Boolean))];
  if (!sellerIds.length) return {};
  const { data: reviews, error } = await supabase.from('reviews').select('seller_id, rating').in('seller_id', sellerIds);
  if (error) throw error;
  const buckets = {};
  (reviews || []).forEach(review => {
    if (!buckets[review.seller_id]) buckets[review.seller_id] = { sum: 0, reviews: 0 };
    buckets[review.seller_id].sum += Number(review.rating || 0);
    buckets[review.seller_id].reviews += 1;
  });
  return Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, {
    rating: value.reviews ? Math.round((value.sum / value.reviews) * 100) / 100 : 0,
    reviews: value.reviews,
  }]));
}

const DEAL_SELECT = 'id, seller_id, title, description, category, price_fav, delivery_days, status, created_at, updated_at, service_type, buyer_requirements, packages, faqs, portfolio';

export async function getPublishedDeals() {
  const { data, error } = await supabase.from('deals').select(DEAL_SELECT).eq('status', 'published').order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const [profileMap, reviewStats] = await Promise.all([getSellerProfiles(rows), getSellerReviewStats(rows)]);
  return rows.map(row => normalizeDeal(row, profileMap[row.seller_id], reviewStats[row.seller_id]));
}

export async function getDealById(dealId) {
  if (!dealId) return null;
  const { data, error } = await supabase.rpc('get_deal_marketplace_detail', { p_deal_id: dealId });
  if (error) throw error;
  if (!data?.deal) return null;
  return {
    ...normalizeDeal(data.deal, data.seller || {}, data.stats || {}),
    reviewItems: Array.isArray(data.reviews) ? data.reviews : [],
  };
}

function cleanFaqs(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    question: String(item?.question || '').trim().slice(0, 180),
    answer: String(item?.answer || '').trim().slice(0, 800),
  })).filter(item => item.question && item.answer).slice(0, 8);
}

function cleanPortfolio(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    title: String(item?.title || '').trim().slice(0, 100),
    url: String(item?.url || '').trim().slice(0, 1000),
  })).filter(item => item.title && /^https?:\/\//i.test(item.url)).slice(0, 6);
}

function cleanPackages(items) {
  const source = Array.isArray(items) ? items : [];
  return source.map((item, index) => {
    const tier = PACKAGE_TIERS.includes(String(item?.tier || '').toLowerCase()) ? String(item.tier).toLowerCase() : PACKAGE_TIERS[index] || 'basic';
    const price = Number(item?.price);
    const deliveryDays = Number(item?.deliveryDays);
    const revisions = Number(item?.revisions);
    if (!Number.isFinite(price) || price < 0.01) throw new Error(`${tier} package needs a valid FAV price.`);
    if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 30) throw new Error(`${tier} package delivery must be between 1 and 30 days.`);
    if (!Number.isInteger(revisions) || revisions < 0 || revisions > 99) throw new Error(`${tier} package revisions must be between 0 and 99.`);
    return {
      tier,
      title: String(item?.title || tier).trim().slice(0, 60),
      description: String(item?.description || '').trim().slice(0, 500),
      price_fav: Math.round(price * MICRO_FAV),
      delivery_days: deliveryDays,
      revisions,
      ...(Number(item?.sessionMinutes) > 0 ? { session_minutes: Math.min(480, Math.max(15, Math.round(Number(item.sessionMinutes)))) } : {}),
    };
  }).filter(item => item.title).slice(0, 3);
}

export async function createDeal({ title, description, category, serviceType = 'deliverable', buyerRequirements = '', packages = [], faqs = [], portfolio = [] }) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in to publish a deal.');

  const selectedCategory = resolveServiceCategory(category);
  if (!selectedCategory || !serviceCategoryLabels.includes(selectedCategory.label)) throw new Error('Choose an approved Favourit service category.');
  if (!SERVICE_TYPES.includes(serviceType)) throw new Error('Choose a supported service type.');

  const clean = cleanPackages(packages);
  if (!clean.length) throw new Error('Create at least one service package.');

  const { data, error } = await supabase.rpc('create_deal_v2', {
    p_title: String(title || '').trim(),
    p_description: String(description || '').trim(),
    p_category: selectedCategory.label,
    p_service_type: serviceType,
    p_buyer_requirements: String(buyerRequirements || '').trim(),
    p_packages: clean,
    p_faqs: cleanFaqs(faqs),
    p_portfolio: cleanPortfolio(portfolio),
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Deal was not created.');
  return normalizeDeal(row, {
    id: userData.user.id,
    display_name: userData.user.user_metadata?.display_name,
    username: userData.user.user_metadata?.username,
  }, {});
}

export { normalizeDeal };
