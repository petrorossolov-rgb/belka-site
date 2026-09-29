// @ts-check
// Гейт согласия (ep05 T09): путь «флаг Метрики вкл.» в системном Chrome. Сборку пробы (оверлей
// site.yaml, staging) собирает задание metrika-probe в gates.yml.
//
//   node scripts/check-consent.mjs --dist <dir>
//
// Страницы открываются по имени belkascm.test (--host-resolver-rules Chrome; без имени доменную
// cookie на 127.0.0.1 не поставить), ответы сервера сборки получают CSP из
// infra/nginx/snippets/csp-metrika.conf — инлайн-скрипт или чужой домен блокируются, как в проде.
// mc.yandex.* и yastatic.net отвечают заглушкой tag.js: она пишет вызовы ym в window.__ymCalls,
// ставит _ym_uid (без домена и на .belkascm.test), _ym_d (на домен) и ключ localStorage _ym_uid.
// Любой другой внешний запрос — нарушение. Каждый сценарий — новый контекст браузера.
//
// Проверки (plan ep05 → Key Decision «Проба „флаг вкл.“»):
//   1. до решения нет запросов к Яндексу и cookie, плашка показана — на каждой HTML-странице;
//   2. «Отказаться» — ничего не загружено, решение переживает перезагрузку;
//   3. «Разрешить» — ровно один tag.js, init с webvisor: false и clickmap: false;
//   4. «Настройки cookie» показывают плашку, отзыв удаляет cookie _ym* (и доменные) и ключи _ym*;
//   5. обе кнопки достижимы с клавиатуры и имеют доступное имя, фокус при показе не переносится;
//   6. на 360 × 800 плашка не выше трети окна.
// Сценарии 2–6 идут на «/»: плашка и скрипт у всех страниц общие (Base.astro), главная есть в
// любой сборке. Нарушения CSP из консоли — нарушения гейта в любом сценарии.
//
// Граница охвата: гейт проверяет порядок согласия и вызов Метрики, а не поведение настоящего
// tag.js. Набор cookie, их домены и удаление при отзыве с настоящим счётчиком проверяются
// вручную на стейджинге по runbook включения Метрики (ревью ep05, F03).
// В браузере — только сбор измерений, решение — чистая функция evaluateConsent.
// Код 1 — нарушения, код 2 — неверный вызов, нет сборки или Chrome не найден.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { routeOf } from './check-dist-seo.mjs';
import { startStaticServer } from './lib/static-server.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{ route: string, status: number, yandex: string[], cookies: string[], bannerVisible: boolean }} PageMeasure
 * @typedef {object} Measure
 * @property {PageMeasure[]} pages проверка 1
 * @property {{ yandex: string[], cookies: string[], visibleAfterReload: boolean }} deny проверка 2
 * @property {{ tags: string[], init: unknown[] | undefined }} allow проверка 3
 * @property {{ cookiesBefore: string[], shownBySettings: boolean, cookiesAfter: string[], keysAfter: string[], tagsAfter: string[] }} revoke проверка 4
 * @property {{ activeOnLoad: string, activeAfterSettings: string, names: (string | undefined)[], reached: string[] }} keyboard проверка 5
 * @property {{ height: number, viewportHeight: number }} mobile проверка 6
 * @property {string[]} csp нарушения CSP из консоли (все сценарии)
 * @property {string[]} external запросы на чужие домены (все сценарии)
 */

export const HOST = 'belkascm.test';
/** Домены Метрики, которые отвечают заглушкой. */
export const YANDEX_HOST = /^mc\.yandex\.[a-z.]+$|^(?:[a-z0-9-]+\.)*yastatic\.net$/;
export const MOBILE = { width: 360, height: 800 };
const CSP_SNIPPET = fileURLToPath(new URL('../infra/nginx/snippets/csp-metrika.conf', import.meta.url));
/** Ожидание события, которого может не быть (перезагрузка, заглушка) — короткое. */
const SETTLE_TIMEOUT = 3000;
/** Навигация и действия — с запасом на медленный раннер. */
const NAVIGATION_TIMEOUT = 30_000;
const TAB_LIMIT = 300;

