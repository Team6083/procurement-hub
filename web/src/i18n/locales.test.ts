import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resources } from './index';

function keys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

/** zh-TW has a single plural form, so en's `_one`/`_other` variants count as the base key. */
const base = (k: string) => k.replace(/_(one|other)$/, '');
const baseKeys = (obj: unknown) => [...new Set(keys(obj).map(base))].sort();

describe('locale key parity', () => {
  for (const ns of Object.keys(resources.en) as (keyof typeof resources.en)[]) {
    it(`en and zh-TW have identical keys in "${ns}"`, () => {
      expect(baseKeys(resources['zh-TW'][ns])).toEqual(baseKeys(resources.en[ns]));
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

describe('English plurals', () => {
  it('gives a counted noun both _one and _other', () => {
    const bad: string[] = [];
    for (const [ns, tree] of Object.entries(resources.en)) {
      const walk = (o: unknown, path: string): void => {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
          const p = path ? `${path}.${k}` : k;
          if (typeof v === 'string') {
            if (/\{\{count\}\}\s+(items?|lines?|teams?|entries|entry|deliveries)\b|item\(s\)/.test(v) && !/_(one|other)$/.test(k)) bad.push(`${ns}:${p}`);
          } else walk(v, p);
        }
      };
      walk(tree, '');
    }
    expect(bad).toEqual([]);
  });
});

describe('backend error codes', () => {
  it('has a translation for every business rule code the server can return', () => {
    const root = join(__dirname, '../../../server/internal');
    const codes = new Set<string>();
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.go') && !f.endsWith('_test.go')) {
          for (const m of readFileSync(p, 'utf8').matchAll(/Rule\("([a-z_]+)"/g)) codes.add(m[1]!);
        }
      }
    };
    walk(root);
    expect(codes.size).toBeGreaterThan(10);
    for (const lng of Object.values(resources)) {
      const have = Object.keys(lng.errors.codes);
      expect([...codes].filter((c) => !have.includes(c))).toEqual([]);
    }
  });
});
