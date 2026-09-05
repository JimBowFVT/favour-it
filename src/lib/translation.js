import { normalizeLanguageCode } from '../data/languages';
import { supabase } from './supabase';

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function failed(original) {
  return { text: original, failed: true };
}

function detectSource(text) {
  if (/[\u0590-\u05ff]/u.test(text)) return 'he';
  if (/[\u0600-\u06ff]/u.test(text)) return 'ar';
  if (/[\u0400-\u04ff]/u.test(text)) return 'ru';
  if (/[\u0370-\u03ff]/u.test(text)) return 'el';
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/u.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/u.test(text)) return 'zh';
  return 'en';
}

export async function translateMessageText(text, targetLanguage) {
  const original = String(text || '');
  const target = normalizeLanguageCode(targetLanguage);
  if (!original.trim()) return failed(original);

  try {
    if (supabase?.functions?.invoke) {
      const { data, error } = await supabase.functions.invoke('translate-message', {
        body: { text: original, targetLanguage: target },
      });
      const translated = String(data?.translatedText || '').trim();
      if (!error && translated) {
        return { text: translated, failed: false, provider: data?.provider || 'server' };
      }
    }
  } catch (_) {}

  // Browser fallback if the edge function is temporarily unavailable.
  try {
    const source = detectSource(original);
    if (source === target) return { text: original, failed: false, provider: 'same-language' };
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(original)}&langpair=${encodeURIComponent(source)}|${encodeURIComponent(target)}`);
    if (!response.ok) return failed(original);
    const data = await response.json();
    const translated = String(data?.responseData?.translatedText || '').trim();
    const responseStatus = Number(data?.responseStatus || 200);
    if (!translated || responseStatus >= 400) return failed(original);
    if (compact(translated).toLocaleLowerCase() === compact(original).toLocaleLowerCase() && source !== target) return failed(original);
    return { text: translated, failed: false, provider: 'mymemory' };
  } catch (_) {
    return failed(original);
  }
}
