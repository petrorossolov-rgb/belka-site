// Гейт мокап-кита (ep03 T10): `.astro` в `src/components/mockup/` не содержат строк интерфейса —
// все строки приходят из данных (`src/content/mockups/*.yaml`, цикл текстов, Constitution 5);
// внутри кита только `div`/`span`; внутренность фигуры скрыта от AT и не фокусируется; стили
// не прячут и не прокручивают данные, анимация — только конечная и под
// `prefers-reduced-motion: no-preference`.
//
// Разбор — компилятором Astro (`@astrojs/compiler-rs`, зависимость самого `astro`): он отдаёт
// ESTree + JSX, и литерал внутри выражения (`{items.map(() => <span>OK</span>)}`) виден как
// `JSXText`. Вырезание `{…}` перед `parse5` такой текст теряло бы. Обновление Astro, сменившее
// форму AST, уронит этот тест, а не пропустит нарушение: проба ниже проверяет каждое правило.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@astrojs/compiler-rs';
import { afterEach, describe, expect, it } from 'vitest';

const KIT = fileURLToPath(new URL('../src/components/mockup/', import.meta.url));
const FIGURE = 'Mockup.astro';

/** Теги HTML внутри кита; `figure`/`figcaption` — только в `Mockup.astro`. */
const KIT_TAGS = new Set(['div', 'span', 'slot', 'style']);
const FIGURE_TAGS = new Set(['figure', 'figcaption']);
/**
 * Атрибуты, значение которых читает человек или скринридер, и директивы Astro, которые выводят
 * строку как содержимое элемента (`set:html`, `set:text`).
 */
const TEXT_ATTRS = new Set(['aria-label', 'aria-description', 'title', 'alt', 'placeholder', 'set:html', 'set:text']);
/** Компонент вида в `Mockup.astro`: он обязан стоять внутри скрытой от AT и неактивной обёртки. */
const KIND_TAG = 'Kind';
const LETTER = /\p{L}/u;

type Node = { type: string; [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';

/** Все узлы поддерева по порядку (объекты и массивы полей). */
function* nodes(value: unknown): Generator<Node> {
  if (Array.isArray(value)) {
    for (const item of value) yield* nodes(item);
  } else if (isNode(value)) {
    yield value;
    for (const [key, child] of Object.entries(value)) if (key !== 'type') yield* nodes(child);
  }
}

const attrName = (attr: Node) => String((attr.name as Node).name);
const tagName = (element: Node) => {
  const name = (element.openingElement as Node).name as Node;
  return name.type === 'JSXIdentifier' ? String(name.name) : '';
};

/**
 * Строки, которые выражение выводит на страницу: строковые литералы и части шаблонных строк с
 * буквами, а также константы frontmatter со строкой-литералом. Вложенные элементы проверяет общий
 * обход; сравнения и имена свойств не выводятся.
 */
function outputStrings(expression: unknown, constants: Map<string, string>): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isNode(value)) return;
    switch (value.type) {
      case 'JSXElement':
      case 'JSXFragment':
        return;
      case 'BinaryExpression':
        // Сравнение (`kind === 'x'`) строку не выводит; конкатенация (`'От' + 'бор'`) — выводит
        // (ep03 T21, Codex F01): её части проверяются как выводимые.
        if (value.operator === '+') {
          visit(value.left);
          visit(value.right);
        }
        return;
      case 'Literal':
        if (typeof value.value === 'string' && LETTER.test(value.value)) found.push(value.value);
        return;
      case 'TemplateElement': {
        const cooked = (value.value as { cooked?: string }).cooked ?? '';
        if (LETTER.test(cooked)) found.push(cooked);
        return;
      }
      case 'Identifier': {
        const constant = constants.get(String(value.name));
        if (constant !== undefined) found.push(constant);
        return;
      }
      case 'MemberExpression':
        visit(value.object);
        if (value.computed) visit(value.property);
        return;
      default:
        for (const [key, child] of Object.entries(value)) if (key !== 'type') visit(child);
    }
  };
  visit(expression);
  return found;
}

