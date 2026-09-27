// Общая часть Lighthouse CI (Constitution 6): прод-сборка из ./dist, страницы — из sitemap
// плюс /404.html (scripts/lhci-urls.mjs), медиана трёх прогонов, порог 0.95 по четырём
// категориям (tests/lhci-config.test.ts). Порог не снижается (Constitution 8). Отчёты —
// только в файловую систему (lhci-reports/<профиль>/), в публичное хранилище не уходят.
const { lhciUrls } = require('./scripts/lhci-urls.mjs');

/**
 * Каталог отчётов для artifact CI. Вне .lighthouseci: `lhci collect` без --additive очищает
 * .lighthouseci в начале каждого прогона, и десктоп стирал отчёты мобайла (ep03 T14).
 */
const REPORTS_DIR = './lhci-reports';

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const MIN_SCORE = 0.95;

/**
 * @param {'mobile' | 'desktop'} profile
 * @param {Record<string, unknown>} [settings] настройки Lighthouse (по умолчанию — мобайл)
 * @param {string} [distDir] каталог прод-сборки (в тестах — фикстура, gates.yml тесты гоняет до сборки)
 */
function lhciConfig(profile, settings = {}, distDir = './dist') {
  return {
    ci: {
      collect: {
        staticDistDir: distDir,
        url: lhciUrls(distDir),
        numberOfRuns: 3,
        settings,
      },
      assert: {
        assertions: Object.fromEntries(
          CATEGORIES.map((category) => [
            `categories:${category}`,
            // 'median', а не 'median-run': в @lhci/utils 0.15 для categories:* при
            // 'median-run' берётся лучший из прогонов (Math.max), а не медиана (/my-verify ep01).
            ['error', { minScore: MIN_SCORE, aggregationMethod: 'median' }],
          ]),
        ),
      },
      upload: {
        target: 'filesystem',
        outputDir: `${REPORTS_DIR}/${profile}`,
      },
    },
  };
}

module.exports = { lhciConfig, REPORTS_DIR };
