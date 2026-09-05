import { supabase } from './supabase';

export const MAX_MESSAGE_MEDIA_FILES = 4;
export const MAX_MESSAGE_MEDIA_BYTES = 50 * 1024 * 1024;
export const MESSAGE_MEDIA_BUCKET = 'message-media';

const ALLOWED = new Map([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/webp', 'image'],
  ['image/gif', 'image'],
  ['video/mp4', 'video'],
  ['video/webm', 'video'],
  ['video/quicktime', 'video'],
]);

function requireClient() {
  if (!supabase) throw new Error('Favourit backend is not configured yet.');
}

function safeFileName(value = 'media') {
  return String(value)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120) || 'media';
}

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function validateMessageMediaFile(file) {
  if (!file) throw new Error('Choose a photo or video.');
  const mediaType = ALLOWED.get(String(file.type || '').toLowerCase());
  if (!mediaType) throw new Error('Use JPG, PNG, WebP, GIF, MP4, WebM or MOV media.');
  if (!file.size || file.size > MAX_MESSAGE_MEDIA_BYTES) throw new Error('Each media file must be 50 MB or smaller.');
  return mediaType;
}

export async function uploadMessageMedia(file) {
  requireClient();
  const mediaType = validateMessageMediaFile(file);
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('You must be signed in.');

  const path = `${user.id}/${randomId()}-${safeFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(MESSAGE_MEDIA_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  try {
    const { data: assetId, error: registerError } = await supabase.rpc('register_message_media_asset', {
      p_storage_path: path,
      p_media_type: mediaType,
      p_mime_type: file.type,
      p_file_name: file.name || 'media',
      p_size_bytes: file.size,
    });
    if (registerError) throw registerError;
    const { data: signed, error: signedError } = await supabase.storage.from(MESSAGE_MEDIA_BUCKET).createSignedUrl(path, 60 * 60);
    if (signedError) throw signedError;
    return {
      asset_id: assetId,
      storage_path: path,
      media_type: mediaType,
      mime_type: file.type,
      file_name: file.name || 'media',
      size_bytes: file.size,
      url: signed?.signedUrl || '',
    };
  } catch (error) {
    try { await supabase.storage.from(MESSAGE_MEDIA_BUCKET).remove([path]); } catch (_) {}
    throw error;
  }
}

export async function hydrateMessageAttachments(messages) {
  requireClient();
  const safe = Array.isArray(messages) ? messages : [];
  const paths = [...new Set(safe.flatMap(message => Array.isArray(message?.attachments) ? message.attachments : []).map(item => item?.storage_path).filter(Boolean))];
  if (!paths.length) return safe;

  const urls = new Map();
  await Promise.all(paths.map(async path => {
    try {
      const { data, error } = await supabase.storage.from(MESSAGE_MEDIA_BUCKET).createSignedUrl(path, 60 * 60);
      if (!error && data?.signedUrl) urls.set(path, data.signedUrl);
    } catch (_) {}
  }));

  return safe.map(message => ({
    ...message,
    attachments: (Array.isArray(message?.attachments) ? message.attachments : []).map(item => ({ ...item, url: urls.get(item.storage_path) || '' })),
  }));
}