/**
 * Константы frontmatter, чьё значение — строка с буквами: `const title = 'Pick'` и значение по
 * умолчанию в деструктуризации `const { meta = 'Смена' } = Astro.props` (T21).
 */
function stringConstants(frontmatter: unknown): Map<string, string> {
  const constants = new Map<string, string>();
  for (const node of nodes(frontmatter)) {
    if (node.type === 'VariableDeclarator' && (node.id as Node).type === 'Identifier') {
      const strings = outputStrings(node.init, new Map());
      if (strings.length > 0) constants.set(String((node.id as Node).name), strings.join(' '));
    }
    if (node.type === 'AssignmentPattern' && (node.left as Node).type === 'Identifier') {
      const strings = outputStrings(node.right, new Map());
      if (strings.length > 0) constants.set(String((node.left as Node).name), strings.join(' '));
    }
  }
  return constants;
}

/** Блоки `@media (prefers-reduced-motion: no-preference) { … }` вырезаются с вложенными скобками. */
function withoutMotionQueries(css: string): string {
  const head = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/g;
  let out = css;
  for (let match = head.exec(out); match; match = head.exec(out)) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < out.length && depth > 0; i++) depth += out[i] === '{' ? 1 : out[i] === '}' ? -1 : 0;
    out = out.slice(0, match.index) + out.slice(i);
    head.lastIndex = match.index;
  }
  return out;
}

/** Нарушения стилей кита в тексте `<style>`. */
function styleViolations(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const errors: string[] = [];
  if (/text-overflow\s*:/.test(code)) errors.push('text-overflow — многоточие прячет данные');
  for (const match of code.matchAll(/overflow(?:-x|-y|-inline|-block)?\s*:\s*([^;}]+)/g)) {
    if (/\b(hidden|auto|scroll|clip)\b/.test(match[1]!)) errors.push(`overflow: ${match[1]!.trim()} — данные не прячутся и не прокручиваются`);
  }
  if (/\binfinite\b/.test(code)) errors.push('бесконечная анимация (infinite)');
  if (/@keyframes|animation(?:-name)?\s*:/.test(withoutMotionQueries(code))) {
    errors.push('анимация вне @media (prefers-reduced-motion: no-preference)');
  }
  return errors;
}

