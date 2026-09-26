// @ts-check
// Гейт адаптива (ep02 T03): ни одна страница сборки не шире окна на 360 / 768 / 1440 и ничего не
// уходит за его левый или правый край.
//
//   node scripts/check-layout.mjs --dist <dir> [--widths 360,768,1440]
//
// Страницы — все **/*.html сборки (и /404.html), открываются в системном Chrome (playwright-core,
// channel: 'chrome', браузер не скачивается) через встроенный сервер на 127.0.0.1. В браузере
// только сбор измерений, решение — чистая функция findOverflow. Меряются элементы, а не только
// scrollWidth документа: одно overflow-x: hidden на html, body или обёртке иначе прячет обрезку.
// Код 1 — нарушения, код 2 — неверный вызов или Chrome не найден.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { routeOf } from './check-dist-seo.mjs';
import { startStaticServer } from './lib/static-server.mjs';

/**
 * @typedef {object} Rect измерение элемента `body *` в CSS px
 * @property {string} selector короткий CSS-путь для вывода
 * @property {number} parent индекс родителя в rects, -1 — body
 * @property {number} left левая граница бокса (getBoundingClientRect)
 * @property {number} right правая граница бокса (getBoundingClientRect)
 * @property {number} width
 * @property {number} height
 * @property {boolean} hidden display: none, visibility: hidden (checkVisibility)
 * @property {number} scrollWidth 0 у строчных, display: contents и SVG — правило содержимого их не видит
 * @property {number} clientWidth
 * @property {string} overflowX вычисленный overflow-x
 * @property {boolean} clipped overflow hidden|clip, clip или clip-path — признак visually-hidden
 * @typedef {{ viewport: number, scrollWidth: number, rects: Rect[] }} Measure
 * @typedef {{ selector: string, reason: string }} Overflow
 */

export const DEFAULT_WIDTHS = [360, 768, 1440];
export const VIEWPORT_HEIGHT = 800;
/** Дробные доли пикселя от округления раскладки — не переполнение; 1 px — уже да. */
const EPSILON = 0.5;
/** Сколько нарушений печатать на страницу и ширину: остальное — число. */
const REPORT_LIMIT = 10;

const SCROLLERS = ['auto', 'scroll'];
const px = (/** @type {number} */ n) => `${Math.round(n * 100) / 100}px`;

/**
 * Переполнение на одной странице и ширине. Нарушение — любое из:
 * документ шире окна; левая или правая граница видимого элемента за окном (за левый край прокрутки
 * нет, контент просто теряется); содержимое видимого элемента шире его бокса (scrollWidth >
 * clientWidth: длинное слово, обрезка под overflow: hidden|clip).
 * Исключение — только потомки контейнера overflow-x: auto|scroll, который сам умещается в окно
 * (правила границ), и сам такой контейнер (правило содержимого). Невидимые элементы —
 * display: none, visibility: hidden, нулевой размер, visually-hidden (≤ 1×1 с обрезкой) и его
 * потомки — не проверяются.
 * @param {Measure} measure
 * @returns {Overflow[]}
 */
export function findOverflow({ viewport, scrollWidth, rects }) {
  /** @type {Overflow[]} */
  const found = [];
  if (scrollWidth > viewport + EPSILON) {
    found.push({ selector: 'html', reason: `страница шире окна: scrollWidth ${px(scrollWidth)} > ${px(viewport)}` });
  }
  const srOnly = (/** @type {Rect} */ r) => r.width <= 1 && r.height <= 1 && r.clipped;
  /** @type {boolean[]} */
  const inSrOnly = [];
  /** @type {number[]} ближайший предок-контейнер прокрутки, -1 — нет */
  const scroller = [];
  rects.forEach((r, i) => {
    const p = r.parent;
    inSrOnly[i] = srOnly(r) || (p >= 0 && (inSrOnly[p] ?? false));
    const parentRect = p >= 0 ? rects[p] : undefined;
    scroller[i] = parentRect === undefined ? -1 : SCROLLERS.includes(parentRect.overflowX) ? p : (scroller[p] ?? -1);
  });
  rects.forEach((r, i) => {
    if (r.hidden || inSrOnly[i] || r.width <= 0 || r.height <= 0) return;
    const s = scroller[i] ?? -1;
    const scrollerRect = s >= 0 ? rects[s] : undefined;
    const insideFittingScroller = scrollerRect !== undefined
      && scrollerRect.left >= -EPSILON && scrollerRect.right <= viewport + EPSILON;
    if (r.right > viewport + EPSILON && !insideFittingScroller) {
      found.push({ selector: r.selector, reason: `правая граница ${px(r.right)} за окном ${px(viewport)}` });
    }
    if (r.left < -EPSILON && !insideFittingScroller) {
      found.push({ selector: r.selector, reason: `левая граница ${px(r.left)} за левым краем окна` });
    }
    if (!SCROLLERS.includes(r.overflowX) && r.scrollWidth > r.clientWidth) {
      const how = r.overflowX === 'visible' ? 'вылезает' : `обрезано (overflow-x: ${r.overflowX})`;
      found.push({ selector: r.selector, reason: `содержимое шире бокса, ${how}: scrollWidth ${px(r.scrollWidth)} > clientWidth ${px(r.clientWidth)}` });
    }
  });
  return found;
}

