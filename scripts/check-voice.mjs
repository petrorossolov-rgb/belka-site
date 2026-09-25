// @ts-check
// Линтер голоса Belka (ep02 T02): форма видимого текста — голос, типографика, нейминг, заглушки.
//
//   node scripts/check-voice.mjs --dist <dir> --env <production|staging>   # все **/*.html сборки
//   node scripts/check-voice.mjs --text <file.md> [...]                    # только ```text-блоки пакета
//
// Правила V1–V10 — контракт check-voice из плана ep02. Смысл и факты линтер не проверяет: это
// цикл ревью текстов (Codex и владелец), правило «не упоминать X» в публичном коде раскрыло бы X.
// Исключение — только атрибутом data-voice="raw" в разметке: снимает V3, V4, V10 в поддереве,
// остальные правила действуют и внутри. V9 — только production и --text.
// Код 1 — нарушения, код 2 — ошибка вызова.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { routeOf } from './check-dist-seo.mjs';

/**
 * @typedef {import('parse5').DefaultTreeAdapterTypes.ParentNode} ParentNode
 * @typedef {import('parse5').DefaultTreeAdapterTypes.Element} Element
 * @typedef {{ rule: string, index: number, length: number, message: string }} Hit
 * @typedef {{ id: string, rawExempt: boolean, productionOnly: boolean, find: (text: string) => Hit[] }} Rule
 * @typedef {{ env?: string, raw?: boolean[] }} TextContext
 * @typedef {{ text: string, raw: boolean[], where: string }} Segment
 */

const ENVS = ['production', 'staging'];

/** Пробелы в тексте: обычный, неразрывный, тонкий, узкий неразрывный. */
const SPACES = ' \u00A0\u2009\u202F';

/** Стоп-фразы (ДС «Нельзя» + решение владельца 2026-09-25); `\s+` — любой пробел между словами. */
export const STOP_PHRASES = [
  'в\\s+один\\s+клик',
  'легко\\s+и\\s+просто',
  'кликни\\p{L}*',
  'лапк\\p{L}*',
  'уникальн\\p{L}*',
  'революцион\\p{L}*',
  'лучш\\p{L}*\\s+на\\s+рынке',
  'инновацион\\p{L}*',
  'под\\s+ключ',
  '№\\s*1',
  'лидер\\p{L}*\\s+рынка',
];

/** Все совпадения глобальной регулярки как нарушения одного правила. */
function hits(/** @type {string} */ rule, /** @type {RegExp} */ re, /** @type {string} */ text, /** @type {string} */ message) {
  return [...text.matchAll(re)].map((m) => ({ rule, index: m.index, length: m[0].length, message }));
}

/** V2: «ёлочки» первого уровня, „лапки“ — только внутри «ёлочек». */
function quoteHits(/** @type {string} */ text) {
  /** @type {Hit[]} */
  const found = [];
  const add = (/** @type {number} */ index, /** @type {string} */ message) => found.push({ rule: 'V2', index, length: 1, message });
  let guillemets = 0;
  let lapki = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === '«') guillemets += 1;
    else if (ch === '»') guillemets = Math.max(0, guillemets - 1);
    else if (ch === '"' || ch === '”') add(i, `кавычка ${ch} — нужны «ёлочки»`);
    else if (ch === '„') {
      if (guillemets === 0) add(i, '„лапки“ только внутри «ёлочек»');
      lapki += 1;
    } else if (ch === '“') {
      if (lapki === 0) add(i, 'кавычка “ без открывающей „ — нужны «ёлочки»');
      else lapki -= 1;
    }
  }
  return found;
}

/** V5: начало предложения — начало блока, после «, „ или после . ? ! … с пробелом (и закрывающих » “ )). */
function sentenceStart(/** @type {string} */ text, /** @type {number} */ index) {
  let j = index;
  while (j > 0 && SPACES.includes(text.charAt(j - 1))) j -= 1;
  if (j === 0) return true;
  if ('«„'.includes(text.charAt(j - 1))) return true;
  while (j > 0 && '»“)'.includes(text.charAt(j - 1))) j -= 1;
  return j > 0 && '.?!…'.includes(text.charAt(j - 1));
}

