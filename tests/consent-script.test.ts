import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

// Форма скрипта согласия (ep05 T08): бюджет ≤ 2 КБ в gzip (Constitution 6), классический скрипт
// без import/export (его подключает <script src defer> без type="module"), без innerHTML, eval и
// on*-обработчиков в разметке. Поведение в браузере держит e2e check-consent (T09).
const SOURCE = readFileSync(fileURLToPath(new URL('../src/client/consent.mjs', import.meta.url)), 'utf8');
const GZIP_BUDGET = 2048;

const gzipSize = (text: string) => gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).length;

/** Нарушение бюджета — строка, иначе undefined. */
function budgetError(text: string): string | undefined {
  const size = gzipSize(text);
  return size > GZIP_BUDGET ? `consent.mjs: ${size} байт в gzip, бюджет ${GZIP_BUDGET}` : undefined;
}

/** Код без комментариев `//` и `/* … *\/` (в скрипте нет строк с `//`). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const FORBIDDEN: [string, RegExp][] = [
  ['innerHTML', /\b(inner|outer)HTML\b|insertAdjacentHTML|document\.write/],
  ['eval', /\beval\s*\(|new\s+Function\b|setTimeout\s*\(\s*['"`]/],
  ['on*-обработчик', /\bon[a-z]+\s*=|setAttribute\s*\(\s*['"]on/],
  ['javascript:', /javascript:/i],
];

function formErrors(text: string): string[] {
  const errors: string[] = [];
  try {
    new Script(text, { filename: 'consent.mjs' });
  } catch (error) {
    errors.push(`не классический скрипт: ${(error as Error).message}`);
  }
  for (const [name, re] of FORBIDDEN) if (re.test(code(text))) errors.push(`запрещено: ${name}`);
  return errors;
}

/** Строка из детерминированного шума с gzip-размером ровно `target` байт. */
function noiseWithGzip(target: number): string {
  let seed = 42;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let text = '';
  while (gzipSize(text) < target) text += alphabet[next() % alphabet.length];
  while (gzipSize(text) > target) text = text.slice(0, -1);
  return text;
}

describe('consent.mjs: бюджет и форма', () => {
  it(`gzip ≤ ${GZIP_BUDGET} байт`, () => {
    expect(budgetError(SOURCE)).toBeUndefined();
  });

  it('проба бюджета: 2048 байт в gzip проходит, 2049 — нет', () => {
    const edge = noiseWithGzip(GZIP_BUDGET);
    const over = noiseWithGzip(GZIP_BUDGET + 1);
    expect(gzipSize(edge)).toBe(GZIP_BUDGET);
    expect(gzipSize(over)).toBe(GZIP_BUDGET + 1);
    expect(budgetError(edge)).toBeUndefined();
    expect(budgetError(over)).toBe(`consent.mjs: ${GZIP_BUDGET + 1} байт в gzip, бюджет ${GZIP_BUDGET}`);
  });

  it('классический скрипт без import/export, innerHTML, eval, on* и javascript:', () => {
    expect(formErrors(SOURCE)).toEqual([]);
    expect(SOURCE).toMatch(/^\/\/ @ts-check/);
  });

  it('пробы формы: каждая запрещённая конструкция ловится', () => {
    const probes: [string, string][] = [
      ['export const x = 1;', 'не классический скрипт'],
      ["import x from './x.mjs';", 'не классический скрипт'],
      ['document.body.innerHTML = "";', 'запрещено: innerHTML'],
      ['eval("1");', 'запрещено: eval'],
      ['new Function("return 1");', 'запрещено: eval'],
      ['button.onclick = () => {};', 'запрещено: on*-обработчик'],
      ["a.setAttribute('onclick', 'x()');", 'запрещено: on*-обработчик'],
      ["a.href = 'javascript:void 0';", 'запрещено: javascript:'],
    ];
    for (const [line, message] of probes) {
      const errors = formErrors(`${SOURCE}\n${line}\n`);
      expect(errors.some((e) => e.startsWith(message)), line).toBe(true);
    }
  });
});
