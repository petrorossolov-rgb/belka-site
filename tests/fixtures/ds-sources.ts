import { existsSync, readFileSync } from 'node:fs';
import snapshot from './ds-sources.json';

// Исходники ДС лежат в приватном репозитории документов (docs/inputs/…), в публичном
// репозитории их нет. Публичные тесты сверяют копии в src/ со снимком ds-sources.json,
// а tests/ds-sources.test.ts — снимок с исходниками, когда docs/ есть рядом.

export type TokenMap = Map<string, string>;

/** `--name: value;` вне комментариев. Парсер намеренно простой, без postcss (T03). */
export function parseTokens(css: string, into: TokenMap = new Map()): TokenMap {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    into.set(match[1]!, match[2]!.trim());
  }
  return into;
}

export const DS_TOKEN_FILES = ['colors.css', 'typography.css', 'spacing.css'] as const;
export type DsTokenFile = (typeof DS_TOKEN_FILES)[number];

export const DS_ROOT = new URL('../../docs/inputs/design-belka/design/', import.meta.url);

/** Токены исходного файла ДС по снимку. */
export function snapshotTokens(file: DsTokenFile): TokenMap {
  return new Map(Object.entries(snapshot.tokens[file]));
}

/** SHA-256 исходных растров знака по снимку. */
export const DS_LOGO_SHA256: Readonly<Record<string, string>> = snapshot.logo;

/** Исходники ДС рядом: рабочая копия с приватным репозиторием документов. */
export function hasDsSources(): boolean {
  return existsSync(DS_ROOT);
}

export function readDsFile(path: string): Buffer {
  return readFileSync(new URL(path, DS_ROOT));
}
