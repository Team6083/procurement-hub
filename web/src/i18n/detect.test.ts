import { describe, expect, it } from 'vitest';
import { detectLanguage, profileLanguage } from './detect';

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

describe('profileLanguage', () => {
  it('adopts any saved locale, including en', () => {
    expect(profileLanguage('zh-TW')).toBe('zh-TW');
    expect(profileLanguage('en')).toBe('en');
  });
  it('keeps browser detection when never chosen (null) or unknown', () => {
    expect(profileLanguage(null)).toBeNull();
    expect(profileLanguage(undefined)).toBeNull();
    expect(profileLanguage('fr')).toBeNull();
  });
});