/** Нарушения одного `.astro` кита. */
function kitFileViolations(file: string, source: string): string[] {
  const { ast, diagnostics } = parse(source);
  const errors: string[] = (diagnostics as { text?: string; severity?: unknown }[])
    .filter((d) => String(d.severity).toLowerCase().includes('error'))
    .map((d) => `${file}: не разбирается — ${d.text ?? JSON.stringify(d)}`);
  const constants = stringConstants(ast.frontmatter);
  const allowedTags = file === FIGURE ? new Set([...KIT_TAGS, ...FIGURE_TAGS]) : KIT_TAGS;
  const push = (message: string) => errors.push(`${file}: ${message}`);
  let hidden = 0;
  const hiddenKinds = new Set<Node>();

  for (const node of nodes(ast.body)) {
    if (node.type === 'JSXText' && (node.value as string).trim() !== '') {
      if (!isStyleText(node, ast.body)) push(`литеральный текст «${(node.value as string).trim()}»`);
    }
    if (node.type === 'JSXFragment') {
      for (const child of node.children as Node[]) {
        if (child.type === 'JSXExpressionContainer') {
          for (const text of outputStrings(child.expression, constants)) push(`выражение выводит строку «${text}»`);
        }
      }
    }
    if (node.type === 'JSXElement') {
      const tag = tagName(node);
      if (/^[a-z]/.test(tag) && !allowedTags.has(tag)) push(`тег <${tag}> — внутри кита только div и span`);
      const attrs = ((node.openingElement as Node).attributes as Node[]).filter((a) => a.type === 'JSXAttribute');
      for (const attr of attrs) {
        const name = attrName(attr);
        const value = attr.value as Node | null;
        if (!TEXT_ATTRS.has(name) || value === null) continue;
        if (value.type === 'Literal') push(`${name}="${String(value.value)}" — строка из данных, не из шаблона`);
        else for (const text of outputStrings(value.expression, constants)) push(`${name} выводит строку «${text}»`);
      }
      const ariaHidden = attrs.find((a) => attrName(a) === 'aria-hidden');
      if (ariaHidden && (ariaHidden.value as Node | null)?.value === 'true') {
        hidden++;
        const inert = attrs.find((a) => attrName(a) === 'inert');
        // `inert` — только голым атрибутом: `inert={false}` или `inert={cond}` его снимают.
        if (!inert || inert.value !== null) push('aria-hidden="true" без inert — внутренность фокусируется');
        else for (const inner of nodes(node.children)) if (inner.type === 'JSXElement' && tagName(inner) === KIND_TAG) hiddenKinds.add(inner);
      }
      for (const child of node.children as Node[]) {
        if (child.type === 'JSXExpressionContainer') {
          for (const text of outputStrings(child.expression, constants)) push(`выражение выводит строку «${text}»`);
        }
      }
    }
  }
  for (const node of ast.body as Node[]) {
    if (node.type === 'JSXExpressionContainer') {
      for (const text of outputStrings(node.expression, constants)) push(`выражение выводит строку «${text}»`);
    }
  }
  if (file === FIGURE && hidden === 0) push('внутренность фигуры без aria-hidden="true" и inert');
  if (file === FIGURE) {
    const kinds = [...nodes(ast.body)].filter((n) => n.type === 'JSXElement' && tagName(n) === KIND_TAG);
    if (kinds.length === 0) push(`вид мокапа <${KIND_TAG}> не выводится`);
    if (kinds.some((k) => !hiddenKinds.has(k))) push(`<${KIND_TAG}> вне обёртки с aria-hidden="true" и inert`);
  }

  const css = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n');
  for (const message of styleViolations(css)) push(message);
  return errors;
}

/** Текст внутри `<style>` — CSS, а не строка интерфейса. */
function isStyleText(text: Node, body: unknown): boolean {
  for (const node of nodes(body)) {
    if (node.type === 'JSXElement' && tagName(node) === 'style' && (node.children as Node[]).includes(text)) return true;
  }
  return false;
}

