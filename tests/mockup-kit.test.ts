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
//
// Вид со сценарием (ep04, `SCENARIO_KINDS`) — осознанное расширение с пробами; для остальных
// файлов кита правила прежние. Файл вида находится по соглашению `kinds/{PascalCase(kind)}.astro`,
// оно проверяется для каждого значения `MOCKUP_KIND_NAMES`. Три правила:
// (1) `infinite` — только в файле вида из `SCENARIO_KINDS` и только внутри
//     `@media (prefers-reduced-motion: no-preference)`; «любая анимация — только под
//     `no-preference`» действует для всех файлов, как раньше;
// (2) `input` (только `type="checkbox"`) и `label` — флажок паузы — только в `Mockup.astro`, вне
//     обёртки `aria-hidden`/`inert` и без них на себе, внутри условного выражения (`&&` или ветка
//     «то» тернарного) по переменной, чей инициализатор во frontmatter ссылается на
//     `SCENARIO_KINDS`; ровно один флажок и одна подпись, `for` подписи — то же значение, что `id`
//     флажка (T15); в остальных файлах кита эти теги ловит прежнее правило тегов;
// (3) в файле вида из `SCENARIO_KINDS` каждое правило CSS с `animation` или `animation-name`
//     содержит `animation-play-state: var(--mock-play, …)` после последнего
//     сокращённого `animation`: сокращение сбрасывает паузу в `running`.
import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@astrojs/compiler-rs';
import { afterEach, describe, expect, it } from 'vitest';
import { MOCKUP_KIND_NAMES, SCENARIO_KINDS } from '../src/lib/schemas';

const KIT = fileURLToPath(new URL('../src/components/mockup/', import.meta.url));
const FIGURE = 'Mockup.astro';

/** Файл вида по соглашению: `packflow` → `kinds/Packflow.astro`. */
const kindFile = (kind: string) =>
  `kinds/${kind
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}.astro`;
const KIND_FILES = new Map<string, string>(MOCKUP_KIND_NAMES.map((kind) => [kindFile(kind), kind]));
const SCENARIO_FILES = new Set<string>(SCENARIO_KINDS.map(kindFile));

/** Теги HTML внутри кита; `figure`/`figcaption` — только в `Mockup.astro`. */
const KIT_TAGS = new Set(['div', 'span', 'slot', 'style']);
const FIGURE_TAGS = new Set(['figure', 'figcaption']);
/** Флажок паузы вида со сценарием — только в `Mockup.astro`, правило 2. */
const PAUSE_TAGS = new Set(['input', 'label']);
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

type CssRule = { selector: string; declarations: [string, string][] };

/**
 * Правила CSS с собственными объявлениями. Правило с анимацией — по точному имени свойства
 * (`animation`, `animation-name`): `animation-timing-function` ключевого кадра его не делает.
 */
