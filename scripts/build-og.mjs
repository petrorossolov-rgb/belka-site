// @ts-check
// OG-карточка 1200×630. Запускается вручную, результат коммитится, в CI скрипт не запускается
// (как build:favicons):
//
//   npm run build:og                     → src/assets/og/default.png: lockup и слоган из site.yaml
//   npm run build:og -- --product <id>   → src/assets/og/<id>.png: lockup и «name — descriptor»
//                                          из src/content/products/<id>.md (ep03)
//
// Chrome рисует scripts/og-template.html шрифтами и токенами сайта, sharp сжимает снимок в PNG с
// палитрой: карточка должна весить не больше 300 КБ (WhatsApp). Код 1 — карточка тяжелее
// предела; код 2 — неверный вызов, нет файла продукта или у него нет name либо descriptor
// (всё это проверяется до запуска Chrome).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OG_IMAGE_MAX_BYTES, pngSize } from './check-dist-seo.mjs';
import { startStaticServer } from './lib/static-server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = resolve(ROOT, 'src/content/site.yaml');
const PRODUCTS = resolve(ROOT, 'src/content/products');
export const OG_DIR = resolve(ROOT, 'src/assets/og');
export const OG_SIZE = { width: 1200, height: 630 };
/** Id продукта — как `ENTRY_ID` в `src/lib/content-core.ts`: путь к файлу из него не выходит. */
const PRODUCT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const USAGE = 'использование: npm run build:og [-- --product <id>]';

/** Неверный вызов или вход: CLI отдаёт код 2. */
export class UsageError extends Error {}

