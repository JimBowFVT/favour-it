import { normalizeLanguageCode } from '../data/languages';

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function translateMessageText(text, targetLanguage) {
  const original = String(text || '');
  const target = normalizeLanguageCode(targetLanguage);
  if (!original.trim()) return { text: original, failed: true };

  try {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(original)}&langpair=auto|${encodeURIComponent(target)}`);
    if (!response.ok) return { text: original, failed: true };
    const data = await response.json();
    const translated = String(data?.responseData?.translatedText || '').trim();
    const responseStatus = Number(data?.responseStatus || 200);
    if (!translated || responseStatus >= 400) return { text: original, failed: true };

    // Translation services normally preserve unknown letters, names and words while translating
    // the rest of the sentence. If nothing at all changed, keep the original and surface failure.
    if (compact(translated).toLocaleLowerCase() === compact(original).toLocaleLowerCase()) {
      return { text: original, failed: true };
    }
    return { text: translated, failed: false };
  } catch (_) {
    return { text: original, failed: true };
  }
}
