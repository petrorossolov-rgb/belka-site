// @ts-check
// Проверка собранного dist/ (T16): индексация по окружению и общие инварианты сборки.
//
//   node scripts/check-dist-seo.mjs <production|staging> [--dist dist] [--out draft-routes.json]
//
// production — есть sitemap без 404 и черновиков, robots разрешает индексацию, нет noindex,
//              data-draft и черновых блоков (data-draft-block).
// staging    — нет sitemap, robots `Disallow: /`, noindex на каждой HTML-странице.
// Оба        — ресурсы только со своего хоста (Constitution 4), preload шрифтов только у основной
//              гарнитуры (--font-sans), никаких <script>, кроме JSON-LD; og:image, если есть, —
//              PNG из этой сборки с размерами как в og:image:width|height, не больше 300 КБ,
//              с непустым og:image:alt.
// Пишет draft-routes.json — маршруты страниц с data-draft (для смоука T17, в dist/ не попадает).
// Код 1 — нарушения, код 2 — ошибка вызова.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_ORIGIN = 'https://belkascm.ru';
const ENVS = ['production', 'staging'];

/** Предел веса картинки превью: карточку с картинкой тяжелее 300 КБ WhatsApp не показывает. */
export const OG_IMAGE_MAX_BYTES = 300 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// rel ссылок, по которым браузер сам что-то загружает или к чему подключается.
const RESOURCE_RELS = new Set([
  'stylesheet', 'preload', 'modulepreload', 'prefetch', 'preconnect', 'dns-prefetch',
  'icon', 'apple-touch-icon', 'manifest', 'mask-icon',
]);

/**
 * @typedef {{ errors: string[], draftRoutes: string[] }} CheckResult
 * @typedef {{ name: string, attrs: Map<string, string> }} Tag
 */

/** @param {string} dir @returns {string[]} пути файлов относительно dir, через `/` */
function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)).split(sep).join('/'))
    .sort();
}

/** `index.html` → `/`, `products/wms/index.html` → `/products/wms/`, `404.html` → `/404.html`. */
export function routeOf(/** @type {string} */ file) {
  if (file === 'index.html') return '/';
  if (file.endsWith('/index.html')) return `/${file.slice(0, -'index.html'.length)}`;
  return `/${file}`;
}

/** Открывающие теги HTML с атрибутами (регулярки достаточно для вывода Astro). */
export function parseTags(/** @type {string} */ html, /** @type {string[]} */ names) {
  /** @type {Tag[]} */
  const tags = [];
  const tagRe = new RegExp(`<(${names.join('|')})\\b([^>]*)>`, 'gi');
  for (const [, name = '', rawAttrs = ''] of html.matchAll(tagRe)) {
    tags.push({ name: name.toLowerCase(), attrs: parseAttrs(rawAttrs) });
  }
  return tags;
}

