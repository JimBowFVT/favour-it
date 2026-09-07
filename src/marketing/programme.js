export const PILOT_DISCLOSURE = 'Private pilot. FAV is usable inside Favourit. Cash-out is unavailable during this pilot.';
export const CONSENT_VERSION = 'founding-creators-2026-09-07';
export const SERVICE_AREAS = ['Visual design', 'Short-form video', 'Writing'];

export function isFoundingPath(path) {
  return (path.replace(/\/+$/, '') || '/') === '/founding-creators';
}

export function getAttribution(search = '') {
  const params = new URLSearchParams(search);
  const clean = key => (params.get(key) || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
  return { source: clean('utm_source') || 'direct', medium: clean('utm_medium'), campaign: clean('utm_campaign'), referral: clean('ref') };
}

export function validateApplication(data) {
  const errors = {};
  if (!data.name?.trim() || data.name.trim().length > 100) errors.name = 'Enter your name (up to 100 characters).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || '') || data.email.length > 254) errors.email = 'Enter a valid email address.';
  if (!SERVICE_AREAS.includes(data.area)) errors.area = 'Choose your main service area.';
  for (const field of ['offer', 'need']) if ((data[field]?.trim().length || 0) < 20 || data[field].length > 1200) errors[field] = 'Use 20–1,200 characters to describe a specific service.';
  if (!data.availability?.trim() || data.availability.length > 200) errors.availability = 'Tell us when you can participate (up to 200 characters).';
  try { const url = new URL(data.portfolio); if (url.protocol !== 'https:' || url.username || url.password || data.portfolio.length > 1000) throw new Error(); }
  catch (_) { errors.portfolio = 'Use a public HTTPS link to your work.'; }
  if (!data.pilotConsent) errors.pilotConsent = 'Confirm that you understand the pilot restrictions.';
  if (!data.contactConsent) errors.contactConsent = 'Allow us to contact you about this application.';
  if (!data.adultConsent) errors.adultConsent = 'This founding pilot is for adults aged 18 and over.';
  return errors;
}

export async function submitApplication(client, values, attribution) {
  if (!client) throw new Error('Applications are not open yet. Nothing has been sent.');
  const errors = validateApplication(values);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const { data, error } = await client.rpc('submit_founding_application', {
    p_application: {
      name: values.name.trim(), email: values.email.trim().toLowerCase(), area: values.area,
      offer: values.offer.trim(), need: values.need.trim(), portfolio: values.portfolio.trim(),
      availability: values.availability.trim(), pilot_consent: values.pilotConsent === true,
      contact_consent: values.contactConsent === true, adult_consent: values.adultConsent === true,
      digest_consent: values.digestConsent === true, consent_version: CONSENT_VERSION,
      website: values.website || '', attribution,
    },
  });
  if (error) throw new Error(error.message || 'We could not send your application. Please try again.');
  if (data?.received !== true) throw new Error('Your application was not confirmed. Please try again.');
  return data;
}