/** Заглушка tag.js: вызовы ym из очереди и новые — в window.__ymCalls, cookie и ключ как у Метрики. */
export const STUB_TAG = `(function () {
  var calls = window.__ymCalls = [];
  var queued = (window.ym && window.ym.a) || [];
  window.ym = function () { calls.push(Array.prototype.slice.call(arguments)); };
  for (var i = 0; i < queued.length; i++) window.ym.apply(null, queued[i]);
  var tail = '; path=/; max-age=3600';
  var domain = '; domain=.' + location.hostname;
  document.cookie = '_ym_uid=1' + tail;
  document.cookie = '_ym_uid=1' + tail + domain;
  document.cookie = '_ym_d=1' + tail + domain;
  try { localStorage.setItem('_ym_uid', '1'); } catch (e) {}
})();`;

export class ChromeError extends Error {}

/**
 * Системный Chrome (channel: 'chrome'); имя сайта ведёт на 127.0.0.1 — для доменных cookie.
 * @param {string} [executablePath] только для теста «Chrome не найден»
 * @returns {Promise<Browser>}
 */
export async function launchChrome(executablePath) {
  const args = [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`];
  try {
    return await chromium.launch(executablePath ? { executablePath, args } : { channel: 'chrome', args });
  } catch (error) {
    throw new ChromeError(`Chrome не запустился: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
}

/** CSP «Метрика» — значение заголовка из сниппета nginx. */
export function readCspMetrika(path = CSP_SNIPPET) {
  const match = /^add_header Content-Security-Policy "([^"]+)" always;$/m.exec(readFileSync(path, 'utf8'));
  if (!match?.[1]) throw new Error(`${path}: нет строки add_header Content-Security-Policy`);
  return match[1];
}

/**
 * Решение по измерениям — сообщения нарушений, каждое с номером своей проверки.
 * @param {Measure} m
 * @returns {string[]}
 */
