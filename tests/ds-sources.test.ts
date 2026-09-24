import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DS_LOGO_SHA256,
  DS_TOKEN_FILES,
  hasDsSources,
  parseTokens,
  readDsFile,
  snapshotTokens,
} from './fixtures/ds-sources';

// Снимок ds-sources.json совпадает с исходниками ДС. Исходники — в приватном репозитории
// документов (docs/), поэтому в публичном CI этих проверок нет, там работают сверки копий
// со снимком (contrast.test.ts, logo.test.ts). Локально docs/ всегда рядом; REQUIRE_DOCS=1
// (npm run check:docs) превращает отсутствие исходников в ошибку.
// Обновление ДС: скопировать файлы в src/, пересобрать снимок и прогнать npm run check:docs.
const required = process.env['REQUIRE_DOCS'] === '1';

describe('снимок исходников ДС', () => {
  it.runIf(required)('исходники ДС на месте', () => {
    expect(hasDsSources(), 'нет docs/inputs/design-belka/design — клонируйте репозиторий документов в docs/').toBe(true);
  });

  describe.runIf(hasDsSources())('совпадает с docs/inputs', () => {
    it.each(DS_TOKEN_FILES)('tokens/%s', (file) => {
      const source = parseTokens(readDsFile(`tokens/${file}`).toString('utf8'));
      expect(Object.fromEntries(snapshotTokens(file))).toEqual(Object.fromEntries(source));
    });

    it.each(Object.keys(DS_LOGO_SHA256))('assets/logo/%s', (file) => {
      const sha256 = createHash('sha256').update(readDsFile(`assets/logo/${file}`)).digest('hex');
      expect(DS_LOGO_SHA256[file]).toBe(sha256);
    });
  });
});
