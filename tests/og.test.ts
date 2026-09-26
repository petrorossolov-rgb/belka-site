// OG-карточка (npm run build:og) закоммичена в src/assets/og/default.png: размер 1200×630 и вес
// под WhatsApp. Вес после перекодирования getImage в сборке держит check-dist-seo.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OG_IMAGE_MAX_BYTES, pngSize } from '../scripts/check-dist-seo.mjs';
import { OG_SIZE, readSlogan } from '../scripts/build-og.mjs';

const OG = fileURLToPath(new URL('../src/assets/og/default.png', import.meta.url));
const SITE = fileURLToPath(new URL('../src/content/site.yaml', import.meta.url));

describe('OG-карточка', () => {
  it('PNG 1200×630', () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
    expect(pngSize(readFileSync(OG))).toEqual(OG_SIZE);
  });

  it('не больше 300 КБ', () => {
    expect(statSync(OG).size).toBeLessThanOrEqual(OG_IMAGE_MAX_BYTES);
  });

  it('site.yaml ссылается на эту карточку и даёт ей alt', () => {
    const yaml = readFileSync(SITE, 'utf8');
    expect(yaml).toMatch(/^\s+defaultOgImage: \.\.\/assets\/og\/default\.png$/m);
    expect(yaml).toMatch(/^\s+defaultOgImageAlt: \S/m);
  });
});

describe('readSlogan', () => {
  it('слоган из site.yaml — строка записи site', () => {
    expect(readSlogan(readFileSync(SITE, 'utf8'))).toBe('Знает, где что лежит.');
  });

  it('кавычки снимаются; нет строки slogan → ошибка', () => {
    expect(readSlogan('site:\n  slogan: "Слоган: с двоеточием."\n')).toBe('Слоган: с двоеточием.');
    expect(() => readSlogan('site:\n  name: Belka SCM\n')).toThrow(/нет строки slogan/);
  });
});
