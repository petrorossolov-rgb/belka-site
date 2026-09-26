// @ts-check
// OG-карточка 1200×630: npm run build:og → src/assets/og/default.png. Запускается вручную при
// смене слогана, плашки или знака; результат коммитится, в CI скрипт не запускается (как
// build:favicons). Chrome рисует scripts/og-template.html шрифтами и токенами сайта, sharp
// сжимает снимок в PNG с палитрой: карточка должна весить не больше 300 КБ (WhatsApp).
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { OG_IMAGE_MAX_BYTES } from './check-dist-seo.mjs';
import { startStaticServer } from './lib/static-server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = resolve(ROOT, 'src/content/site.yaml');
const OUT = resolve(ROOT, 'src/assets/og/default.png');
export const OG_SIZE = { width: 1200, height: 630 };

/** Слоган из site.yaml: строка `slogan:` записи `site` (кавычки снимаются). */
export function readSlogan(/** @type {string} */ yaml) {
  const match = /^\s+slogan:\s*(.+?)\s*$/m.exec(yaml);
  const value = match?.[1]?.replace(/^(["'])(.*)\1$/, '$2').trim();
  if (!value) throw new Error('site.yaml: нет строки slogan');
  return value;
}

async function main() {
  const slogan = readSlogan(readFileSync(SITE, 'utf8'));
  const server = await startStaticServer(ROOT);
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: OG_SIZE, deviceScaleFactor: 1 });
    const response = await page.goto(`${server.origin}/scripts/og-template.html`, { waitUntil: 'load' });
    if (response?.status() !== 200) throw new Error(`шаблон: HTTP ${response?.status()}`);
    await page.evaluate((text) => {
      const node = document.querySelector('[data-slogan]');
      if (node === null) throw new Error('в шаблоне нет [data-slogan]');
      node.textContent = text;
    }, slogan);
    await page.evaluate(() => document.fonts.ready);
    const broken = await page.evaluate(() =>
      [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src),
    );
    if (broken.length > 0) throw new Error(`картинки не загрузились: ${broken.join(', ')}`);
    const shot = await page.screenshot({ clip: { x: 0, y: 0, ...OG_SIZE } });
    const png = await sharp(shot).png({ palette: true, compressionLevel: 9, effort: 10 }).toBuffer();
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, png);
  } finally {
    await browser.close();
    await server.close();
  }
  const bytes = statSync(OUT).size;
  console.log(`build:og: ${OUT} — ${OG_SIZE.width}×${OG_SIZE.height}, ${bytes} байт, слоган «${slogan}»`);
  if (bytes > OG_IMAGE_MAX_BYTES) {
    console.error(`build:og: больше предела ${OG_IMAGE_MAX_BYTES} байт`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
