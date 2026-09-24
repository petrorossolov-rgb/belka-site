// @ts-check
// Страницы для Lighthouse CI: локальные пути из sitemap прод-сборки плюс `/404.html`.
// Sitemap есть только в production, поэтому LHCI меряет прод-сборку (staging отдаёт noindex).
// Новая страница попадает в замер сама — через sitemap, ручного списка нет (Constitution 2).
//   node scripts/lhci-urls.mjs [dist]   — печатает пути по одному в строке
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_ORIGIN } from './check-dist-seo.mjs';

export const NOT_FOUND_PATH = '/404.html';

/** `<loc>` из XML sitemap. */
function locs(/** @type {string} */ xml) {
  return [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((m) => m[1] ?? '');
}

/** Путь URL на прод-домене; чужой хост или невалидный URL — ошибка. */
function localPath(/** @type {string} */ loc, /** @type {string} */ where) {
  let url;
  try {
    url = new URL(loc);
  } catch {
    throw new Error(`${where}: невалидный URL «${loc}»`);
  }
  if (url.origin !== PRODUCTION_ORIGIN) throw new Error(`${where}: ${loc} — не ${PRODUCTION_ORIGIN}`);
  return url.pathname;
}

/**
 * Пути страниц для LHCI: из всех `sitemap-*.xml` (индекс разворачивается) и `/404.html` в конце.
 * @param {string} distDir
 * @returns {string[]}
 */
export function lhciUrls(distDir) {
  if (!existsSync(distDir)) throw new Error(`нет каталога сборки ${distDir}`);
  const queue = readdirSync(distDir).filter((f) => /^sitemap-.*\.xml$/.test(f)).sort();
  if (queue.length === 0) throw new Error(`в ${distDir} нет sitemap-*.xml — LHCI меряет только прод-сборку`);

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Set<string>} */
  const paths = new Set();
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.shift());
    if (seen.has(file)) continue;
    seen.add(file);
    const xml = readFileSync(join(distDir, file), 'utf8');
    if (/<sitemapindex[\s>]/.test(xml)) {
      for (const loc of locs(xml)) {
        const child = localPath(loc, file).replace(/^\//, '');
        if (!existsSync(join(distDir, child))) throw new Error(`${file}: ссылается на отсутствующий ${child}`);
        queue.push(child);
      }
    } else {
      for (const loc of locs(xml)) paths.add(localPath(loc, file));
    }
  }
  if (paths.size === 0) throw new Error('sitemap пуст — LHCI нечего мерить');
  if (!existsSync(join(distDir, '404.html'))) throw new Error(`в ${distDir} нет 404.html`);
  paths.delete(NOT_FOUND_PATH);
  return [...paths, NOT_FOUND_PATH];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(lhciUrls(resolve(process.argv[2] ?? 'dist')).join('\n'));
  } catch (error) {
    console.error(`lhci-urls: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
