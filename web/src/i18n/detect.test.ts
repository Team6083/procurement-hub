import { describe, expect, it } from 'vitest';
import { detectLanguage, initialLanguage, profileLanguage } from './detect';

describe('detectLanguage', () => {
  it.each([
    [['zh-TW'], 'zh-TW'],
    [['zh-Hant-TW', 'en-US'], 'zh-TW'],
    [['zh-CN'], 'zh-TW'],
    [['zh'], 'zh-TW'],
    [['ZH-hk'], 'zh-TW'],
    [['en-GB', 'zh-TW'], 'en'],
    [['en'], 'en'],
    [['fr-FR', 'zh-TW'], 'zh-TW'],
    [['fr-FR', 'de'], 'en'],
    [['zhx'], 'en'],
    [[], 'en'],
    [undefined, 'en'],
  ] as const)('%j -> %s', (prefs, want) => {
    expect(detectLanguage(prefs)).toBe(want);
  });
});

describe('initialLanguage', () => {
  it('prefers a remembered choice over the browser', () => {
    expect(initialLanguage('en', ['zh-TW'])).toBe('en');
    expect(initialLanguage('zh-TW', ['en-US'])).toBe('zh-TW');
  });
  it('ignores junk and falls back to detection', () => {
    expect(initialLanguage('fr', ['zh-TW'])).toBe('zh-TW');
    expect(initialLanguage(null, ['de'])).toBe('en');
  });
});

describe('profileLanguage', () => {
  it('always adopts a non-default saved locale', () => {
    expect(profileLanguage('zh-TW', false)).toBe('zh-TW');
    expect(profileLanguage('zh-TW', true)).toBe('zh-TW');
  });
  it('adopts the default locale only after a choice was made in this browser', () => {
    expect(profileLanguage('en', false)).toBeNull();
    expect(profileLanguage('en', true)).toBe('en');
  });
  it('ignores unknown locales', () => {
    expect(profileLanguage('fr', true)).toBeNull();
    expect(profileLanguage(undefined, true)).toBeNull();
  });
});