export function evaluateConsent(m) {
  /** @type {string[]} */
  const errors = [];
  for (const p of m.pages) {
    if (p.status !== 200) {
      errors.push(`1 ${p.route}: ответ ${p.status} вместо 200`);
      continue;
    }
    if (p.yandex.length > 0) errors.push(`1 ${p.route}: до решения запросы к Яндексу — ${p.yandex.join(', ')}`);
    if (p.cookies.length > 0) errors.push(`1 ${p.route}: до решения cookie — ${p.cookies.join(', ')}`);
    if (!p.bannerVisible) errors.push(`1 ${p.route}: без решения плашка не показана`);
  }
  if (m.pages.length === 0) errors.push('1: в сборке нет ни одной HTML-страницы');

  if (m.deny.yandex.length > 0) errors.push(`2 отказ: загружено — ${m.deny.yandex.join(', ')}`);
  if (m.deny.cookies.length > 0) errors.push(`2 отказ: cookie — ${m.deny.cookies.join(', ')}`);
  if (m.deny.visibleAfterReload) errors.push('2 отказ не сохранился: после перезагрузки плашка снова показана');

  if (m.allow.tags.length !== 1) errors.push(`3 «Разрешить»: tag.js загружен ${m.allow.tags.length} раз, ожидался 1`);
  const options = /** @type {Record<string, unknown> | undefined} */ (m.allow.init?.[2]);
  if (m.allow.init === undefined) errors.push('3 «Разрешить»: ym(…, \'init\', …) не вызван');
  else {
    if (options?.['webvisor'] !== false) errors.push(`3 init: webvisor — ${JSON.stringify(options?.['webvisor'])}, нужен false`);
    if (options?.['clickmap'] !== false) errors.push(`3 init: clickmap — ${JSON.stringify(options?.['clickmap'])}, нужен false`);
  }

  if (!m.revoke.shownBySettings) errors.push('4 «Настройки cookie» не показывают плашку');
  if (m.revoke.cookiesBefore.length === 0) errors.push('4 отзыв не проверен: после «Разрешить» заглушка не поставила cookie');
  if (m.revoke.cookiesAfter.length > 0) errors.push(`4 отзыв оставил cookie — ${m.revoke.cookiesAfter.join(', ')}`);
  if (m.revoke.keysAfter.length > 0) errors.push(`4 отзыв оставил ключи localStorage — ${m.revoke.keysAfter.join(', ')}`);
  if (m.revoke.tagsAfter.length > 0) errors.push(`4 после отзыва снова загружен tag.js — ${m.revoke.tagsAfter.length}`);

  if (m.keyboard.activeOnLoad !== 'body') errors.push(`5 фокус перенесён при показе плашки: ${m.keyboard.activeOnLoad}`);
  if (m.keyboard.activeAfterSettings !== 'settings') {
    errors.push(`5 фокус перенесён при показе плашки из «Настроек»: ${m.keyboard.activeAfterSettings}`);
  }
  for (const [i, key] of ['allow', 'deny'].entries()) {
    const name = m.keyboard.names[i];
    if (name === undefined) errors.push(`5 кнопка ${key}: нет на плашке`);
    else if (name.trim() === '') errors.push(`5 кнопка ${key}: нет доступного имени`);
    if (!m.keyboard.reached.includes(key)) errors.push(`5 кнопка ${key}: недостижима с клавиатуры (Tab)`);
  }

  const limit = m.mobile.viewportHeight / 3;
  if (m.mobile.height > limit) {
    errors.push(`6 на ${MOBILE.width} × ${m.mobile.viewportHeight} плашка ${m.mobile.height.toFixed(1)} px — выше трети окна (${limit.toFixed(1)} px)`);
  }

  for (const text of m.csp) errors.push(`CSP: ${text}`);
  for (const url of m.external) errors.push(`запрос на чужой домен: ${url}`);
  return errors;
}

function listHtml(/** @type {string} */ dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => relative(dir, join(d.parentPath, d.name)).split(sep).join('/'))
    .sort();
}

/**
 * Прогоняет сценарии в Chrome и возвращает нарушения.
 * @param {{ distDir: string, csp?: string, executablePath?: string, browser?: Browser }} options
 *   только для тестов: csp — проба «CSP шире нужного»; executablePath — «Chrome не найден»;
 *   browser — уже запущенный launchChrome(): тест гоняет в нём все фикстуры, гейт его не закрывает
 * @returns {Promise<{ errors: string[], pages: number }>}
 */
