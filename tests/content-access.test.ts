// Гейт «продукт — это файл» (Constitution 2): коллекции читает только `src/lib/content.ts`.
// Страницы берут из `astro:content` только `render`, `content.config.ts` — `defineCollection`
// и `reference`; всё остальное — через функции `content.ts`. Тест заменяет ручной `grep`.

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

const ACCESS_POINT = 'lib/content.ts';
const CODE_FILE = /\.(ts|astro|mjs)$/;
/** Функции чтения коллекций Astro, включая live-коллекции. */
const COLLECTION_READ = /(?<![\w$])(getCollection|getEntry|getEntries|getLiveCollection|getLiveEntry)(?![\w$])/g;
const MODULE = /(['"])astro:content\1/g;
const STATIC_IMPORT = /\bimport\s+([^;'"]*?)\s+from\s+(['"])astro:content\2/g;

/** Что разрешено импортировать из `astro:content` вне точки доступа. */
function allowedImports(file: string): readonly string[] {
  if (file === 'content.config.ts') return ['defineCollection', 'reference'];
  if (file.startsWith('pages/')) return ['render'];
  return [];
}

function listCode(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && CODE_FILE.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Нарушения доступа к коллекциям в дереве `root` (каталог `src`). */
function findContentAccessViolations(root: string): string[] {
  const violations: string[] = [];
  for (const file of listCode(root)) {
    if (file === ACCESS_POINT) continue;
    const text = readFileSync(join(root, file), 'utf8');

    for (const match of text.matchAll(COLLECTION_READ)) {
      violations.push(`${file}:${lineOf(text, match.index)}: ${match[1]} вне ${ACCESS_POINT}`);
    }

    // Каждое упоминание модуля в кавычках должно быть статическим импортом разрешённых имён.
    const allowed = allowedImports(file);
    const imports = new Map<number, string>();
    for (const match of text.matchAll(STATIC_IMPORT)) {
      imports.set(match.index + match[0].length - 'astro:content'.length - 2, match[1]!);
    }
    for (const match of text.matchAll(MODULE)) {
      const clause = imports.get(match.index);
      const where = `${file}:${lineOf(text, match.index)}`;
      if (clause === undefined) {
        violations.push(`${where}: astro:content не статическим импортом`);
        continue;
      }
      const named = /^(?:type\s+)?\{([^}]*)\}$/.exec(clause.trim());
      if (named === null) {
        violations.push(`${where}: импорт «${clause.trim()}» из astro:content — только именованный`);
        continue;
      }
      for (const spec of named[1]!.split(',')) {
        const name = spec.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!;
        if (name !== '' && !allowed.includes(name)) {
          violations.push(`${where}: ${name} из astro:content вне ${ACCESS_POINT}`);
        }
      }
    }
  }
  return violations;
}

describe('доступ к коллекциям только через src/lib/content.ts', () => {
  it('в src нарушений нет', () => {
    expect(findContentAccessViolations(SRC)).toEqual([]);
  });

  it('точка доступа и её импорты действительно проверяются в дереве', () => {
    const files = listCode(SRC);
    expect(files).toContain(ACCESS_POINT);
    expect(files).toContain('content.config.ts');
    expect(files.some((f) => f.startsWith('pages/') && f.endsWith('.astro'))).toBe(true);
    expect(files.some((f) => f.startsWith('components/'))).toBe(true);
  });
});

describe('проба: файл-нарушитель в копии дерева', () => {
  let copy: string | undefined;

  afterEach(() => {
    if (copy !== undefined) rmSync(copy, { recursive: true, force: true });
    copy = undefined;
  });

  /** Копия `src` с добавленным файлом; возвращает нарушения копии. */
  function withFile(file: string, content: string): string[] {
    copy = mkdtempSync(join(tmpdir(), 'content-access-'));
    cpSync(SRC, copy, { recursive: true });
    mkdirSync(dirname(join(copy, file)), { recursive: true });
    writeFileSync(join(copy, file), content);
    return findContentAccessViolations(copy);
  }

  it('компонент вызывает getCollection — нарушение и по вызову, и по импорту', () => {
    const violations = withFile(
      'components/Rogue.astro',
      "---\nimport { getCollection } from 'astro:content';\nconst all = await getCollection('products');\n---\n",
    );
    expect(violations).toEqual([
      'components/Rogue.astro:2: getCollection вне lib/content.ts',
      'components/Rogue.astro:3: getCollection вне lib/content.ts',
      'components/Rogue.astro:2: getCollection из astro:content вне lib/content.ts',
    ]);
  });

  it('страница берёт getEntry рядом с render — нарушение только по getEntry', () => {
    const violations = withFile('pages/rogue.astro', "---\nimport { render, getEntry } from 'astro:content';\n---\n");
    expect(violations).toEqual([
      'pages/rogue.astro:2: getEntry вне lib/content.ts',
      'pages/rogue.astro:2: getEntry из astro:content вне lib/content.ts',
    ]);
  });

  it('render в компоненте (не странице) — нарушение', () => {
    expect(withFile('components/Body.astro', "---\nimport { render } from 'astro:content';\n---\n")).toEqual([
      'components/Body.astro:2: render из astro:content вне lib/content.ts',
    ]);
  });

  it('тип из astro:content вне точки доступа — нарушение', () => {
    expect(withFile('lib/extra.ts', "import type { CollectionEntry } from 'astro:content';\n")).toEqual([
      'lib/extra.ts:1: CollectionEntry из astro:content вне lib/content.ts',
    ]);
  });

  it('импорт пространства имён, реэкспорт и динамический импорт — нарушения', () => {
    expect(withFile('lib/ns.ts', "import * as content from 'astro:content';\n")).toEqual([
      'lib/ns.ts:1: импорт «* as content» из astro:content — только именованный',
    ]);
    expect(withFile('lib/reexport.mjs', "export { render } from 'astro:content';\n")).toEqual([
      'lib/reexport.mjs:1: astro:content не статическим импортом',
    ]);
    expect(withFile('lib/lazy.ts', "const c = await import('astro:content');\n")).toEqual([
      'lib/lazy.ts:1: astro:content не статическим импортом',
    ]);
  });

  it('псевдоним не прячет имя: getEntry as read — нарушение', () => {
    expect(withFile('pages/alias.astro', "---\nimport { getEntry as read } from 'astro:content';\n---\n")).toEqual([
      'pages/alias.astro:2: getEntry вне lib/content.ts',
      'pages/alias.astro:2: getEntry из astro:content вне lib/content.ts',
    ]);
  });

  it('упоминание в комментарии без кавычек нарушением не считается', () => {
    expect(withFile('lib/note.ts', '// Данные — из `astro:content` через content.ts.\nexport {};\n')).toEqual([]);
  });
});
