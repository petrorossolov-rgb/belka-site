import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { logoLayout, MARK_SOURCE, maxLogoHeight, WORDMARK_SOURCE } from '../src/lib/logo';
import { DS_LOGO_SHA256 } from './fixtures/ds-sources';

const BRAND = new URL('../src/assets/brand/', import.meta.url);

describe('logoLayout', () => {
  it('знак: ширина по пропорции 450×537', () => {
    expect(logoLayout('mark', 64)).toEqual({ height: 64, mark: { width: 54, height: 64 } });
  });

  it('lockup: словесный знак 30/64 высоты знака (brand-logo.html)', () => {
    const layout = logoLayout('lockup', 64);
    expect(layout.mark).toEqual({ width: 54, height: 64 });
    expect(layout.wordmark).toEqual({ width: 155, height: 30 });
  });

  it('size больше предела обрезается до половины исходника', () => {
    const mark = logoLayout('mark', 1000);
    expect(mark.height).toBe(maxLogoHeight('mark'));
    expect(mark.mark!.width).toBeLessThanOrEqual(MARK_SOURCE.width / 2);
    expect(mark.mark!.width).toBe(225);

    const wordmark = logoLayout('wordmark', 1000);
    expect(wordmark.wordmark!.height).toBeLessThanOrEqual(WORDMARK_SOURCE.height / 2);
    expect(wordmark.wordmark!.width).toBeLessThanOrEqual(WORDMARK_SOURCE.width / 2);
  });

  it('lockup ограничен словесным знаком: обе картинки не крупнее половины исходника', () => {
    const { mark, wordmark } = logoLayout('lockup', 1000);
    expect(mark!.height).toBeLessThanOrEqual(MARK_SOURCE.height / 2);
    expect(wordmark!.height).toBeLessThanOrEqual(WORDMARK_SOURCE.height / 2);
    expect(wordmark!.width).toBeLessThanOrEqual(WORDMARK_SOURCE.width / 2);
  });

  it('size ровно на пределе не меняется, нецелый округляется', () => {
    const max = maxLogoHeight('mark');
    expect(logoLayout('mark', max).height).toBe(max);
    expect(logoLayout('mark', 40.4).height).toBe(40);
  });

  it('недопустимый size → ошибка', () => {
    expect(() => logoLayout('mark', 0)).toThrow(/size/);
    expect(() => logoLayout('mark', Number.NaN)).toThrow(/size/);
  });
});

describe('растры знака', () => {
  const sha256 = (url: URL) => createHash('sha256').update(readFileSync(url)).digest('hex');
  const files = readdirSync(BRAND);

  it('скопированы из ДС байт-в-байт (SHA-256 по снимку ds-sources.json)', () => {
    for (const file of files) {
      expect(sha256(new URL(file, BRAND)), file).toBe(DS_LOGO_SHA256[file]);
    }
  });

  /** Ширина и высота PNG из заголовка IHDR. */
  const pngSize = (file: string) => {
    const bytes = readFileSync(new URL(file, BRAND));
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  };

  it('знак обоих тонов — одной геометрии MARK_SOURCE: logoLayout не зависит от тона', () => {
    expect(pngSize('mark-rust.png')).toEqual(MARK_SOURCE);
    expect(pngSize('mark-milk.png')).toEqual(MARK_SOURCE);
  });

  it('словесный знак всех тонов — геометрии WORDMARK_SOURCE', () => {
    for (const tone of ['bark', 'milk', 'rust']) {
      expect(pngSize(`wordmark-latin-${tone}.png`), tone).toEqual(WORDMARK_SOURCE);
    }
  });

  it('только знак и латинский словесный знак «Belka SCM»', () => {
    expect(files.sort()).toEqual([
      'mark-milk.png',
      'mark-rust.png',
      'wordmark-latin-bark.png',
      'wordmark-latin-milk.png',
      'wordmark-latin-rust.png',
    ]);
  });
});