/** Атрибуты открывающего тега: имена в нижнем регистре, у атрибута без значения — пустая строка. */
function parseAttrs(/** @type {string} */ rawAttrs) {
  /** @type {Map<string, string>} */
  const attrs = new Map();
  for (const m of rawAttrs.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs.set((m[1] ?? '').toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Открывающие теги любых элементов с атрибутом `attr`. */
function tagsWithAttr(/** @type {string} */ html, /** @type {string} */ attr) {
  /** @type {Tag[]} */
  const tags = [];
  for (const [, name = '', rawAttrs = ''] of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const attrs = parseAttrs(rawAttrs);
    if (attrs.has(attr)) tags.push({ name: name.toLowerCase(), attrs });
  }
  return tags;
}

/** Ширина и высота PNG из заголовка IHDR (байты 16–23); не PNG — `undefined`. */
export function pngSize(/** @type {Buffer} */ bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Абсолютный адрес с хостом (`https://…`, `//…`) — внешний ресурс. */
function isExternal(/** @type {string} */ url) {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(url.trim());
}

/** URL из srcset: «a.webp 1x, b.webp 2x» → [a.webp, b.webp]. */
function srcsetUrls(/** @type {string} */ srcset) {
  return srcset.split(',').map((part) => part.trim().split(/\s+/)[0] ?? '').filter(Boolean);
}

/** Все `url(...)` в CSS. */
function cssUrls(/** @type {string} */ css) {
  return [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

function inlineStyles(/** @type {string} */ html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? '');
}

/** Первая гарнитура `--font-sans` и файлы её `@font-face` из встроенных стилей страницы. */
export function primaryFontFiles(/** @type {string} */ html) {
  const css = inlineStyles(html).join('\n');
  const decl = /--font-sans\s*:\s*([^;}]+)/.exec(css);
  if (!decl) return undefined;
  const family = (decl[1] ?? '').split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  const files = new Set();
  for (const [, body = ''] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const face = /font-family\s*:\s*([^;]+)/.exec(body)?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (face === family) cssUrls(body).forEach((url) => files.add(url));
  }
  return files;
}

/** `<loc>` из XML sitemap. */
function locs(/** @type {string} */ xml) {
  return [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((m) => m[1] ?? '');
}

/** Файл в dist по пути URL: `/` → `index.html`, `/x/` → `x/index.html`, `/404.html` → `404.html`. */
function distFileOf(/** @type {string} */ pathname) {
  const path = decodeURIComponent(pathname).replace(/^\//, '');
  return path === '' || path.endsWith('/') ? `${path}index.html` : path;
}

/**
 * Проверяет собранный dist.
 * @param {{ distDir: string, env: string }} options
 * @returns {CheckResult}
 */
export function checkDistSeo({ distDir, env }) {
  if (!ENVS.includes(env)) throw new Error(`окружение «${env}»: допустимо ${ENVS.join(', ')}`);
  if (!existsSync(distDir)) throw new Error(`нет каталога сборки ${distDir}`);

  /** @type {string[]} */
  const errors = [];
  const files = listFiles(distDir);
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  const read = (/** @type {string} */ file) => readFileSync(join(distDir, file), 'utf8');
  const production = env === 'production';

  if (htmlFiles.length === 0) errors.push('в сборке нет ни одной HTML-страницы');

  /** @type {string[]} */
  const draftRoutes = [];
  for (const file of htmlFiles) {
    const html = read(file);
    const htmlTag = parseTags(html, ['html'])[0];
    const draft = htmlTag?.attrs.has('data-draft') ?? false;
    if (draft) draftRoutes.push(routeOf(file));

    const noindex = parseTags(html, ['meta']).some(
      (t) => t.attrs.get('name')?.toLowerCase() === 'robots' && /noindex/i.test(t.attrs.get('content') ?? ''),
    );
    if (production && noindex) errors.push(`${file}: noindex в прод-сборке`);
    if (production && draft) errors.push(`${file}: черновая страница (data-draft) в прод-сборке`);
    if (production) {
      for (const tag of tagsWithAttr(html, 'data-draft-block')) {
        const id = tag.attrs.get('data-draft-block');
        const marker = `<${tag.name} data-draft-block${id ? `="${id}"` : ''}>`;
        errors.push(`${file}: черновой блок ${marker} в прод-сборке (маршрут ${routeOf(file)})`);
      }
    }
    if (!production && !noindex) errors.push(`${file}: нет <meta name="robots" content="noindex, nofollow">`);

    errors.push(...checkPageInvariants(file, html));
    errors.push(...checkOgImage(file, html, distDir));
  }

  for (const file of files.filter((f) => f.endsWith('.css'))) {
    for (const url of cssUrls(read(file))) {
      if (isExternal(url)) errors.push(`${file}: внешний ресурс ${url}`);
    }
  }

  errors.push(...checkRobots(files, read, production));
  if (production) {
    errors.push(...checkSitemap(files, read, htmlFiles));
  } else {
    for (const file of files.filter((f) => /^sitemap.*\.xml$/.test(f))) {
      errors.push(`${file}: sitemap вне прод-сборки`);
    }
  }

  return { errors, draftRoutes };
}

/** Инварианты любой страницы: свои ресурсы, preload только основной гарнитуры, без скриптов. */
function checkPageInvariants(/** @type {string} */ file, /** @type {string} */ html) {
  /** @type {string[]} */
  const errors = [];
  const external = (/** @type {string} */ what, /** @type {string} */ url) => {
    if (isExternal(url)) errors.push(`${file}: внешний ресурс ${what} ${url}`);
  };

  const fontFiles = primaryFontFiles(html);
  for (const tag of parseTags(html, ['link', 'script', 'img', 'source', 'video', 'audio', 'iframe'])) {
    const { name, attrs } = tag;
    if (name === 'link') {
      const rels = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
      const href = attrs.get('href') ?? '';
      if (rels.some((rel) => RESOURCE_RELS.has(rel))) external(`<link rel="${attrs.get('rel')}">`, href);
      if (rels.includes('preload') && attrs.get('as') === 'font') {
        if (fontFiles === undefined) {
          errors.push(`${file}: preload шрифта ${href}, но --font-sans не объявлена во встроенных стилях`);
        } else if (!fontFiles.has(href)) {
          errors.push(`${file}: preload шрифта ${href} — не файл основной гарнитуры (--font-sans)`);
        }
      }
    } else if (name === 'script') {
      if ((attrs.get('type') ?? '').toLowerCase() !== 'application/ld+json') {
        errors.push(`${file}: <script${attrs.has('src') ? ` src="${attrs.get('src')}"` : ''}> — клиентский JS запрещён`);
      }
    } else {
      for (const attr of ['src', 'poster']) {
        if (attrs.has(attr)) external(`<${name} ${attr}>`, attrs.get(attr) ?? '');
      }
      if (attrs.has('srcset')) srcsetUrls(attrs.get('srcset') ?? '').forEach((url) => external(`<${name} srcset>`, url));
    }
  }
  for (const css of inlineStyles(html)) {
    for (const url of cssUrls(css)) external('url() во встроенном стиле', url);
  }
  return errors;
}

/**
 * Картинка превью, если она есть: PNG из этой сборки (адрес — от прод-домена, как canonical),
 * размеры совпадают с og:image:width|height, вес не больше OG_IMAGE_MAX_BYTES, alt непустой.
 * Страница без og:image проходит: правило не требует картинку.
 */
function checkOgImage(/** @type {string} */ file, /** @type {string} */ html, /** @type {string} */ distDir) {
  /** @type {Map<string, string[]>} */
  const og = new Map();
  for (const { attrs } of parseTags(html, ['meta'])) {
    const property = attrs.get('property') ?? '';
    if (property.startsWith('og:image')) og.set(property, [...(og.get(property) ?? []), attrs.get('content') ?? '']);
  }
  const images = og.get('og:image') ?? [];
  if (images.length === 0) return [];

  /** @type {string[]} */
  const errors = [];
  const first = (/** @type {string} */ key) => og.get(key)?.[0];
  if (images.length > 1) errors.push(`${file}: og:image встречается ${images.length} раза — нужен один`);
  if (!first('og:image:alt')?.trim()) errors.push(`${file}: у og:image нет непустого og:image:alt`);
  const width = first('og:image:width');
  const height = first('og:image:height');
  if (width === undefined) errors.push(`${file}: у og:image нет og:image:width`);
  if (height === undefined) errors.push(`${file}: у og:image нет og:image:height`);

  const image = images[0] ?? '';
  const target = localFile(image, errors, `${file}: og:image`);
  if (target === undefined) return errors;
  const path = join(distDir, target);
  if (!existsSync(path) || !statSync(path).isFile()) {
    errors.push(`${file}: og:image ${image} — файла ${target} нет в сборке`);
    return errors;
  }
  const bytes = statSync(path).size;
  if (bytes > OG_IMAGE_MAX_BYTES) {
    errors.push(`${file}: og:image ${target} — ${bytes} байт, предел ${OG_IMAGE_MAX_BYTES}`);
  }
  const size = pngSize(readFileSync(path));
  if (size === undefined) {
    errors.push(`${file}: og:image ${target} — не PNG, размеры не проверить`);
  } else if (
    (width !== undefined && String(size.width) !== width.trim()) ||
    (height !== undefined && String(size.height) !== height.trim())
  ) {
    errors.push(`${file}: og:image ${target} — ${size.width}×${size.height}, в разметке ${width ?? '?'}×${height ?? '?'}`);
  }
  return errors;
}

function checkRobots(
  /** @type {string[]} */ files,
  /** @type {(file: string) => string} */ read,
  /** @type {boolean} */ production,
) {
  if (!files.includes('robots.txt')) return ['нет robots.txt'];
  const lines = read('robots.txt').split(/\r?\n/).map((l) => l.trim());
  const disallowAll = lines.includes('Disallow: /');
  /** @type {string[]} */
  const errors = [];
  if (!lines.includes('User-agent: *')) errors.push('robots.txt: нет «User-agent: *»');
  if (production) {
    if (disallowAll) errors.push('robots.txt: «Disallow: /» в прод-сборке');
    if (!lines.includes('Allow: /')) errors.push('robots.txt: нет «Allow: /»');
    const sitemap = `Sitemap: ${PRODUCTION_ORIGIN}/sitemap-index.xml`;
    if (!lines.includes(sitemap)) errors.push(`robots.txt: нет «${sitemap}»`);
  } else if (!disallowAll) {
    errors.push('robots.txt: нет «Disallow: /» вне прода');
  }
  return errors;
}

function checkSitemap(
  /** @type {string[]} */ files,
  /** @type {(file: string) => string} */ read,
  /** @type {string[]} */ htmlFiles,
) {
  if (!files.includes('sitemap-index.xml')) return ['нет sitemap-index.xml'];
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const pageUrls = [];
  for (const loc of locs(read('sitemap-index.xml'))) {
    const file = localFile(loc, errors, 'sitemap-index.xml');
    if (file === undefined) continue;
    if (!files.includes(file)) {
      errors.push(`sitemap-index.xml: ссылается на отсутствующий ${file}`);
      continue;
    }
    pageUrls.push(...locs(read(file)));
  }

  const pages = htmlFiles.filter((f) => !/^(404|500)\.html$/.test(f));
  if (pageUrls.length === 0 && pages.length > 0) errors.push('sitemap пуст, хотя в сборке есть страницы');

  for (const loc of pageUrls) {
    const file = localFile(loc, errors, 'sitemap');
    if (file === undefined) continue;
    if (/^\/(404|500)(\/|\.html)?$/.test(new URL(loc).pathname)) {
      errors.push(`sitemap: страница ошибки ${loc}`);
    } else if (!htmlFiles.includes(file)) {
      errors.push(`sitemap: ${loc} — такой страницы нет в сборке`);
    } else if (parseTags(read(file), ['html'])[0]?.attrs.has('data-draft')) {
      errors.push(`sitemap: черновая страница ${loc}`);
    }
  }
  return errors;
}

/** Путь файла в dist для URL прод-домена; чужой хост — нарушение. */
function localFile(/** @type {string} */ loc, /** @type {string[]} */ errors, /** @type {string} */ where) {
  let url;
  try {
    url = new URL(loc);
  } catch {
    errors.push(`${where}: невалидный URL «${loc}»`);
    return undefined;
  }
  if (url.origin !== PRODUCTION_ORIGIN) {
    errors.push(`${where}: ${loc} — не ${PRODUCTION_ORIGIN}`);
    return undefined;
  }
  return distFileOf(url.pathname);
}

function main(/** @type {string[]} */ argv) {
  const [env, ...rest] = argv;
  let distDir = 'dist';
  let out = 'draft-routes.json';
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (value === undefined || (flag !== '--dist' && flag !== '--out')) {
      console.error('использование: node scripts/check-dist-seo.mjs <production|staging> [--dist dist] [--out draft-routes.json]');
      return 2;
    }
    if (flag === '--dist') distDir = value;
    else out = value;
  }
  let result;
  try {
    result = checkDistSeo({ distDir: resolve(distDir), env: env ?? '' });
  } catch (error) {
    console.error(`check-dist-seo: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  writeFileSync(out, `${JSON.stringify(result.draftRoutes)}\n`);
  if (result.errors.length > 0) {
    console.error(`check-dist-seo ${env}: нарушений — ${result.errors.length}`);
    for (const error of result.errors) console.error(`  - ${error}`);
    return 1;
  }
  console.log(`check-dist-seo ${env}: OK; черновые маршруты: ${JSON.stringify(result.draftRoutes)} → ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