function listAstro(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.astro'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

function checkKit(root: string): string[] {
  return listAstro(root).flatMap((file) => kitFileViolations(file, readFileSync(join(root, file), 'utf8')));
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Копия кита во временном каталоге с правкой одного файла. */
function kitWith(file: string, edit: (source: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mockup-kit-'));
  temps.push(dir);
  cpSync(KIT, dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, edit(readFileSync(path, 'utf8')));
  return dir;
}

/** Вставка разметки перед закрывающим `</div>` последнего корня шаблона примитива. */
const beforeLastDiv = (markup: string) => (source: string) => {
  const at = source.lastIndexOf('</div>');
  return source.slice(0, at) + markup + source.slice(at);
};

describe('мокап-кит: строки, теги, доступность, стили', () => {
  it('в src/components/mockup нарушений нет', () => {
    expect(listAstro(KIT)).toContain(FIGURE);
    expect(listAstro(KIT).length).toBeGreaterThanOrEqual(17);
    expect(checkKit(KIT)).toEqual([]);
  });

  describe('проба: литеральный текст в любом алфавите ловится, строка из пропса — нет', () => {
    it.each(['Отбор', 'Status', 'OK', 'WMS'])('«%s» в разметке примитива', (text) => {
      const dir = kitWith('ui/Panel.astro', beforeLastDiv(`<div>${text}</div>`));
      expect(checkKit(dir)).toEqual([`ui/Panel.astro: литеральный текст «${text}»`]);
    });

    it('текст внутри JSX в выражении (map) ловится', () => {
      const dir = kitWith('ui/Tiles.astro', (s) => s.replace('<div class="tiles__label">{item.label}</div>', '<div class="tiles__label">Зона</div>'));
      expect(checkKit(dir)).toEqual(['ui/Tiles.astro: литеральный текст «Зона»']);
    });

    it('aria-label="Scan" ловится, aria-label={label} — нет', () => {
      const literal = kitWith('ui/ScanField.astro', (s) => s.replace('<div class="scan__line">', '<div class="scan__line" aria-label="Scan">'));
      expect(checkKit(literal)).toEqual(['ui/ScanField.astro: aria-label="Scan" — строка из данных, не из шаблона']);
      const prop = kitWith('ui/ScanField.astro', (s) => s.replace('<div class="scan__line">', '<div class="scan__line" aria-label={label}>'));
      expect(checkKit(prop)).toEqual([]);
    });

    it('строка-литерал frontmatter, которая уходит в вывод, ловится', () => {
      const dir = kitWith('ui/AppBar.astro', (s) =>
        s.replace('const { title, meta } = Astro.props;', "const { meta } = Astro.props;\nconst title = 'Pick';"),
      );
      expect(checkKit(dir)).toEqual(['ui/AppBar.astro: выражение выводит строку «Pick»']);
    });

    it('конкатенация строк в выражении и в константе frontmatter ловится (T21, Codex F01)', () => {
      const inline = kitWith('ui/AppBar.astro', (s) => s.replace('{title}</div>', "{'От' + 'бор'}</div>"));
      expect(checkKit(inline)).toEqual(['ui/AppBar.astro: выражение выводит строку «От»', 'ui/AppBar.astro: выражение выводит строку «бор»']);
      const constant = kitWith('ui/AppBar.astro', (s) =>
        s.replace('const { title, meta } = Astro.props;', "const { meta } = Astro.props;\nconst title = 'От' + 'бор';"),
      );
      expect(checkKit(constant)).toEqual(['ui/AppBar.astro: выражение выводит строку «От бор»']);
    });

    it('сравнение со строкой в выражении не считается выводом', () => {
      const dir = kitWith('ui/AppBar.astro', (s) => s.replace('{title}</div>', "{title === 'x' ? meta : title}</div>"));
      expect(checkKit(dir)).toEqual([]);
    });

    it('строка-литерал прямо в выражении и в шаблонной строке ловится', () => {
      const dir = kitWith('ui/AppBar.astro', (s) => s.replace('{title}</div>', "{title ?? 'Отбор'}</div>"));
      expect(checkKit(dir)).toEqual(['ui/AppBar.astro: выражение выводит строку «Отбор»']);
      const template = kitWith('ui/AppBar.astro', (s) => s.replace('{title}</div>', '{`Шаг ${title}`}</div>'));
      expect(checkKit(template)).toEqual(['ui/AppBar.astro: выражение выводит строку «Шаг »']);
    });
  });

  describe('проба: теги кроме div и span ловятся', () => {
    it.each(['button', 'a', 'table'])('<%s>', (tag) => {
      const dir = kitWith('ui/Panel.astro', beforeLastDiv(`<${tag} class="x"></${tag}>`));
      expect(checkKit(dir)).toEqual([`ui/Panel.astro: тег <${tag}> — внутри кита только div и span`]);
    });

    it('figure вне Mockup.astro ловится', () => {
      const dir = kitWith('ui/Panel.astro', beforeLastDiv('<figure></figure>'));
      expect(checkKit(dir)).toEqual(['ui/Panel.astro: тег <figure> — внутри кита только div и span']);
    });
  });

  it('проба: внутренность фигуры без inert ловится', () => {
    const dir = kitWith(FIGURE, (s) => s.replace(' aria-hidden="true" inert>', ' aria-hidden="true">'));
    expect(checkKit(dir)).toEqual([
      'Mockup.astro: aria-hidden="true" без inert — внутренность фокусируется',
      'Mockup.astro: <Kind> вне обёртки с aria-hidden="true" и inert',
    ]);
    const none = kitWith(FIGURE, (s) => s.replace(' aria-hidden="true" inert>', '>'));
    expect(checkKit(none)).toEqual([
      'Mockup.astro: внутренность фигуры без aria-hidden="true" и inert',
      'Mockup.astro: <Kind> вне обёртки с aria-hidden="true" и inert',
    ]);
  });

  it('проба: inert={false} не считается inert, <Kind> вне скрытой обёртки ловится (T21)', () => {
    const off = kitWith(FIGURE, (s) => s.replace(' aria-hidden="true" inert>', ' aria-hidden="true" inert={false}>'));
    expect(checkKit(off)).toEqual([
      'Mockup.astro: aria-hidden="true" без inert — внутренность фокусируется',
      'Mockup.astro: <Kind> вне обёртки с aria-hidden="true" и inert',
    ]);
    const outside = kitWith(FIGURE, (s) =>
      s.replace('    <Kind mockup={data} />\n  </div>', '  </div>\n  <Kind mockup={data} />'),
    );
    expect(checkKit(outside)).toEqual(['Mockup.astro: <Kind> вне обёртки с aria-hidden="true" и inert']);
  });

  it('проба: значение по умолчанию в деструктуризации, set:html/set:text и выражение во фрагменте (T21)', () => {
    const fallback = kitWith('ui/AppBar.astro', (s) =>
      s.replace('const { title, meta } = Astro.props;', "const { title = 'Смена', meta } = Astro.props;"),
    );
    expect(checkKit(fallback)).toEqual(['ui/AppBar.astro: выражение выводит строку «Смена»']);
    const html = kitWith('ui/Panel.astro', beforeLastDiv('<div set:html="Отбор" />'));
    expect(checkKit(html)).toEqual(['ui/Panel.astro: set:html="Отбор" — строка из данных, не из шаблона']);
    const text = kitWith('ui/Panel.astro', beforeLastDiv("<div set:text={'Отбор'} />"));
    expect(checkKit(text)).toEqual(['ui/Panel.astro: set:text выводит строку «Отбор»']);
    const fragment = kitWith('ui/Panel.astro', beforeLastDiv("{title && <>{'Отбор'}</>}"));
    expect(checkKit(fragment)).toEqual(['ui/Panel.astro: выражение выводит строку «Отбор»']);
  });

  describe('проба: стили', () => {
    const withStyle = (css: string) => kitWith('ui/Panel.astro', (s) => s.replace('</style>', `${css}\n</style>`));

    it.each([
      ['.x { text-overflow: ellipsis; }', 'ui/Panel.astro: text-overflow — многоточие прячет данные'],
      ['.x { overflow: hidden; }', 'ui/Panel.astro: overflow: hidden — данные не прячутся и не прокручиваются'],
      ['.x { overflow-x: auto; }', 'ui/Panel.astro: overflow: auto — данные не прячутся и не прокручиваются'],
      ['.x { overflow: clip scroll; }', 'ui/Panel.astro: overflow: clip scroll — данные не прячутся и не прокручиваются'],
      ['.x { overflow-y: clip; }', 'ui/Panel.astro: overflow: clip — данные не прячутся и не прокручиваются'],
      ['@keyframes blink { to { opacity: 0; } }', 'ui/Panel.astro: анимация вне @media (prefers-reduced-motion: no-preference)'],
      ['.x { animation: blink 1s; }', 'ui/Panel.astro: анимация вне @media (prefers-reduced-motion: no-preference)'],
      [
        '@media (prefers-reduced-motion: no-preference) { .x { animation: blink 1s infinite; } }',
        'ui/Panel.astro: бесконечная анимация (infinite)',
      ],
    ])('%s', (css, message) => {
      expect(checkKit(withStyle(css))).toEqual([message]);
    });

    it('конечная анимация под prefers-reduced-motion: no-preference проходит', () => {
      const css =
        '@media (prefers-reduced-motion: no-preference) { @keyframes blink { to { opacity: 0; } } .x { animation: blink 1s 3; } }';
      expect(checkKit(withStyle(css))).toEqual([]);
    });
  });
});
