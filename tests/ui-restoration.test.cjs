const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, readdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const baseline = require('./ui-restoration-baseline.json');
test('original application, signup, crypto presentation, Explore and every original stylesheet are restored byte for byte', () => {
  for (const [file, hash] of Object.entries(baseline.sha256)) {
    assert.equal(createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'), hash, file);
  }
});
test('unapproved global sidebar, wallet pages, reward/setup cards and styles are absent', () => {
  for (const file of ['AppSidebar.js','AppSidebar.css','WalletPage.js','WalletPage.css','DailyRewardCard.js','WalletAccountSetup.js']) {
    assert.equal(existsSync(path.join(root, 'src/components', file)), false, file);
  }
});
test('production source contains no abandoned global navigation or WalletPage references', () => {
  for (const file of readdirSync(path.join(root, 'src'), { recursive: true })) {
    if (!/\.(js|css)$/.test(file) || file.endsWith('.test.js')) continue;
    const text = readFileSync(path.join(root, 'src', file), 'utf8');
    assert.equal(/AppSidebar|WalletPage|sidebar-expanded|app-menu-toggle|wallet-page/.test(text), false, file);
  }
});