export async function checkConsent({ distDir, csp = readCspMetrika(), executablePath, browser: shared }) {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) throw new Error(`нет каталога сборки ${distDir}`);
  const files = listHtml(distDir);
  const browser = shared ?? (await launchChrome(executablePath));
  const server = await startStaticServer(distDir);
  const port = new URL(server.origin).port;
  const base = `http://${HOST}:${port}`;
  /** @type {Measure['csp']} */
  const cspErrors = [];
  /** @type {Measure['external']} */
  const external = [];

  /** Новый контекст: перехват, CSP, журнал запросов к Яндексу. */
  const open = async (/** @type {{ width: number, height: number }} */ viewport = { width: 1280, height: 800 }) => {
    const context = await browser.newContext({ viewport });
    /** @type {string[]} */
    const yandex = [];
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      try {
        if (YANDEX_HOST.test(url.hostname)) {
          yandex.push(url.href);
          await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: STUB_TAG });
        } else if (url.hostname === HOST) {
          // route.fetch идёт из Node и не знает --host-resolver-rules Chrome.
          const response = await route.fetch({ url: url.href.replace(`//${HOST}:`, '//127.0.0.1:') });
          await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
        } else {
          external.push(url.href);
          await route.abort('blockedbyclient');
        }
      } catch {
        // Запрос оборвал переход на другую страницу или закрытие контекста — ответ уже не нужен.
        await route.abort().catch(() => undefined);
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(NAVIGATION_TIMEOUT);
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) cspErrors.push(message.text().split('\n')[0] ?? '');
    });
    return { context, page, yandex };
  };
  const go = async (/** @type {Page} */ page, /** @type {string} */ route) => {
    const response = await page.goto(base + route, { waitUntil: 'networkidle' });
    return response?.status() ?? 0;
  };
  const cookies = async (/** @type {BrowserContext} */ context) =>
    (await context.cookies()).map((c) => `${c.name}@${c.domain}`).sort();
  const bannerVisible = (/** @type {Page} */ page) =>
    page.evaluate(() => {
      const banner = document.querySelector('[data-consent]');
      return banner instanceof HTMLElement && !banner.hidden && banner.getClientRects().length > 0;
    });
  const click = async (/** @type {Page} */ page, /** @type {string} */ selector) => {
    const target = page.locator(selector).first();
    if ((await target.count()) === 0) return false;
    await target.click({ timeout: SETTLE_TIMEOUT }).catch(() => undefined);
    return true;
  };
  /** Клик, после которого страница может перезагрузиться: дождаться загрузки, если она началась. */
  const clickMaybeReload = async (/** @type {Page} */ page, /** @type {string} */ selector) => {
    const reloaded = page.waitForEvent('load', { timeout: SETTLE_TIMEOUT }).catch(() => undefined);
    await click(page, selector);
    await reloaded;
    await page.waitForLoadState('networkidle').catch(() => undefined);
  };
  const activeName = (/** @type {Page} */ page) =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'body';
      if (el.hasAttribute('data-consent-settings')) return 'settings';
      return el.closest('[data-consent]') ? `плашка (${el.tagName.toLowerCase()})` : el.tagName.toLowerCase();
    });

  // Сценарии независимы (у каждого свой контекст) и идут параллельно в одном Chrome.

  /** 1. Каждая страница до решения; один контекст — решений в нём никто не принимает. */
  const everyPage = async () => {
    /** @type {PageMeasure[]} */
    const pages = [];
    const { context, page, yandex } = await open();
    for (const file of files) {
      const route = routeOf(file);
      const status = await go(page, route);
      pages.push({ route, status, yandex: yandex.splice(0), cookies: await cookies(context), bannerVisible: await bannerVisible(page) });
    }
    await context.close();
    return pages;
  };

  /** 2. Отказ и перезагрузка. @returns {Promise<Measure['deny']>} */
  const denyScenario = async () => {
    const { context, page, yandex } = await open();
    await go(page, '/');
    // Окно проверки 2 — от клика: загрузки до решения — это проверка 1, не отказ.
    yandex.splice(0);
    // Первый отказ страницу не перезагружает — ждать загрузки незачем, перезагрузка следом.
    await click(page, '[data-consent-deny]');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.reload({ waitUntil: 'networkidle' });
    const result = { yandex, cookies: await cookies(context), visibleAfterReload: await bannerVisible(page) };
    await context.close();
    return result;
  };

  /**
   * 3–4. «Разрешить», затем «Настройки cookie» с клавиатуры и отказ (отзыв).
   * @returns {Promise<{ allow: Measure['allow'], revoke: Measure['revoke'], activeAfterSettings: string }>}
   */
  const allowScenario = async () => {
    const { context, page, yandex } = await open();
    await go(page, '/');
    await click(page, '[data-consent-allow]');
    await page.waitForFunction(() => '__ymCalls' in window, undefined, { timeout: SETTLE_TIMEOUT }).catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    /** @type {unknown[][]} */
    const calls = await page.evaluate(() => /** @type {any} */ (window).__ymCalls ?? []);
    const allow = { tags: yandex.filter((u) => /\/tag\.js(\?|$)/.test(u)), init: calls.find((c) => c[1] === 'init') };
    const cookiesBefore = await cookies(context);
    const seen = yandex.length;
    const settings = page.locator('[data-consent-settings]').first();
    let shownBySettings = false;
    let activeAfterSettings = 'нет кнопки «Настройки cookie»';
    if ((await settings.count()) > 0) {
      await settings.focus();
      await settings.press('Enter');
      shownBySettings = await bannerVisible(page);
      activeAfterSettings = await activeName(page);
    }
    await clickMaybeReload(page, '[data-consent-deny]');
    const keysAfter = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('_ym')));
    const revoke = {
      cookiesBefore,
      shownBySettings,
      cookiesAfter: (await cookies(context)).filter((c) => c.startsWith('_ym')),
      keysAfter,
      tagsAfter: yandex.slice(seen).filter((u) => /\/tag\.js(\?|$)/.test(u)),
    };
    await context.close();
    return { allow, revoke, activeAfterSettings };
  };

  /** 5. Клавиатура и доступные имена (фокус после «Настроек» — из сценария 3–4). */
  const keyboardScenario = async () => {
    const { context, page } = await open();
    await go(page, '/');
    const activeOnLoad = await activeName(page);
    // Доступное имя — из дерева доступности Chrome (CDP), как его услышит скринридер.
    const cdp = await context.newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    /** @type {(string | undefined)[]} */
    const names = [];
    for (const selector of ['[data-consent-allow]', '[data-consent-deny]']) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-consent] ${selector}` });
      if (!nodeId) {
        names.push(undefined);
        continue;
      }
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
      names.push(String(nodes[0]?.name?.value ?? ''));
    }
    /** @type {Set<string>} */
    const reached = new Set();
    for (let i = 0; i < TAB_LIMIT && reached.size < 2; i++) {
      await page.keyboard.press('Tab');
      const key = await page.evaluate(() => {
        const el = document.activeElement;
        if (el?.hasAttribute('data-consent-allow')) return 'allow';
        return el?.hasAttribute('data-consent-deny') ? 'deny' : '';
      });
      if (key) reached.add(key);
    }
    await context.close();
    return { activeOnLoad, names, reached: [...reached] };
  };

  /** 6. Узкий экран. @returns {Promise<Measure['mobile']>} */
  const mobileScenario = async () => {
    const { context, page } = await open(MOBILE);
    await go(page, '/');
    const height = await page.evaluate(() => document.querySelector('[data-consent]')?.getBoundingClientRect().height ?? 0);
    await context.close();
    return { height, viewportHeight: MOBILE.height };
  };

  try {
    const [pages, deny, { allow, revoke, activeAfterSettings }, keys, mobile] = await Promise.all([
      everyPage(),
      denyScenario(),
      allowScenario(),
      keyboardScenario(),
      mobileScenario(),
    ]);
    const keyboard = { ...keys, activeAfterSettings };
    const errors = evaluateConsent({ pages, deny, allow, revoke, keyboard, mobile, csp: [...new Set(cspErrors)], external: [...new Set(external)] });
    return { errors, pages: files.length };
  } finally {
    await server.close();
    if (!shared) await browser.close();
  }
}

const USAGE = 'использование: node scripts/check-consent.mjs --dist <dir>';

/** @returns {{ distDir: string } | undefined} */
export function parseArgs(/** @type {string[]} */ argv) {
  if (argv.length !== 2 || argv[0] !== '--dist' || !argv[1]) return undefined;
  return { distDir: argv[1] };
}

async function main(/** @type {string[]} */ argv) {
  const args = parseArgs(argv);
  if (args === undefined) {
    console.error(USAGE);
    return 2;
  }
  let result;
  try {
    result = await checkConsent({ distDir: resolve(args.distDir) });
  } catch (error) {
    console.error(`check-consent: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (result.errors.length > 0) {
    console.error(`check-consent (страниц: ${result.pages}): нарушений — ${result.errors.length}`);
    for (const error of result.errors) console.error(`  - ${error}`);
    return 1;
  }
  console.log(`check-consent (страниц: ${result.pages}): OK`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
