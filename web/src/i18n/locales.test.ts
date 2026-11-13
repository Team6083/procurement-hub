import { describe, expect, it } from 'vitest';
import { resources } from './index';

function keys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('locale key parity', () => {
  for (const ns of Object.keys(resources.en) as (keyof typeof resources.en)[]) {
    it(`en and zh-TW have identical keys in "${ns}"`, () => {
      expect(keys(resources['zh-TW'][ns]).sort()).toEqual(keys(resources.en[ns]).sort());
    });
  }
  it('has the same namespaces', () => {
    expect(Object.keys(resources['zh-TW']).sort()).toEqual(Object.keys(resources.en).sort());
  });
  it('has no empty strings', () => {
    for (const lng of Object.values(resources)) {
      for (const ns of Object.values(lng)) {
        const walk = (o: unknown): void => {
          if (typeof o === 'string') expect(o.trim()).not.toBe('');
          else if (o && typeof o === 'object') Object.values(o).forEach(walk);
        };
        walk(ns);
      }
    }
  });
});
