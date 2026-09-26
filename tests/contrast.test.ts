import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DS_TOKEN_FILES, parseTokens, snapshotTokens, type TokenMap } from './fixtures/ds-sources';

// Контраст пар «текст/фон» темы по WCAG 2.x. Парсер намеренно простой:
// регэксп по `--name: value;`, без postcss (tasks.md → T03).

const STYLES = new URL('../src/styles/', import.meta.url);
const TOKEN_FILES = ['tokens/colors.css', 'tokens/typography.css', 'tokens/spacing.css', 'theme.css'];

function loadTheme(): TokenMap {
  const tokens: TokenMap = new Map();
  for (const file of TOKEN_FILES) parseTokens(readFileSync(new URL(file, STYLES), 'utf8'), tokens);
  return tokens;
}

/** Разворачивает цепочку var() до hex. Бросает ошибку на отсутствующем токене, цикле и не-hex значении. */
function resolveColor(tokens: TokenMap, name: string, chain: string[] = []): string {
  if (chain.includes(name)) {
    throw new Error(`Цикл var(): ${[...chain, name].join(' → ')}`);
  }
  const value = tokens.get(name);
  if (value === undefined) {
    const from = chain.length > 0 ? ` (из ${chain.join(' → ')})` : '';
    throw new Error(`Токен ${name} не объявлен${from}`);
  }
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (ref) return resolveColor(tokens, ref[1]!, [...chain, name]);
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;
  throw new Error(`Значение «${value}» токена ${name} не поддерживается: ожидается hex или var(--…)`);
}