function cssRules(code: string): CssRule[] {
  const rules: CssRule[] = [];
  const stack: { selector: string; own: string }[] = [{ selector: '', own: '' }];
  let buffer = '';
  for (const char of code) {
    if (char === '{') {
      const cut = buffer.lastIndexOf(';') + 1;
      stack.at(-1)!.own += buffer.slice(0, cut);
      stack.push({ selector: buffer.slice(cut).trim().replace(/\s+/g, ' '), own: '' });
      buffer = '';
    } else if (char === '}') {
      const block = stack.pop()!;
      const declarations = (block.own + buffer)
        .split(';')
        .map((d) => d.split(':'))
        .filter((parts) => parts.length > 1)
        .map(([name, ...value]) => [name!.trim().toLowerCase(), value.join(':').trim()] as [string, string]);
      if (declarations.length > 0) rules.push({ selector: block.selector, declarations });
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return rules;
}

/** Правило 3: у правила с анимацией есть пауза из `--mock-play` после последнего `animation`. */
function pausable({ declarations }: CssRule): boolean {
  const names = declarations.map(([name]) => name);
  if (!names.some((name) => name === 'animation' || name === 'animation-name')) return true;
  const shorthand = names.lastIndexOf('animation');
  return declarations.some(
    ([name, value], i) => name === 'animation-play-state' && i > shorthand && /^var\(\s*--mock-play\s*[,)]/.test(value),
  );
}

/** Нарушения стилей кита в тексте `<style>` файла `file`. */
function styleViolations(css: string, file: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const errors: string[] = [];
  if (/text-overflow\s*:/.test(code)) errors.push('text-overflow — многоточие прячет данные');
  for (const match of code.matchAll(/overflow(?:-x|-y|-inline|-block)?\s*:\s*([^;}]+)/g)) {
    if (/\b(hidden|auto|scroll|clip)\b/.test(match[1]!)) errors.push(`overflow: ${match[1]!.trim()} — данные не прячутся и не прокручиваются`);
  }
  if (SCENARIO_FILES.has(file)) {
    if (/\binfinite\b/.test(withoutMotionQueries(code))) {
      errors.push('infinite вне @media (prefers-reduced-motion: no-preference) — цикл только при движении');
    }
    for (const rule of cssRules(code).filter((r) => !pausable(r))) {
      errors.push(`правило «${rule.selector}» с анимацией без animation-play-state: var(--mock-play, …) после animation — пауза не действует`);
    }
  } else if (/\binfinite\b/.test(code)) {
    const kind = KIND_FILES.get(file);
    errors.push(kind ? `бесконечная анимация (infinite) — вид «${kind}» не из SCENARIO_KINDS` : 'бесконечная анимация (infinite)');
  }
  if (/@keyframes|animation(?:-name)?\s*:/.test(withoutMotionQueries(code))) {
    errors.push('анимация вне @media (prefers-reduced-motion: no-preference)');
  }
  return errors;
}

/** Переменные frontmatter, чей инициализатор ссылается на `SCENARIO_KINDS`. */
function scenarioVariables(frontmatter: unknown): Set<string> {
  const names = new Set<string>();
  for (const node of nodes(frontmatter)) {
    if (node.type !== 'VariableDeclarator' || (node.id as Node).type !== 'Identifier') continue;
    if ([...nodes(node.init)].some((n) => n.type === 'Identifier' && n.name === 'SCENARIO_KINDS')) names.add(String((node.id as Node).name));
  }
  return names;
}

/** Все узлы поддерева с цепочкой предков. */
function* nodesWithAncestors(value: unknown, ancestors: Node[] = []): Generator<[Node, Node[]]> {
  if (Array.isArray(value)) {
    for (const item of value) yield* nodesWithAncestors(item, ancestors);
  } else if (isNode(value)) {
    yield [value, ancestors];
    const path = [...ancestors, value];
    for (const [key, child] of Object.entries(value)) if (key !== 'type') yield* nodesWithAncestors(child, path);
  }
}

const unwrap = (node: Node): Node => (node.type === 'ParenthesizedExpression' ? unwrap(node.expression as Node) : node);

/**
 * Правило 2: ближайшее выражение-контейнер над элементом — `x && …` или ветка «то» у `x ? … : …`,
 * где `x` — переменная из `SCENARIO_KINDS`.
 */
function underScenario(ancestors: Node[], variables: Set<string>): boolean {
  const container = ancestors.findLast((n) => n.type === 'JSXExpressionContainer');
  if (!container) return false;
  const expression = unwrap(container.expression as Node);
  const isScenario = (test: unknown) => isNode(test) && test.type === 'Identifier' && variables.has(String(test.name));
  if (expression.type === 'LogicalExpression' && expression.operator === '&&') {
    return isScenario(expression.left) && ancestors.includes(expression.right as Node);
  }
  if (expression.type === 'ConditionalExpression') {
    return isScenario(expression.test) && ancestors.includes(expression.consequent as Node);
  }
  return false;
}

/** Нарушения правила 2 в `Mockup.astro`: флажок паузы и его подпись. */
function pauseViolations(body: unknown, frontmatter: unknown): string[] {
  const variables = scenarioVariables(frontmatter);
  const errors: string[] = [];
  const found = new Map<string, Node[][]>([['input', []], ['label', []]]);
  const hiddenBy = (n: Node) =>
    n.type === 'JSXElement' &&
    ((n.openingElement as Node).attributes as Node[]).some((a) => a.type === 'JSXAttribute' && ['aria-hidden', 'inert'].includes(attrName(a)));
  for (const [node, ancestors] of nodesWithAncestors(body)) {
    if (node.type !== 'JSXElement' || !PAUSE_TAGS.has(tagName(node))) continue;
    const tag = tagName(node);
    const attrs = ((node.openingElement as Node).attributes as Node[]).filter((a) => a.type === 'JSXAttribute');
    found.get(tag)!.push(attrs);
    const type = attrs.find((a) => attrName(a) === 'type')?.value as Node | null | undefined;
    if (tag === 'input' && type?.value !== 'checkbox') errors.push('<input> — только type="checkbox"');
    if (ancestors.some(hiddenBy)) errors.push(`<${tag}> паузы внутри обёртки aria-hidden/inert — флажок не фокусируется`);
    if (hiddenBy(node)) errors.push(`<${tag}> паузы с aria-hidden/inert — флажок не фокусируется`);
    if (!underScenario(ancestors, variables)) errors.push(`<${tag}> паузы вне условия по SCENARIO_KINDS`);
  }
  // Флажок один и связан с подписью: `for` подписи — то же значение, что `id` флажка (литерал
  // или одна и та же переменная). Подпись не оборачивает флажок, поэтому связь — только так.
  const [inputs, labels] = [found.get('input')!, found.get('label')!];
  if (inputs.length + labels.length > 0) {
    if (inputs.length !== 1 || labels.length !== 1) {
      errors.push(`флажок паузы — ровно один <input> и один <label>, найдено: ${inputs.length} и ${labels.length}`);
    } else {
      const value = (attrs: Node[] | undefined, name: string) => {
        const v = attrs?.find((a) => attrName(a) === name)?.value as Node | null | undefined;
        if (!v) return undefined;
        if (v.type === 'Literal') return `"${String(v.value)}"`;
        const expression = v.type === 'JSXExpressionContainer' ? unwrap(v.expression as Node) : undefined;
        return expression?.type === 'Identifier' ? `{${String(expression.name)}}` : undefined;
      };
      const id = value(inputs[0], 'id');
      if (id === undefined || value(labels[0], 'for') !== id) {
        errors.push('<label for> паузы не совпадает с id флажка — подпись не связана с флажком');
      }
    }
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
      const pauseTag = file === FIGURE && PAUSE_TAGS.has(tag);
      if (/^[a-z]/.test(tag) && !allowedTags.has(tag) && !pauseTag) push(`тег <${tag}> — внутри кита только div и span`);
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
    for (const message of pauseViolations(ast.body, ast.frontmatter)) push(message);
  }

  const css = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n');
  for (const message of styleViolations(css, file)) push(message);
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
  const files = listAstro(root);
  const errors = files.flatMap((file) => kitFileViolations(file, readFileSync(join(root, file), 'utf8')));
  // Соглашение об имени файла вида: по нему гейт узнаёт вид со сценарием. Сравнение — по списку
  // файлов, а не `existsSync`: файловая система Windows регистр не различает.
  for (const [file, kind] of KIND_FILES) {
    if (!files.includes(file)) errors.push(`${file}: нет файла вида «${kind}» (соглашение kinds/{PascalCase(kind)}.astro)`);
  }
  return errors;
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

// Флажок паузы — та же разметка, что в `Mockup.astro` (ep04 T04): пробы правила 2 строят его
// из этих строк, и `Mockup.astro` обязан содержать `PAUSE_MARKUP` дословно (проба ниже).
const PAUSE_SCENARIO = 'const scenario = (SCENARIO_KINDS as readonly MockupKind[]).includes(data.kind);';
const PAUSE_FRONTMATTER = [
  "import { SCENARIO_KINDS, type MockupKind } from '../../lib/schemas';",
  PAUSE_SCENARIO,
  'const motionId = `mockup-motion-${Astro.props.mockup.id}`;',
].join('\n');
const PAUSE_ELEMENTS =
  '        <input type="checkbox" class="mockup__motion" id={motionId} />\n' +
  '        <label class="mockup__pause" for={motionId}>{site.mockupPauseLabel}</label>\n';
const PAUSE_MARKUP = `  {\n    scenario && (\n      <>\n${PAUSE_ELEMENTS}      </>\n    )\n  }\n`;
const SCREEN_OPEN = '  <div class="mockup__screen" aria-hidden="true" inert>';

/** `Mockup.astro` с флажком паузы: настоящий файл (с T04) как есть, до T04 — со вставкой. */
function withPause(source: string): string {
  if (source.includes(PAUSE_MARKUP)) return source;
  const end = source.indexOf('---', 3);
  return (source.slice(0, end) + PAUSE_FRONTMATTER + '\n' + source.slice(end)).replace(SCREEN_OPEN, PAUSE_MARKUP + SCREEN_OPEN);
}

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

// ep04: вид со сценарием (`SCENARIO_KINDS`) — цикл кадров, пауза флажком, соглашение об имени
// файла вида. Каждая отрицательная проба отличается от разрешённого случая одним условием и
// ждёт сообщение нового правила, а не прежнего запрета.
describe('ep04: вид со сценарием', () => {
  const SCENARIO_FILE = 'kinds/Packflow.astro';
  /** Разрешённый цикл: `infinite` и пауза из `--mock-play` под `no-preference`. */
  const LOOP =
    '@media (prefers-reduced-motion: no-preference) { @keyframes flow { to { opacity: 0; } } ' +
    '.packflow { animation: flow 15s step-end infinite; animation-play-state: var(--mock-play, running); } }';
  const withStyle = (file: string, css: string) =>
    kitWith(file, (s) => (s.includes('</style>') ? s.replace('</style>', `${css}\n</style>`) : `${s}\n<style>\n${css}\n</style>\n`));

  describe('правило 1: infinite — только у вида со сценарием и только под no-preference', () => {
    it('положительная пара: цикл с паузой в kinds/Packflow.astro проходит', () => {
      expect(checkKit(withStyle(SCENARIO_FILE, LOOP))).toEqual([]);
    });

    it('тот же цикл в kinds/Pack.astro — ошибка: вид не из SCENARIO_KINDS', () => {
      expect(checkKit(withStyle('kinds/Pack.astro', LOOP))).toEqual([
        'kinds/Pack.astro: бесконечная анимация (infinite) — вид «pack» не из SCENARIO_KINDS',
      ]);
    });

    it('infinite в kinds/Packflow.astro вне no-preference — ошибка', () => {
      expect(checkKit(withStyle(SCENARIO_FILE, '.x { animation-iteration-count: infinite; }'))).toEqual([
        'kinds/Packflow.astro: infinite вне @media (prefers-reduced-motion: no-preference) — цикл только при движении',
      ]);
    });

    it('граница: infinite в комментарии не считается', () => {
      expect(checkKit(withStyle(SCENARIO_FILE, '/* .x { animation-iteration-count: infinite; } */'))).toEqual([]);
    });

    it('граница: вложенный @container внутри no-preference', () => {
      const nested =
        '@media (prefers-reduced-motion: no-preference) { @container (width < 30rem) { ' +
        '.packflow { animation: flow 15s step-end infinite; animation-play-state: var(--mock-play, running); } } }';
      expect(checkKit(withStyle(SCENARIO_FILE, nested))).toEqual([]);
    });

    it('конечная анимация в обычном виде проходит, как раньше', () => {
      const finite = '@media (prefers-reduced-motion: no-preference) { @keyframes blink { to { opacity: 0; } } .pack { animation: blink 1s 3; } }';
      expect(checkKit(withStyle('kinds/Pack.astro', finite))).toEqual([]);
    });
  });

  describe('правило 3: у анимации вида со сценарием — пауза из --mock-play после animation', () => {
    const inMotion = (rule: string) => `@media (prefers-reduced-motion: no-preference) { @keyframes flow { to { opacity: 0; } } ${rule} }`;
    const message =
      'kinds/Packflow.astro: правило «.packflow» с анимацией без animation-play-state: var(--mock-play, …) после animation — пауза не действует';

    it('анимация без animation-play-state — ошибка', () => {
      expect(checkKit(withStyle(SCENARIO_FILE, inMotion('.packflow { animation: flow 15s step-end infinite; }')))).toEqual([message]);
    });

    it('порядок: animation-play-state перед сокращённым animation — ошибка (сокращение сбрасывает паузу)', () => {
      const before = '.packflow { animation-play-state: var(--mock-play, running); animation: flow 15s step-end infinite; }';
      expect(checkKit(withStyle(SCENARIO_FILE, inMotion(before)))).toEqual([message]);
    });

    it('animation-name без паузы и пауза не из --mock-play — ошибка', () => {
      expect(checkKit(withStyle(SCENARIO_FILE, inMotion('.packflow { animation-name: flow; }')))).toEqual([message]);
      const paused = '.packflow { animation: flow 15s step-end infinite; animation-play-state: paused; }';
      expect(checkKit(withStyle(SCENARIO_FILE, inMotion(paused)))).toEqual([message]);
    });

    it('граница: animation-timing-function в @keyframes не делает ключевой кадр правилом с анимацией', () => {
      const keyframes =
        '@media (prefers-reduced-motion: no-preference) { @keyframes flow { 0% { animation-timing-function: step-end; opacity: 1; } } }';
      expect(checkKit(withStyle(SCENARIO_FILE, keyframes))).toEqual([]);
    });
  });

  describe('правило 2: флажок паузы — только в Mockup.astro, вне inert и под условием по SCENARIO_KINDS', () => {
    const unconditional = [
      'Mockup.astro: <input> паузы вне условия по SCENARIO_KINDS',
      'Mockup.astro: <label> паузы вне условия по SCENARIO_KINDS',
    ];

    it('Mockup.astro выводит флажок той же разметкой, что строят пробы (T04)', () => {
      const source = readFileSync(join(KIT, FIGURE), 'utf8');
      expect(source).toContain(PAUSE_MARKUP);
      expect(source).toContain(PAUSE_SCENARIO);
    });

    it('положительная пара: флажок под условием и вне обёртки проходит', () => {
      expect(checkKit(kitWith(FIGURE, withPause))).toEqual([]);
    });

    it('флажок внутри обёртки aria-hidden/inert — ошибка', () => {
      const inside = kitWith(FIGURE, (s) =>
        withPause(s).replace(PAUSE_MARKUP, '').replace('    <Kind mockup={data} />', `${PAUSE_MARKUP}    <Kind mockup={data} />`),
      );
      expect(checkKit(inside)).toEqual([
        'Mockup.astro: <input> паузы внутри обёртки aria-hidden/inert — флажок не фокусируется',
        'Mockup.astro: <label> паузы внутри обёртки aria-hidden/inert — флажок не фокусируется',
      ]);
    });

    it('флажок без условия — ошибка', () => {
      const bare = kitWith(FIGURE, (s) => withPause(s).replace(PAUSE_MARKUP, PAUSE_ELEMENTS));
      expect(checkKit(bare)).toEqual(unconditional);
    });

    it('условие по переменной не из SCENARIO_KINDS — ошибка', () => {
      const other = kitWith(FIGURE, (s) => withPause(s).replace(PAUSE_SCENARIO, "const scenario = data.kind === 'packflow';"));
      expect(checkKit(other)).toEqual(unconditional);
    });

    it('ветка «иначе» тернарного выражения — ошибка', () => {
      const otherwise = kitWith(FIGURE, (s) => withPause(s).replace('scenario && (', 'scenario ? null : ('));
      expect(checkKit(otherwise)).toEqual(unconditional);
    });

    it('input не флажок — ошибка', () => {
      const text = kitWith(FIGURE, (s) => withPause(s).replace('<input type="checkbox"', '<input type="text"'));
      expect(checkKit(text)).toEqual(['Mockup.astro: <input> — только type="checkbox"']);
    });

    it('inert на самом флажке — ошибка (T15)', () => {
      const self = kitWith(FIGURE, (s) => withPause(s).replace('id={motionId} />', 'id={motionId} inert />'));
      expect(checkKit(self)).toEqual(['Mockup.astro: <input> паузы с aria-hidden/inert — флажок не фокусируется']);
    });

    it('второй флажок без id и for под тем же условием — ошибка (T15, Codex)', () => {
      const second = kitWith(FIGURE, (s) =>
        withPause(s).replace(PAUSE_ELEMENTS, `${PAUSE_ELEMENTS}        <input type="checkbox" />\n        <label>{site.mockupPauseLabel}</label>\n`),
      );
      expect(checkKit(second)).toEqual([
        'Mockup.astro: флажок паузы — ровно один <input> и один <label>, найдено: 2 и 2',
      ]);
    });

    it('подпись без for или с другим значением, чем id флажка, — ошибка (T15)', () => {
      const message = 'Mockup.astro: <label for> паузы не совпадает с id флажка — подпись не связана с флажком';
      const noFor = kitWith(FIGURE, (s) => withPause(s).replace(' for={motionId}>', '>'));
      expect(checkKit(noFor)).toEqual([message]);
      const other = kitWith(FIGURE, (s) => withPause(s).replace(' for={motionId}>', ' for={id}>'));
      expect(checkKit(other)).toEqual([message]);
    });

    it('input и label в других файлах кита ловятся прежним правилом тегов', () => {
      expect(checkKit(kitWith('ui/Panel.astro', beforeLastDiv('<input type="checkbox" />')))).toEqual([
        'ui/Panel.astro: тег <input> — внутри кита только div и span',
      ]);
      expect(checkKit(kitWith(SCENARIO_FILE, beforeLastDiv('<label></label>')))).toEqual([
        'kinds/Packflow.astro: тег <label> — внутри кита только div и span',
      ]);
    });
  });

  it('соглашение: у каждого вида есть kinds/{PascalCase(kind)}.astro; переименованный вид теряет разрешение цикла', () => {
    const dir = kitWith(SCENARIO_FILE, (s) => s);
    renameSync(join(dir, SCENARIO_FILE), join(dir, 'kinds/PackFlow.astro'));
    expect(checkKit(dir)).toEqual([
      'kinds/PackFlow.astro: бесконечная анимация (infinite)',
      'kinds/Packflow.astro: нет файла вида «packflow» (соглашение kinds/{PascalCase(kind)}.astro)',
    ]);
  });
});
