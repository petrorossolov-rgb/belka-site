// Фавиконки из знака: npm run build:favicons → public/favicon.ico, public/apple-touch-icon.png.
// Запускается вручную при смене знака; результат коммитится. Знак не перекрашивается и не
// обрезается: вписывается целиком (fit: contain), пропорции 450×537 сохраняются.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const MARK = fileURLToPath(new URL('../src/assets/brand/mark-rust.png', import.meta.url));
const PUBLIC = new URL('../public/', import.meta.url);
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// apple-touch-icon — иконка приложения из ДС (guidelines/brand-icon.html): рыжий знак на белой
// плитке, знак занимает 36/64 высоты. iOS заливает прозрачный фон чёрным, поэтому плитка белая.
const TOUCH_SIZE = 180;
const TOUCH_MARK_HEIGHT = Math.round((TOUCH_SIZE * 36) / 64);
const TOUCH_BACKGROUND = '#FFFFFF'; // = --color-surface темы

/** Знак, вписанный в квадрат size×size с прозрачными полями. */
function markInSquare(size) {
  return sharp(MARK).resize(size, size, { fit: 'contain', background: TRANSPARENT }).png().toBuffer();
}

/** ICO-контейнер с PNG-полезной нагрузкой (поддерживается всеми браузерами с Vista+). */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width, 0 = 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // палитра не используется
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

await mkdir(PUBLIC, { recursive: true });

const favicon = encodeIco([{ size: 32, png: await markInSquare(32) }]);
await writeFile(new URL('favicon.ico', PUBLIC), favicon);

const touchMark = await sharp(MARK)
  .resize({ height: TOUCH_MARK_HEIGHT, fit: 'contain', background: TRANSPARENT })
  .png()
  .toBuffer();
const touch = await sharp({
  create: { width: TOUCH_SIZE, height: TOUCH_SIZE, channels: 4, background: TOUCH_BACKGROUND },
})
  .composite([{ input: touchMark, gravity: 'centre' }])
  .png()
  .toBuffer();
await writeFile(new URL('apple-touch-icon.png', PUBLIC), touch);

console.log(`favicon.ico: ${favicon.length} B; apple-touch-icon.png: ${touch.length} B`);