function luminance(hex: string): number {
  let digits = hex.slice(1);
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(digits.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const theme = loadTheme();

describe('контраст темы (WCAG AA)', () => {
  const pairs: Array<[fg: string, bg: string, min: number]> = [
    ['--color-text', '--color-bg', 4.5],
    ['--color-text', '--color-surface', 4.5],
    ['--color-text-muted', '--color-bg', 4.5],
    ['--color-text-muted', '--color-surface', 4.5],
    ['--color-link', '--color-bg', 4.5],
    ['--color-link', '--color-surface', 4.5],
    ['--color-text', '--color-selection', 4.5],
    ['--color-text', '--color-draft-bg', 4.5],
    // Только крупный текст и плашки на рыжем (plan.md → Key Decisions).
    ['--color-on-accent', '--color-accent', 3.0],
    ['--color-accent', '--color-bg', 3.0],
    // Индикатор фокуса — нетекстовый контраст, WCAG 1.4.11.
    ['--color-focus', '--color-bg', 3.0],
    ['--color-focus', '--color-surface', 3.0],
  ];

  it.each(pairs)('%s на %s ≥ %d', (fg, bg, min) => {
    const ratio = contrast(resolveColor(theme, fg), resolveColor(theme, bg));
    expect(ratio, `${fg} на ${bg}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });

  it('акцент — рыжий бренда #C4552A', () => {
    expect(resolveColor(theme, '--color-accent').toUpperCase()).toBe('#C4552A');
  });

  it('bark-400 не используется ни одним токеном темы', () => {
    const themeCss = readFileSync(new URL('theme.css', STYLES), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(themeCss).not.toMatch(/--bk-bark-400/);
  });
});

describe('плашка героя: оба варианта маппинга', () => {
  const PLATE_VARIANTS = ['bark', 'rust'] as const;
  type PlateVariant = (typeof PLATE_VARIANTS)[number];
  const pair = (variant: PlateVariant, fg: 'on' | 'muted') =>
    contrast(resolveColor(theme, `--plate-${variant}-${fg}`), resolveColor(theme, `--plate-${variant}-bg`));

  // Оба варианта проверяются независимо от того, какой включён: переключение — правка маппинга.
  it.each(['on', 'muted'] as const)('кора: --plate-bark-%s на --plate-bark-bg ≥ 4.5 — любой текст', (fg) => {
    expect(pair('bark', fg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['on', 'muted'] as const)('рыжий: --plate-rust-%s на --plate-rust-bg ≥ 3.0 — крупный текст', (fg) => {
    expect(pair('rust', fg)).toBeGreaterThanOrEqual(3.0);
  });

  it('рыжий — рыжий бренда #C4552A, знак на нём молочный', () => {
    expect(resolveColor(theme, '--plate-rust-bg').toUpperCase()).toBe('#C4552A');
    expect(resolveColor(theme, '--plate-rust-on')).toBe(resolveColor(theme, '--bk-milk-50'));
  });

  /** Включённый вариант: все три токена `--color-plate-*` указывают на один вариант. */
  function activePlate(tokens: TokenMap): PlateVariant {
    const variants = ['bg', 'on', 'muted'].map((part) => {
      const name = part === 'on' ? '--color-on-plate' : `--color-plate-${part}`;
      return new RegExp(`^var\\(--plate-(\\w+)-${part}\\)$`).exec(tokens.get(name) ?? '')?.[1];
    });
    const [first] = variants;
    if (!PLATE_VARIANTS.includes(first as PlateVariant) || variants.some((v) => v !== first)) {
      throw new Error(`маппинг плашки смешивает варианты или ссылается мимо них: ${variants.join(', ')}`);
    }
    return first as PlateVariant;
  }

  it('маппинг --color-plate-* указывает на один вариант целиком', () => {
    expect(PLATE_VARIANTS).toContain(activePlate(theme));
    const mixed = parseTokens(
      ':root { --color-plate-bg: var(--plate-rust-bg); --color-on-plate: var(--plate-bark-on); --color-plate-muted: var(--plate-rust-muted); }',
    );
    expect(() => activePlate(mixed)).toThrow(/смешивает/);
  });

  // Крупный текст WCAG: от 24px или от 18.66px жирным. На 360px h2 — 26px, h3 — 20px.
  const LARGE_SIZES = ['--text-display', '--text-h1', '--text-h2'];
  const LARGE_IF_BOLD = ['--text-h3'];
  const BOLD = /font-weight\s*:\s*var\(--font-weight-(bold|heavy)\)/;

  /** Объявления `font-size` в `<style>` героя, которые дают мелкий текст на плашке. */
  function smallTextOnPlate(astro: string): string[] {
    const styles = [...astro.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n');
    const small: string[] = [];
    for (const [, selector, body] of styles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const [, value] of body!.matchAll(/font-size\s*:\s*([^;]+);?/g)) {
        const token = /^var\((--[\w-]+)\)$/.exec(value!.trim())?.[1] ?? '';
        const large = LARGE_SIZES.includes(token) || (LARGE_IF_BOLD.includes(token) && BOLD.test(body!));
        if (!large) small.push(`${selector!.trim()}: font-size ${value!.trim()}`);
      }
    }
    return small;
  }

  it('соглашение: при рыжей плашке в герое нет мелкого текста', () => {
    const hero = new URL('../src/components/home/Hero.astro', import.meta.url);
    // Героя до T11 нет — на странице нет и текста на плашке.
    if (activePlate(theme) !== 'rust' || !existsSync(hero)) return;
    expect(smallTextOnPlate(readFileSync(hero, 'utf8'))).toEqual([]);
  });

  it('проба соглашения: мелкие кегли находятся, крупные — нет', () => {
    const astro = `<p>x</p><style>
      .a { font-size: var(--text-small); }
      .b { font-size: var(--text-h2); }
      .c { font-size: var(--text-h3); font-weight: var(--font-weight-bold); }
      .d { font-size: var(--text-h3); }
      .e { color: var(--color-on-plate); font-size: 1rem; }
      /* .f { font-size: var(--text-eyebrow); } */
    </style>`;
    expect(smallTextOnPlate(astro)).toEqual([
      '.a: font-size var(--text-small)',
      '.d: font-size var(--text-h3)',
      '.e: font-size 1rem',
    ]);
  });
});

describe('резолвер токенов', () => {
  const tokens = (css: string) => parseTokens(`:root { ${css} }`);

  it('разворачивает цепочку var() и короткий hex', () => {
    const map = tokens('--a: var(--b); --b: var(--c); --c: #fff;');
    expect(resolveColor(map, '--a')).toBe('#fff');
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
  });

  it('ссылка на несуществующий примитив → ошибка с именем токена', () => {
    const map = tokens('--color-text: var(--bk-bark-999);');
    expect(() => resolveColor(map, '--color-text')).toThrow(/--bk-bark-999.*--color-text/);
  });

  it('цикл var() → ошибка, а не зависание', () => {
    const map = tokens('--a: var(--b); --b: var(--a);');
    expect(() => resolveColor(map, '--a')).toThrow(/Цикл var\(\): --a → --b → --a/);
  });

  it('значение не hex → явная ошибка «не поддерживается»', () => {
    const map = tokens('--a: color-mix(in srgb, #fff, #000);');
    expect(() => resolveColor(map, '--a')).toThrow(/не поддерживается/);
  });
});

// Источник — снимок ДС (tests/fixtures/ds-sources.json); снимок с самими исходниками сверяет ds-sources.test.ts.
describe('примитивы ДС скопированы без изменений', () => {
  it.each(DS_TOKEN_FILES)('%s', (file) => {
    const source = snapshotTokens(file);
    const copy = parseTokens(readFileSync(new URL(`tokens/${file}`, STYLES), 'utf8'));
    for (const [name, value] of copy) {
      expect(source.get(name), name).toBe(value);
    }
    // Всё, что в копии пропущено, — алиасы, стеки шрифтов (Fonts API) или правила элементов.
    const primitive = /^--(bk|fs|lh|tracking|space|radius|shadow|row|control|rail|topbar|drawer|rf|ease|dur)-?/;
    const missing = [...source.keys()].filter((name) => primitive.test(name) && !copy.has(name));
    expect(missing).toEqual([]);
  });
});