const YOU = /(?<![\p{L}\p{N}])(?:Вы|Вас|Вам|Вами|Ваш|Ваша|Ваше|Ваши|Вашего|Вашей|Вашему|Вашем|Вашим|Вашими|Ваших|Вашу)(?![\p{L}\p{N}])/gu;
const STOP = new RegExp(`(?<![\\p{L}\\p{N}])(?:${STOP_PHRASES.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
// «Белка» в любом падеже + латинское имя или другая аббревиатура вместо «УЦП» (через пробел или дефис).
const BELKA = /(?<![\p{L}\p{N}])[Бб]елк(?:а|и|е|у|ой|ою)(?:\s+|\s*[-–]\s*)(?:[A-Za-z]|(?!УЦП(?![\p{L}\p{N}]))\p{Lu}{2,}(?![\p{L}\p{N}]))/gu;
const NOT_EMOJI = new Set(['©', '®', '™']);

/** @type {Rule[]} */
export const RULES = [
  {
    id: 'V1', rawExempt: false, productionOnly: false,
    find: (text) => hits('V1', /!/g, text, 'восклицательный знак'),
  },
  { id: 'V2', rawExempt: false, productionOnly: false, find: quoteHits },
  {
    id: 'V3', rawExempt: true, productionOnly: false,
    find: (text) => [
      ...hits('V3', /(?<=^|[ \u00A0\u2009\u202F])-(?=[ \u00A0\u2009\u202F])/g, text, 'дефис в роли тире — нужно «—» с пробелами'),
      ...hits('V3', /(?<=[ \u00A0\u2009\u202F])–|–(?=[ \u00A0\u2009\u202F])/g, text, '«–» с пробелом — в роли тире нужно «—», в диапазоне «–» без пробелов'),
      ...hits('V3', /(?<=[^ \u00A0\u2009\u202F])—/g, text, 'нет пробела перед «—»'),
      ...hits('V3', /—(?![ \u00A0\u2009\u202F])/g, text, 'нет пробела после «—»'),
    ],
  },
  {
    id: 'V4', rawExempt: true, productionOnly: false,
    find: (text) => [
      ...hits('V4', /(?<![\p{N}\p{L}.,])\d{1,3}(?:[ \u00A0]\d{3})+(?!\p{N})/gu, text, 'разряды обычным или неразрывным пробелом — нужен тонкий (U+2009 или U+202F)'),
      ...hits('V4', /(?<![\p{N}\p{L}.,])\d{5,}(?!\p{N})/gu, text, 'число от пяти цифр без разрядов — нужен тонкий пробел'),
    ],
  },
  {
    id: 'V5', rawExempt: false, productionOnly: false,
    find: (text) => hits('V5', YOU, text, '«вы» со строчной не в начале предложения')
      .filter((hit) => !sentenceStart(text, hit.index)),
  },
  {
    id: 'V6', rawExempt: false, productionOnly: false,
    find: (text) => [...text.matchAll(STOP)].map((m) => ({
      rule: 'V6', index: m.index, length: m[0].length, message: `стоп-фраза «${m[0]}»`,
    })),
  },
  {
    id: 'V7', rawExempt: false, productionOnly: false,
    find: (text) => hits('V7', BELKA, text, 'кириллическая «Белка» в составе имени — русская редакция только «Белка УЦП», марка и продукты латиницей'),
  },
  {
    id: 'V8', rawExempt: false, productionOnly: false,
    find: (text) => hits('V8', /\p{Extended_Pictographic}/gu, text, 'эмодзи')
      .filter((hit) => !NOT_EMOJI.has(text.charAt(hit.index))),
  },
  {
    id: 'V9', rawExempt: false, productionOnly: true,
    find: (text) => hits('V9', /(?<![\p{L}\p{N}])(?:заглушк\p{L}*|todo|fixme|lorem)(?![\p{L}\p{N}])/giu, text, 'незаконченный текст в production'),
  },
  {
    id: 'V10', rawExempt: true, productionOnly: false,
    find: (text) => hits('V10', /\.{3,}/g, text, 'многоточие из точек — нужен символ «…»'),
  },
];

/**
 * Проверяет один блок текста (абзац, пункт, значение атрибута).
 * @param {string} text
 * @param {TextContext} [ctx] env — окружение (по умолчанию production), raw — маска data-voice="raw" по символам
 * @returns {Hit[]}
 */
export function checkText(text, ctx = {}) {
  const env = ctx.env ?? 'production';
  const raw = ctx.raw;
  return RULES
    .filter((rule) => env === 'production' || !rule.productionOnly)
    .flatMap((rule) => rule.find(text).filter((hit) => !(rule.rawExempt && raw?.[hit.index])))
    .sort((a, b) => a.index - b.index || a.rule.localeCompare(b.rule));
}

/** Цитата ±20 символов; особые пробелы видны. */
export function quote(/** @type {string} */ text, /** @type {Hit} */ hit) {
  return text
    .slice(Math.max(0, hit.index - 20), hit.index + hit.length + 20)
    .replace(/\u00A0/g, '{nbsp}')
    .replace(/\u2009/g, '{thin}')
    .replace(/\u202F/g, '{nnbsp}');
}

// Строчные элементы склеиваются с соседним текстом в один блок; всё остальное — граница блока.
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'data', 'dfn', 'em', 'i', 'img', 'kbd', 'label', 'mark',
  'picture', 'q', 's', 'samp', 'small', 'source', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);
// Невидимое или не-текст: содержимое не проверяется (`<code>` внутри строки — заменяется знаком-заполнителем).
const SKIP = new Set(['script', 'style', 'code', 'pre', 'template', 'noscript', 'textarea']);
const TEXT_ATTRS = ['alt', 'aria-label', 'title'];
// Служебные og-свойства: адреса, типы, размеры — не текст.
const OG_NOT_TEXT = new Set([
  'og:url', 'og:image', 'og:image:url', 'og:image:secure_url', 'og:image:type', 'og:image:width',
  'og:image:height', 'og:type', 'og:locale', 'og:locale:alternate',
]);
const PLACEHOLDER = '\uFFFC';

/** Схлопывает пробельные символы HTML (не неразрывные и не тонкие), маска raw — по символам результата. */
function normalize(/** @type {{ ch: string, raw: boolean }[]} */ chars) {
  let text = '';
  /** @type {boolean[]} */
  const raw = [];
  /** @type {boolean | undefined} */
  let space;
  for (const { ch, raw: r } of chars) {
    if (' \t\n\r\f'.includes(ch)) {
      space ??= r;
      continue;
    }
    if (space !== undefined && text.length > 0) {
      text += ' ';
      raw.push(space);
    }
    space = undefined;
    text += ch;
    raw.push(r);
  }
  return { text, raw };
}

/** Текст из значения атрибута как отдельный блок. */
function attrSegment(/** @type {string} */ value, /** @type {boolean} */ raw, /** @type {string} */ where) {
  const { text, raw: mask } = normalize(value.split('').map((ch) => ({ ch, raw })));
  return text ? [{ text, raw: mask, where }] : [];
}

function attributeSegments(/** @type {Element} */ el, /** @type {Map<string, string>} */ attrs, /** @type {boolean} */ raw) {
  /** @type {Segment[]} */
  const segments = [];
  for (const name of TEXT_ATTRS) {
    const value = attrs.get(name);
    if (value !== undefined) segments.push(...attrSegment(value, raw, `<${el.tagName} ${name}>`));
  }
  if (el.tagName === 'meta') {
    const name = attrs.get('name')?.toLowerCase();
    const property = attrs.get('property')?.toLowerCase();
    const content = attrs.get('content') ?? '';
    if (name === 'description') segments.push(...attrSegment(content, raw, '<meta description>'));
    if (property?.startsWith('og:') && !OG_NOT_TEXT.has(property)) {
      segments.push(...attrSegment(content, raw, `<meta ${property}>`));
    }
  }
  return segments;
}

/**
 * Видимый текст страницы по блокам: соседние строчные узлы склеены, атрибуты — отдельными блоками.
 * @param {string} html
 * @returns {Segment[]}
 */
export function collectSegments(html) {
  /** @type {Segment[]} */
  const segments = [];
  /** @type {{ ch: string, raw: boolean }[]} */
  let buffer = [];
  const flush = () => {
    const { text, raw } = normalize(buffer);
    if (text && text !== PLACEHOLDER) segments.push({ text, raw, where: '' });
    buffer = [];
  };
  const walk = (/** @type {ParentNode} */ node, /** @type {boolean} */ raw) => {
    for (const child of node.childNodes) {
      if (child.nodeName === '#text' && 'value' in child) {
        for (let i = 0; i < child.value.length; i += 1) buffer.push({ ch: child.value.charAt(i), raw });
        continue;
      }
      if (!('tagName' in child)) continue;
      const attrs = new Map(child.attrs.map((a) => [a.name, a.value]));
      const inline = INLINE.has(child.tagName);
      const elRaw = raw || attrs.get('data-voice') === 'raw';
      if (attrs.has('hidden') || SKIP.has(child.tagName)) {
        if (inline || child.tagName === 'code') buffer.push({ ch: PLACEHOLDER, raw: elRaw });
        else flush();
        continue;
      }
      segments.push(...attributeSegments(child, attrs, elRaw));
      if (child.tagName === 'br') {
        buffer.push({ ch: ' ', raw: elRaw });
        continue;
      }
      if (!inline) flush();
      walk(child, elRaw);
      if (!inline) flush();
    }
  };
  walk(parse(html), false);
  flush();
  return segments;
}

/**
 * Проверяет HTML-страницу.
 * @param {string} html
 * @param {{ env: string, route: string }} options
 * @returns {string[]} нарушения «маршрут: [где] правило сообщение — «цитата»»
 */
export function checkHtml(html, { env, route }) {
  return collectSegments(html).flatMap((segment) =>
    checkText(segment.text, { env, raw: segment.raw }).map(
      (hit) => `${route}: ${segment.where ? `${segment.where} ` : ''}${hit.rule} ${hit.message} — «${quote(segment.text, hit)}»`,
    ),
  );
}

/**
 * Проверяет все HTML каталога сборки.
 * @param {{ distDir: string, env: string }} options
 * @returns {{ errors: string[], pages: number }}
 */
export function checkDist({ distDir, env }) {
  if (!ENVS.includes(env)) throw new Error(`окружение «${env}»: допустимо ${ENVS.join(', ')}`);
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) throw new Error(`нет каталога сборки ${distDir}`);
  const files = readdirSync(distDir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => relative(distDir, join(d.parentPath, d.name)).split(sep).join('/'))
    .sort();
  if (files.length === 0) return { errors: ['в сборке нет ни одной HTML-страницы'], pages: 0 };
  const errors = files.flatMap((file) =>
    checkHtml(readFileSync(join(distDir, file), 'utf8'), { env, route: routeOf(file) }),
  );
  return { errors, pages: files.length };
}

/**
 * Проверяет пакет текстов: только блоки ```text, одна строка — один абзац или пункт. Правила — как
 * для production: черновик пишется для прода.
 * @param {string} source содержимое Markdown-файла
 * @param {string} file имя для вывода
 * @returns {string[]} нарушения «файл:строка: правило сообщение — «цитата»»
 */
export function checkTextFile(source, file) {
  /** @type {string[]} */
  const errors = [];
  const lines = source.split(/\r?\n/);
  /** @type {{ fence: string, line: number } | undefined} */
  let open;
  lines.forEach((line, i) => {
    if (open === undefined) {
      const m = /^(`{3,})text\s*$/.exec(line);
      if (m) open = { fence: m[1] ?? '```', line: i + 1 };
      return;
    }
    if (line.trimEnd() === open.fence) {
      open = undefined;
      return;
    }
    const text = line.trim();
    if (!text) return;
    for (const hit of checkText(text, { env: 'production' })) {
      errors.push(`${file}:${i + 1}: ${hit.rule} ${hit.message} — «${quote(text, hit)}»`);
    }
  });
  if (open !== undefined) errors.push(`${file}:${open.line}: блок \`\`\`text не закрыт`);
  return errors;
}

const USAGE = [
  'использование: node scripts/check-voice.mjs --dist <dir> --env <production|staging>',
  '               node scripts/check-voice.mjs --text <file.md> [...]',
].join('\n');

function main(/** @type {string[]} */ argv) {
  if (argv[0] === '--text') {
    const files = argv.slice(1);
    if (files.length === 0 || files.some((f) => f.startsWith('--'))) {
      console.error(USAGE);
      return 2;
    }
    const missing = files.filter((f) => !existsSync(f) || !statSync(f).isFile());
    if (missing.length > 0) {
      console.error(`check-voice: нет файла ${missing.join(', ')}`);
      return 2;
    }
    const errors = files.flatMap((f) => checkTextFile(readFileSync(f, 'utf8'), f));
    return report(errors, `--text (${files.length})`);
  }

  /** @type {Map<string, string>} */
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i] ?? '', argv[i + 1]];
    if (value === undefined || !['--dist', '--env'].includes(flag) || flags.has(flag)) {
      console.error(USAGE);
      return 2;
    }
    flags.set(flag, value);
  }
  const distDir = flags.get('--dist');
  const env = flags.get('--env');
  if (distDir === undefined || env === undefined) {
    console.error(USAGE);
    return 2;
  }
  let result;
  try {
    result = checkDist({ distDir: resolve(distDir), env });
  } catch (error) {
    console.error(`check-voice: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  return report(result.errors, `${env} (страниц: ${result.pages})`);
}

function report(/** @type {string[]} */ errors, /** @type {string} */ what) {
  if (errors.length > 0) {
    console.error(`check-voice ${what}: нарушений — ${errors.length}`);
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  console.log(`check-voice ${what}: OK`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
