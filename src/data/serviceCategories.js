export const serviceFamilies = [
  { id: 'creative', label: 'Creative & Design', icon: '✦', description: 'Visual identity, interfaces, art and digital presentation.' },
  { id: 'media', label: 'Video, Audio & Media', icon: '▶', description: 'Video, animation, photography, music, audio and voice.' },
  { id: 'writing', label: 'Writing & Language', icon: 'Aa', description: 'Writing, editing, translation and localization.' },
  { id: 'tech', label: 'Development & Tech', icon: '</>', description: 'Software, web, AI, data, cloud, security and QA.' },
  { id: 'growth', label: 'Growth & Commerce', icon: '↗', description: 'Marketing, sales, ecommerce and customer growth.' },
  { id: 'business', label: 'Business & Operations', icon: '◇', description: 'Strategy, operations, admin, research and recruiting.' },
  { id: 'learning', label: 'Coaching & Learning', icon: '◎', description: 'Coaching, tutoring, lessons and skill development.' },
  { id: 'specialized', label: 'Specialized Services', icon: '⌁', description: 'Creator, community, accessibility and remote planning services.' },
];

export const serviceCategories = [
  { id: 'graphic-design-branding', label: 'Graphic Design & Branding', family: 'creative', keywords: ['logo', 'branding', 'brand identity', 'packaging', 'thumbnail', 'poster'] },
  { id: 'ui-ux-product-design', label: 'UI / UX & Product Design', family: 'creative', keywords: ['figma', 'wireframe', 'prototype', 'app design', 'web design', 'design system'] },
  { id: 'illustration-digital-art', label: 'Illustration & Digital Art', family: 'creative', keywords: ['illustration', 'character', 'concept art', 'portrait', 'vector', 'pixel art'] },
  { id: '3d-design-visualization', label: '3D Design & Visualization', family: 'creative', keywords: ['3d', 'render', 'modeling', 'visualization', 'cad', 'mockup'] },
  { id: 'interior-spatial-design', label: 'Interior & Spatial Design', family: 'creative', keywords: ['interior', 'room', 'layout', 'moodboard', 'space planning'] },
  { id: 'fashion-personal-styling', label: 'Fashion & Personal Styling', family: 'creative', keywords: ['styling', 'wardrobe', 'outfit', 'fashion'] },

  { id: 'video-editing-motion', label: 'Video Editing & Motion', family: 'media', keywords: ['video', 'editing', 'shorts', 'reels', 'tiktok', 'youtube', 'motion', 'animation'] },
  { id: 'photography-image-editing', label: 'Photography & Image Editing', family: 'media', keywords: ['photo', 'retouching', 'background removal', 'lightroom', 'restoration'] },
  { id: 'music-production', label: 'Music Production', family: 'media', keywords: ['music', 'beat', 'mixing', 'mastering', 'song', 'jingle'] },
  { id: 'audio-podcast-production', label: 'Audio & Podcast Production', family: 'media', keywords: ['podcast', 'audio editing', 'sound design', 'noise cleanup'] },
  { id: 'voice-over-narration', label: 'Voice Over & Narration', family: 'media', keywords: ['voice over', 'narration', 'audiobook', 'character voice'] },

  { id: 'writing-copywriting', label: 'Writing & Copywriting', family: 'writing', keywords: ['article', 'blog', 'copywriting', 'website copy', 'script', 'newsletter'] },
  { id: 'editing-proofreading', label: 'Editing, Proofreading & Content Review', family: 'writing', keywords: ['proofreading', 'editing', 'rewrite', 'grammar', 'manuscript'] },
  { id: 'translation-localization', label: 'Translation & Localization', family: 'writing', keywords: ['translation', 'localization', 'transcription', 'subtitles', 'language'] },

  { id: 'web-development', label: 'Web Development', family: 'tech', keywords: ['website', 'landing page', 'wordpress', 'webflow', 'frontend', 'backend'] },
  { id: 'mobile-app-development', label: 'Mobile App Development', family: 'tech', keywords: ['ios', 'android', 'flutter', 'react native', 'mobile app'] },
  { id: 'software-development', label: 'Software Development', family: 'tech', keywords: ['software', 'api', 'script', 'integration', 'desktop app'] },
  { id: 'ai-automation', label: 'AI & Automation', family: 'tech', keywords: ['ai', 'agent', 'chatbot', 'automation', 'rag', 'workflow', 'prompt'] },
  { id: 'data-analytics', label: 'Data & Analytics', family: 'tech', keywords: ['data', 'dashboard', 'sql', 'excel', 'power bi', 'tableau', 'reporting'] },
  { id: 'data-science-ml', label: 'Data Science & Machine Learning', family: 'tech', keywords: ['machine learning', 'forecasting', 'model', 'statistics', 'data science'] },
  { id: 'cloud-devops', label: 'Cloud, DevOps & Infrastructure', family: 'tech', keywords: ['aws', 'gcp', 'azure', 'docker', 'ci cd', 'deployment', 'server'] },
  { id: 'cybersecurity', label: 'Cybersecurity', family: 'tech', keywords: ['security', 'hardening', 'authorized audit', 'defensive security', 'vulnerability assessment'] },
  { id: 'qa-testing', label: 'QA & Software Testing', family: 'tech', keywords: ['qa', 'testing', 'bug report', 'cross browser', 'usability testing'] },
  { id: 'technical-documentation', label: 'Technical Documentation & Knowledge Bases', family: 'tech', keywords: ['documentation', 'api docs', 'manual', 'knowledge base', 'sop'] },

  { id: 'seo-search-growth', label: 'SEO & Search Growth', family: 'growth', keywords: ['seo', 'keywords', 'technical seo', 'local seo', 'search'] },
  { id: 'paid-advertising', label: 'Paid Advertising', family: 'growth', keywords: ['google ads', 'meta ads', 'tiktok ads', 'media buying', 'ppc'] },
  { id: 'social-content-marketing', label: 'Social Media & Content Marketing', family: 'growth', keywords: ['social media', 'content marketing', 'content calendar', 'organic growth'] },
  { id: 'email-crm-marketing', label: 'Email, CRM & Marketing Systems', family: 'growth', keywords: ['email marketing', 'crm', 'klaviyo', 'mailchimp', 'segmentation'] },
  { id: 'sales-lead-generation', label: 'Sales & Lead Generation', family: 'growth', keywords: ['leads', 'sales', 'outreach', 'appointment setting', 'pipeline'] },
  { id: 'ecommerce-online-stores', label: 'Ecommerce & Online Stores', family: 'growth', keywords: ['shopify', 'etsy', 'amazon listing', 'ecommerce', 'online store', 'product listing'] },

  { id: 'business-strategy-consulting', label: 'Business Strategy & Consulting', family: 'business', keywords: ['business strategy', 'consulting', 'pricing', 'go to market', 'startup'] },
  { id: 'operations-project-management', label: 'Operations & Project Management', family: 'business', keywords: ['operations', 'project management', 'sop', 'workflow', 'coordination'] },
  { id: 'virtual-assistance-support', label: 'Virtual Assistance & Customer Support', family: 'business', keywords: ['virtual assistant', 'customer support', 'admin', 'email management', 'scheduling'] },
  { id: 'finance-bookkeeping-support', label: 'Finance & Bookkeeping Support', family: 'business', keywords: ['bookkeeping', 'invoice', 'financial spreadsheet', 'expense categorization'] },
  { id: 'research-market-intelligence', label: 'Research & Market Intelligence', family: 'business', keywords: ['research', 'competitor research', 'market research', 'customer research'] },
  { id: 'presentations-business-documents', label: 'Presentations & Business Documents', family: 'business', keywords: ['pitch deck', 'presentation', 'proposal', 'report', 'document'] },
  { id: 'career-recruiting', label: 'Career & Recruiting', family: 'business', keywords: ['resume', 'cv', 'linkedin', 'interview', 'recruiting', 'candidate sourcing'] },

  { id: 'coaching-learning', label: 'Coaching & Learning', family: 'learning', keywords: ['coaching', 'career coaching', 'business coaching', 'creator coaching', 'leadership', 'public speaking', 'tutoring', 'lessons'] },
  { id: 'fitness-wellness-accountability', label: 'Fitness, Wellness & Accountability Coaching', family: 'learning', keywords: ['fitness coaching', 'wellness', 'accountability', 'habits', 'productivity'] },

  { id: 'gaming-game-services', label: 'Gaming & Game Services', family: 'specialized', keywords: ['gaming', 'game development', 'unity', 'unreal', 'gaming coaching', 'vod review'] },
  { id: 'streaming-creator-services', label: 'Streaming & Creator Services', family: 'specialized', keywords: ['streaming', 'obs', 'stream overlay', 'creator', 'youtube channel', 'podcast setup'] },
  { id: 'community-management', label: 'Community Management', family: 'specialized', keywords: ['discord', 'community management', 'moderation', 'member engagement'] },
  { id: 'accessibility-services', label: 'Accessibility Services', family: 'specialized', keywords: ['accessibility', 'wcag', 'captions', 'alt text', 'a11y'] },
  { id: 'travel-event-planning', label: 'Travel & Event Planning', family: 'specialized', keywords: ['travel planning', 'itinerary', 'event planning', 'vendor research'] },
];

