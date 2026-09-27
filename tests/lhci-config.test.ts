import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Гейт Lighthouse (Constitution 6, 8): порог 0.95 сравнивается с медианой трёх прогонов,
// а не с лучшим из них. Проверка — настоящей функцией assert из @lhci/utils на
// конфиге проекта. При 'median-run' категории в 0.15 агрегируются через Math.max,
// и [0.90, 0.94, 1.00] проходил гейт (/my-verify ep01).

const require = createRequire(import.meta.url);
// Фикстура прод-сборки: в gates.yml тесты идут до сборки, dist/ ещё нет.
const DIST = fileURLToPath(new URL('./fixtures/dist-production/', import.meta.url));
const { lhciConfig, REPORTS_DIR } = require('../lighthouserc.base.cjs') as {
  lhciConfig: (
    profile: string,
    settings: object,
    distDir: string,
  ) => { ci: { assert: { assertions: Record<string, unknown> }; upload: { outputDir: string } } };
  REPORTS_DIR: string;
};
const GATES = fileURLToPath(new URL('../.github/workflows/gates.yml', import.meta.url));
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

/** Каталог, который `lhci collect` очищает в начале каждого прогона (без --additive). */
const COLLECT_DIR = '.lighthouseci';
const PROFILES = ['mobile', 'desktop'];

/** `./lhci-reports/` → `lhci-reports`: `posix.normalize` убирает `./`, хвостовой `/` — здесь. */
const norm = (path: string) => {
  const normal = posix.normalize(path);
  return normal.endsWith('/') ? normal.slice(0, -1) : normal;
};
const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

/**
 * Почему отчёты профиля не доживут до artifact: каталог внутри очищаемого `.lighthouseci`
 * (следующий профиль его сотрёт), совпадает с каталогом другого профиля или лежит вне пути artifact.
 */
function reportDirProblems(outputDirs: Record<string, string>, artifactPath: string): string[] {
  const problems: string[] = [];
  const artifact = norm(artifactPath);
  const seen = new Map<string, string>();
  for (const [profile, raw] of Object.entries(outputDirs)) {
    const dir = norm(raw);
    if (inside(dir, COLLECT_DIR)) problems.push(`${profile}: ${raw} внутри ${COLLECT_DIR} — его очищает следующий lhci collect`);
    if (!inside(dir, artifact)) problems.push(`${profile}: ${raw} вне artifact ${artifactPath}`);
    const other = seen.get(dir);
    if (other !== undefined) problems.push(`${profile}: ${raw} совпадает с каталогом ${other}`);
    seen.set(dir, profile);
  }
  return problems;
}

/** Путь artifact шага «Отчёты Lighthouse» в gates.yml. */
function reportsArtifactPath(): string {
  const yml = readFileSync(GATES, 'utf8');
  const step = yml.split('- name: ').find((s) => s.startsWith('Отчёты Lighthouse'));
  const path = step?.match(/^\s+path:\s*(\S+)/m)?.[1];
  if (path === undefined) throw new Error('gates.yml: нет шага «Отчёты Lighthouse» с path');
  return path;
}

describe('Lighthouse CI: отчёты обоих профилей попадают в artifact (ep03 T14)', () => {
  const outputDirs = Object.fromEntries(PROFILES.map((p) => [p, lhciConfig(p, {}, DIST).ci.upload.outputDir]));

  it('каталоги профилей вне .lighthouseci, разные и внутри пути artifact gates.yml', () => {
    expect(reportsArtifactPath()).toBe(`${norm(REPORTS_DIR)}/`);
    expect(reportDirProblems(outputDirs, reportsArtifactPath())).toEqual([]);
  });

  it('проба: прежний ./.lighthouseci/<профиль> ловится — десктоп стирал мобайл', () => {
    const old = { mobile: './.lighthouseci/mobile', desktop: './.lighthouseci/desktop' };
    expect(reportDirProblems(old, '.lighthouseci/')).toEqual([
      'mobile: ./.lighthouseci/mobile внутри .lighthouseci — его очищает следующий lhci collect',
      'desktop: ./.lighthouseci/desktop внутри .lighthouseci — его очищает следующий lhci collect',
    ]);
  });

  it('проба: общий каталог профилей и каталог вне artifact ловятся', () => {
    expect(reportDirProblems({ mobile: './lhci-reports', desktop: './lhci-reports' }, 'lhci-reports/')).toEqual([
      'desktop: ./lhci-reports совпадает с каталогом mobile',
    ]);
    expect(reportDirProblems({ mobile: './lhci-reports/mobile' }, 'reports/')).toEqual([
      'mobile: ./lhci-reports/mobile вне artifact reports/',
    ]);
  });
});