/** Значение строки YAML без кавычек по краям. */
const unquote = (/** @type {string} */ value) => value.replace(/^(["'])(.*)\1$/, '$2').trim();

/** Слоган из site.yaml: строка `slogan:` записи `site` (кавычки снимаются). */
export function readSlogan(/** @type {string} */ yaml) {
  const match = /^\s+slogan:\s*(.+?)\s*$/m.exec(yaml);
  const value = match?.[1] === undefined ? '' : unquote(match[1]);
  if (!value) throw new Error('site.yaml: нет строки slogan');
  return value;
}

/**
 * `name` и `descriptor` из frontmatter продукта: строки верхнего уровня `ключ: значение`
 * (кавычки снимаются, двоеточие внутри значения допустимо). YAML-разборщика в зависимостях нет,
 * поэтому — как `readSlogan`: только простые скалярные строки, без многострочных значений.
 * @param {string} markdown
 * @returns {{ name: string, descriptor: string }}
 */
export function readProduct(markdown) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
  if (frontmatter === undefined) throw new UsageError('нет frontmatter');
  const field = (/** @type {string} */ key) => {
    const match = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(frontmatter);
    const value = match?.[1] === undefined ? '' : unquote(match[1]);
    if (!value) throw new UsageError(`нет строки ${key}`);
    return value;
  };
  return { name: field('name'), descriptor: field('descriptor') };
}

/**
 * Аргументы CLI: без аргументов — карточка сайта, `--product <id>` — карточка продукта.
 * @param {string[]} argv
 * @returns {{ product: string | undefined }}
 */
export function parseArgs(argv) {
  if (argv.length === 0) return { product: undefined };
  const [flag, id, ...rest] = argv;
  if (flag !== '--product' || rest.length > 0) throw new UsageError(USAGE);
  if (id === undefined || !PRODUCT_ID.test(id)) throw new UsageError(`--product: нужен id продукта (${USAGE})`);
  return { product: id };
}

/**
 * Каждая картинка каталога OG — PNG 1200×630 не тяжелее предела (общее правило для карточки
 * сайта и продуктов; целостность контента держит то же правило для ссылок из записей).
 * @param {string} dir
 * @returns {string[]} нарушения
 */
export function checkOgDir(dir) {
  /** @type {string[]} */
  const errors = [];
  const files = readdirSync(dir).filter((file) => statSync(join(dir, file)).isFile());
  if (files.length === 0) errors.push(`${dir}: нет ни одной карточки`);
  for (const file of files) {
    const path = join(dir, file);
    if (!file.endsWith('.png')) {
      errors.push(`${file}: OG-карточка — только PNG`);
      continue;
    }
    const size = pngSize(readFileSync(path));
    if (size === undefined || size.width !== OG_SIZE.width || size.height !== OG_SIZE.height) {
      errors.push(`${file}: ${size ? `${size.width}×${size.height}` : 'не PNG'}, нужно ${OG_SIZE.width}×${OG_SIZE.height}`);
    }
    const bytes = statSync(path).size;
    if (bytes > OG_IMAGE_MAX_BYTES) errors.push(`${file}: ${bytes} байт, предел ${OG_IMAGE_MAX_BYTES}`);
  }
  return errors;
}

/**
 * Что рисовать и куда: слоган сайта или строка продукта. Всё, что может не сойтись во входе,
 * проверяется здесь — до запуска Chrome.
 * @param {string | undefined} product
 * @returns {{ selector: string, drop: string, text: string, out: string }}
 */
function planCard(product) {
  if (product === undefined) {
    return {
      selector: '[data-slogan]',
      drop: '[data-product]',
      text: readSlogan(readFileSync(SITE, 'utf8')),
      out: join(OG_DIR, 'default.png'),
    };
  }
  const file = join(PRODUCTS, `${product}.md`);
  if (!existsSync(file)) throw new UsageError(`нет файла продукта src/content/products/${product}.md`);
  let fields;
  try {
    fields = readProduct(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UsageError(`src/content/products/${product}.md: ${/** @type {Error} */ (error).message}`);
  }
  return {
    selector: '[data-product]',
    drop: '[data-slogan]',
    text: `${fields.name} — ${fields.descriptor}`,
    out: join(OG_DIR, `${product}.png`),
  };
}

/** @param {{ selector: string, drop: string, text: string, out: string }} card */
async function render(card) {
  // playwright-core и sharp грузятся только для настоящего прогона: проверки входа выше
  // работают без Chrome.
  const { chromium } = await import('playwright-core');
  const { default: sharp } = await import('sharp');
  const server = await startStaticServer(ROOT);
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: OG_SIZE, deviceScaleFactor: 1 });
    const response = await page.goto(`${server.origin}/scripts/og-template.html`, { waitUntil: 'load' });
    if (response?.status() !== 200) throw new Error(`шаблон: HTTP ${response?.status()}`);
    await page.evaluate(({ selector, drop, text }) => {
      const node = document.querySelector(selector);
      if (node === null) throw new Error(`в шаблоне нет ${selector}`);
      node.textContent = text;
      document.querySelector(drop)?.remove();
    }, card);
    await page.evaluate(() => document.fonts.ready);
    const broken = await page.evaluate(() =>
      [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src),
    );
    if (broken.length > 0) throw new Error(`картинки не загрузились: ${broken.join(', ')}`);
    const shot = await page.screenshot({ clip: { x: 0, y: 0, ...OG_SIZE } });
    const png = await sharp(shot).png({ palette: true, compressionLevel: 9, effort: 10 }).toBuffer();
    mkdirSync(dirname(card.out), { recursive: true });
    writeFileSync(card.out, png);
  } finally {
    await browser.close();
    await server.close();
  }
}

/** @param {string[]} argv */
async function main(argv) {
  let card;
  try {
    card = planCard(parseArgs(argv).product);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`build:og: ${error.message}`);
    return 2;
  }
  await render(card);
  const bytes = statSync(card.out).size;
  console.log(`build:og: ${card.out} — ${OG_SIZE.width}×${OG_SIZE.height}, ${bytes} байт, «${card.text}»`);
  if (bytes > OG_IMAGE_MAX_BYTES) {
    console.error(`build:og: больше предела ${OG_IMAGE_MAX_BYTES} байт`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