/**
 * Сбор измерений в браузере (сериализуется в page.evaluate — без внешних ссылок).
 * @returns {Measure}
 */
function collect() {
  const els = [...document.body.querySelectorAll('*')];
  /** @type {Map<Element, number>} */
  const index = new Map(els.map((el, i) => [el, i]));
  const describe = (/** @type {Element} */ el) => {
    /** @type {string[]} */
    const parts = [];
    for (let e = /** @type {Element | null} */ (el); e && e !== document.body && parts.length < 4; e = e.parentElement) {
      let part = e.localName;
      if (e.id) {
        parts.unshift(`${part}#${e.id}`);
        break;
      }
      const classes = [...e.classList].slice(0, 2);
      if (classes.length > 0) part += `.${classes.join('.')}`;
      else if (e.parentElement) {
        const same = [...e.parentElement.children].filter((c) => c.localName === e?.localName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const rects = els.map((el) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const html = el instanceof HTMLElement;
    return {
      selector: describe(el),
      parent: el.parentElement ? (index.get(el.parentElement) ?? -1) : -1,
      left: box.left,
      right: box.right,
      width: box.width,
      height: box.height,
      hidden: !el.checkVisibility({ visibilityProperty: true }),
      scrollWidth: html ? el.scrollWidth : 0,
      clientWidth: html ? el.clientWidth : 0,
      overflowX: cs.overflowX,
      clipped: ['hidden', 'clip'].includes(cs.overflowX) || cs.getPropertyValue('clip') !== 'auto' || cs.clipPath !== 'none',
    };
  });
  return { viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, rects };
}

/** Chrome не найден или не запустился — код 2, а не «страниц нет». */
export class ChromeError extends Error {}

/** @param {string} dir @returns {string[]} HTML сборки относительно dir, через `/` */
function listHtml(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => relative(dir, join(d.parentPath, d.name)).split(sep).join('/'))
    .sort();
}

/**
 * Проверяет все HTML сборки на всех ширинах в одном запуске Chrome.
 * @param {{ distDir: string, widths?: number[], executablePath?: string }} options
 *   executablePath — только для теста «Chrome не найден»; по умолчанию channel: 'chrome'
 * @returns {Promise<{ errors: string[], pages: number }>}
 */
export async function checkLayout({ distDir, widths = DEFAULT_WIDTHS, executablePath }) {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) throw new Error(`нет каталога сборки ${distDir}`);
  if (widths.length === 0 || widths.some((w) => !Number.isInteger(w) || w < 1)) throw new Error(`ширины ${widths.join(',')}: нужны целые > 0`);
  const files = listHtml(distDir);
  if (files.length === 0) return { errors: ['в сборке нет ни одной HTML-страницы'], pages: 0 };

  let browser;
  try {
    browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
  } catch (error) {
    throw new ChromeError(`Chrome не запустился: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  const server = await startStaticServer(distDir);
  /** @type {string[]} */
  const errors = [];
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: VIEWPORT_HEIGHT } });
      for (const file of files) {
        const route = routeOf(file);
        const response = await page.goto(server.origin + route, { waitUntil: 'load' });
        if (response?.status() !== 200) {
          errors.push(`${route} @${width}: ответ ${response?.status() ?? 'нет'} вместо 200`);
          continue;
        }
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const found = findOverflow(await page.evaluate(collect));
        for (const o of found.slice(0, REPORT_LIMIT)) errors.push(`${route} @${width}: ${o.selector} — ${o.reason}`);
        if (found.length > REPORT_LIMIT) errors.push(`${route} @${width}: … и ещё ${found.length - REPORT_LIMIT}`);
      }
      await page.close();
    }
  } finally {
    await server.close();
    await browser.close();
  }
  return { errors, pages: files.length };
}

const USAGE = 'использование: node scripts/check-layout.mjs --dist <dir> [--widths 360,768,1440]';

/** @returns {{ distDir: string, widths: number[] } | undefined} */
export function parseArgs(/** @type {string[]} */ argv) {
  /** @type {Map<string, string>} */
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i] ?? '', argv[i + 1]];
    if (value === undefined || !['--dist', '--widths'].includes(flag) || flags.has(flag)) return undefined;
    flags.set(flag, value);
  }
  const distDir = flags.get('--dist');
  if (distDir === undefined) return undefined;
  const raw = flags.get('--widths');
  if (raw === undefined) return { distDir, widths: DEFAULT_WIDTHS };
  if (!/^\d+(,\d+)*$/.test(raw)) return undefined;
  const widths = raw.split(',').map(Number);
  return widths.every((w) => w >= 1) ? { distDir, widths } : undefined;
}

async function main(/** @type {string[]} */ argv) {
  const args = parseArgs(argv);
  if (args === undefined) {
    console.error(USAGE);
    return 2;
  }
  let result;
  try {
    result = await checkLayout({ distDir: resolve(args.distDir), widths: args.widths });
  } catch (error) {
    console.error(`check-layout: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const what = `${args.widths.join('/')} (страниц: ${result.pages})`;
  if (result.errors.length > 0) {
    console.error(`check-layout ${what}: нарушений — ${result.errors.length}`);
    for (const error of result.errors) console.error(`  - ${error}`);
    return 1;
  }
  console.log(`check-layout ${what}: OK`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