export const serviceCategoryLabels = serviceCategories.map(category => category.label);

export const featuredCategoryIds = [
  'graphic-design-branding',
  'video-editing-motion',
  'web-development',
  'ai-automation',
  'social-content-marketing',
  'writing-copywriting',
  'coaching-learning',
  'business-strategy-consulting',
  'music-production',
  'data-analytics',
];

const legacyAliases = {
  Design: 'Graphic Design & Branding',
  Development: 'Web Development',
  Writing: 'Writing & Copywriting',
  Marketing: 'Social Media & Content Marketing',
  Video: 'Video Editing & Motion',
  Music: 'Music Production',
  Business: 'Business Strategy & Consulting',
  Lifestyle: 'Coaching & Learning',
};

export function resolveServiceCategory(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const aliased = legacyAliases[raw] || raw;
  return serviceCategories.find(category => category.label === aliased || category.id === aliased) || null;
}

export function getServiceFamily(categoryValue) {
  const category = resolveServiceCategory(categoryValue);
  return category ? serviceFamilies.find(family => family.id === category.family) || null : null;
}

export function serviceSearchText(categoryValue) {
  const category = resolveServiceCategory(categoryValue);
  if (!category) return String(categoryValue || '');
  const family = serviceFamilies.find(item => item.id === category.family);
  return [category.label, family?.label, ...(category.keywords || [])].filter(Boolean).join(' ');
}
