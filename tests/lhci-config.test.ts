import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Гейт Lighthouse (Constitution 6, 8): порог 0.95 сравнивается с медианой трёх прогонов,
// а не с лучшим из них. Проверка — настоящей функцией assert из @lhci/utils на
// конфиге проекта. При 'median-run' категории в 0.15 агрегируются через Math.max,
// и [0.90, 0.94, 1.00] проходил гейт (/my-verify ep01).

const require = createRequire(import.meta.url);
// Фикстура прод-сборки: в gates.yml тесты идут до сборки, dist/ ещё нет.
const DIST = fileURLToPath(new URL('./fixtures/dist-production/', import.meta.url));
const { lhciConfig } = require('../lighthouserc.base.cjs') as {
  lhciConfig: (
    profile: string,
    settings: object,
    distDir: string,
  ) => { ci: { assert: { assertions: Record<string, unknown> } } };
};
const { getAllAssertionResults } = require('@lhci/utils/src/assertions.js') as {
  getAllAssertionResults: (options: unknown, lhrs: unknown[]) => Array<{ auditProperty?: string; actual: number }>;
};

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

function lhr(performance: number) {
  const score = (id: string) => ({ id, score: id === 'performance' ? performance : 1 });
  return {
    finalUrl: 'http://localhost/',
    categories: Object.fromEntries(CATEGORIES.map((id) => [id, score(id)])),
    audits: {
      'first-contentful-paint': { numericValue: 1000 },
      interactive: { numericValue: 2000 },
    },
  };
}

function failedCategories(perfRuns: number[]): string[] {
  const { assertions } = lhciConfig('mobile', {}, DIST).ci.assert;
  return getAllAssertionResults({ assertions }, perfRuns.map(lhr)).map((r) => r.auditProperty ?? '');
}

describe('Lighthouse CI: агрегация прогонов', () => {
  it('медиана ниже порога — гейт падает, даже если один прогон 1.00', () => {
    expect(failedCategories([0.9, 0.94, 1])).toEqual(['performance']);
  });

  it('один провальный прогон при медиане выше порога — гейт проходит', () => {
    expect(failedCategories([0.93, 0.99, 1])).toEqual([]);
  });

  it('порог 0.95 и все четыре категории', () => {
    const { assertions } = lhciConfig('desktop', {}, DIST).ci.assert;
    expect(Object.keys(assertions).sort()).toEqual(CATEGORIES.map((c) => `categories:${c}`).sort());
    for (const value of Object.values(assertions)) {
      expect(value).toEqual(['error', expect.objectContaining({ minScore: 0.95 })]);
    }
  });
});
