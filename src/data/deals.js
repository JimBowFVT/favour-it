import { serviceCategoryLabels } from './serviceCategories';

export const categories = serviceCategoryLabels;

const packageSet = (price, deliveryDays, serviceType = 'deliverable') => [
  { tier: 'basic', title: 'Basic', description: serviceType === 'session' ? 'One focused session with clear next steps.' : 'The core service with a focused scope.', price, priceFav: price * 1000000, deliveryDays, revisions: serviceType === 'session' ? 0 : 1, ...(serviceType === 'session' ? { sessionMinutes: 60 } : {}) },
  { tier: 'standard', title: 'Standard', description: serviceType === 'session' ? 'A deeper session with preparation and follow-up notes.' : 'A broader package with more depth and revisions.', price: Math.round(price * 1.6), priceFav: Math.round(price * 1.6) * 1000000, deliveryDays: Math.min(30, deliveryDays + 2), revisions: serviceType === 'session' ? 0 : 2, ...(serviceType === 'session' ? { sessionMinutes: 90 } : {}) },
  { tier: 'premium', title: 'Premium', description: serviceType === 'session' ? 'Extended guidance for a more complex goal.' : 'The most complete package for larger or higher-detail work.', price: Math.round(price * 2.3), priceFav: Math.round(price * 2.3) * 1000000, deliveryDays: Math.min(30, deliveryDays + 4), revisions: serviceType === 'session' ? 0 : 3, ...(serviceType === 'session' ? { sessionMinutes: 120 } : {}) },
];

const sample = (deal, serviceType = 'deliverable', requirements = '') => ({
  ...deal,
  sample: true,
  serviceType,
  buyerRequirements: requirements,
  packages: packageSet(deal.price, deal.deliveryDays, serviceType),
  faqs: [
    { question: 'Can we discuss the scope before ordering?', answer: 'Yes. Message the seller on a real listing before choosing a package.' },
    { question: 'How is payment protected?', answer: 'FAV is held in escrow until the order is completed or a dispute is resolved.' },
  ],
});

export const deals = [
  sample({ id: 1, title: 'I will design a modern brand identity for your business', seller: 'Alex Morgan', rating: 4.9, reviews: 128, price: 240, category: 'Graphic Design & Branding', accent: 'AM', delivery: '3 days', deliveryDays: 3 }, 'deliverable', 'Share your business name, audience, positioning, references and any existing brand assets.'),
  sample({ id: 2, title: 'I will build a fast landing page for your startup', seller: 'Noah Chen', rating: 5, reviews: 74, price: 420, category: 'Web Development', accent: 'NC', delivery: '5 days', deliveryDays: 5 }, 'deliverable', 'Send the page goal, copy or draft copy, brand assets and examples you like.'),
  sample({ id: 3, title: 'I will write conversion-focused website copy', seller: 'Mia Cohen', rating: 4.8, reviews: 91, price: 180, category: 'Writing & Copywriting', accent: 'MC', delivery: '2 days', deliveryDays: 2 }, 'deliverable', 'Share your audience, offer, brand voice, current page and the action you want visitors to take.'),
  sample({ id: 4, title: 'I will edit high-retention short-form videos for your brand', seller: 'Leo Smith', rating: 4.9, reviews: 56, price: 210, category: 'Video Editing & Motion', accent: 'LS', delivery: '3 days', deliveryDays: 3 }, 'deliverable', 'Upload the footage, brand guidelines, target platform and examples of editing styles you like.'),
  sample({ id: 5, title: 'I will create a complete social media content system', seller: 'Sofia Levi', rating: 4.7, reviews: 43, price: 260, category: 'Social Media & Content Marketing', accent: 'SL', delivery: '4 days', deliveryDays: 4 }, 'managed', 'Share your current channels, audience, goals, posting history and access level required for the package.'),
  sample({ id: 6, title: 'I will produce a custom beat for your project', seller: 'Daniel Ray', rating: 5, reviews: 37, price: 150, category: 'Music Production', accent: 'DR', delivery: '4 days', deliveryDays: 4 }, 'deliverable', 'Send references, mood, tempo preferences and how the final track will be used.'),
  sample({ id: 7, title: 'I will build an AI automation for your repetitive workflow', seller: 'Nina Park', rating: 4.9, reviews: 22, price: 560, category: 'AI & Automation', accent: 'NP', delivery: '7 days', deliveryDays: 7 }, 'deliverable', 'Describe the current workflow, tools involved, inputs, expected outputs and any access constraints.'),
  sample({ id: 8, title: 'I will coach you through your next career move', seller: 'Oren Blake', rating: 4.9, reviews: 31, price: 120, category: 'Coaching & Learning', accent: 'OB', delivery: '1 day', deliveryDays: 1 }, 'session', 'Share your current role, target direction and the biggest decision or obstacle you want to work through.'),
  sample({ id: 9, title: 'I will turn your raw data into a clear business dashboard', seller: 'Ava Kim', rating: 4.8, reviews: 18, price: 330, category: 'Data & Analytics', accent: 'AK', delivery: '5 days', deliveryDays: 5 }, 'deliverable', 'Provide the source data, metric definitions, reporting goals and preferred dashboard format.'),
  sample({ id: 10, title: 'I will create a polished investor pitch deck', seller: 'Eli Stone', rating: 5, reviews: 14, price: 290, category: 'Presentations & Business Documents', accent: 'ES', delivery: '3 days', deliveryDays: 3 }, 'deliverable', 'Send your company story, metrics, product information, existing slides and target audience.'),
  sample({ id: 11, title: 'I will audit and improve your technical SEO', seller: 'Maya Reed', rating: 4.8, reviews: 27, price: 230, category: 'SEO & Search Growth', accent: 'MR', delivery: '4 days', deliveryDays: 4 }, 'audit', 'Share the site URL, analytics/search console access if available, target market and current SEO priorities.'),
  sample({ id: 12, title: 'I will professionally edit and clean your podcast audio', seller: 'Jon Bell', rating: 4.9, reviews: 19, price: 110, category: 'Audio & Podcast Production', accent: 'JB', delivery: '2 days', deliveryDays: 2 }, 'deliverable', 'Upload the raw audio and share your desired loudness, edit style, intro/outro and export format.'),
];
