export const languages = [
  ['en', 'English'],
  ['he', 'Hebrew'],
  ['ar', 'Arabic'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['tr', 'Turkish'],
  ['nl', 'Dutch'],
  ['pl', 'Polish'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['hi', 'Hindi'],
  ['id', 'Indonesian'],
  ['vi', 'Vietnamese'],
  ['th', 'Thai'],
].map(([code, label]) => ({ code, label }));

export const normalizeLanguageCode = value => {
  const code = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
  return languages.some(language => language.code === code) ? code : 'en';
};

export const getLanguageLabel = value => {
  const code = normalizeLanguageCode(value);
  return languages.find(language => language.code === code)?.label || 'English';
};
