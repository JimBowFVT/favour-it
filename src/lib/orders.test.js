import { normalizeOrder } from './orders';

describe('order normalization', () => {
  test('keeps buyer and seller identities plus immutable scope', () => {
    const order = normalizeOrder({
      id: 'order-1',
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      buyer_name: 'Buyer One',
      seller_name: 'Seller One',
      buyer_username: 'buyerone',
      seller_username: 'sellerone',
      amount_fav: 100_000_000,
      buyer_fee_fav: 3_000_000,
      seller_fee_fav: 3_000_000,
      buyer_total_fav: 103_000_000,
      status: 'delivered',
      category: 'Web Development',
      package_snapshot: {
        tier: 'standard',
        title: 'Standard build',
        description: 'A scoped delivery',
        delivery_days: 5,
        revisions: 2,
        service_type: 'deliverable',
        deal_description: 'Original deal scope',
        buyer_requirements: 'Send your goals, references and access details.',
        buyer_brief: 'Goal: launch the landing page next week. References and staging access are attached in Messages.',
        buyer_brief_captured_at: '2026-09-06T16:30:00Z',
      },
      review: { rating: 5, body: 'Great work' },
    });

    expect(order.buyer).toBe('Buyer One');
    expect(order.seller).toBe('Seller One');
    expect(order.buyerUsername).toBe('buyerone');
    expect(order.sellerUsername).toBe('sellerone');
    expect(order.category).toBe('Web Development');
    expect(order.packageTitle).toBe('Standard build');
    expect(order.buyerTotal).toBe(103);
    expect(order.sellerFee).toBe(3);
    expect(order.sellerPayout).toBe(97);
    expect(order.review.rating).toBe(5);
    expect(order.buyerRequirements).toBe('Send your goals, references and access details.');
    expect(order.buyerBrief).toMatch(/launch the landing page/);
    expect(order.buyerBriefCapturedAt).toBe('2026-09-06T16:30:00Z');
  });

  test('falls back safely for legacy orders without fee or brief snapshots', () => {
    const order = normalizeOrder({
      id: 'legacy-order',
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      amount_fav: 25_000_000,
      fee_fav: 1_000_000,
      status: 'funded',
      package_snapshot: {},
    });

    expect(order.amount).toBe(25);
    expect(order.buyerTotal).toBe(25);
    expect(order.sellerPayout).toBe(24);
    expect(order.packageTier).toBe('basic');
    expect(order.buyerBrief).toBe('');
  });
});

test('order history prefers the original title and category over an edited service listing', () => {
  const order = normalizeOrder({ title: 'Edited title', category: 'Edited category', package_snapshot: { deal_title: 'Original service', deal_category: 'Original category' } });
  expect(order.title).toBe('Original service');
  expect(order.category).toBe('Original category');
});
