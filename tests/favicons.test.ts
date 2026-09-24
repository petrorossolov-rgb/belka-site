import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

// Файлы собирает scripts/build-favicons.mjs (npm run build:favicons) и они коммитятся.
const PUBLIC = new URL('../public/', import.meta.url);
const PNG_SIGNATURE = '89504e470d0a1a0a';

describe('фавиконки', () => {
  it('apple-touch-icon.png — PNG 180×180', async () => {
    const meta = await sharp(readFileSync(new URL('apple-touch-icon.png', PUBLIC))).metadata();
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([180, 180]);
  });

  it('favicon.ico — ICO с PNG 32×32', async () => {
    const ico = readFileSync(new URL('favicon.ico', PUBLIC));
    expect(ico.length).toBeGreaterThan(22);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(1); // одно изображение
    expect([ico[6], ico[7]]).toEqual([32, 32]);

    const size = ico.readUInt32LE(14);
    const offset = ico.readUInt32LE(18);
    expect(offset + size).toBe(ico.length);
    const png = ico.subarray(offset, offset + size);
    expect(png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);

    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([32, 32]);
  });

  it('знак в favicon вписан с сохранением пропорций: боковые поля прозрачные', async () => {
    const ico = readFileSync(new URL('favicon.ico', PUBLIC));
    const png = ico.subarray(ico.readUInt32LE(18));
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]!;
    // Знак 450×537 уже квадрата: поля слева и справа прозрачные.
    expect(alpha(0, 16)).toBe(0);
    expect(alpha(31, 16)).toBe(0);
  });
});
