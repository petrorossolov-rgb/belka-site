// Общая часть Lighthouse CI (Constitution 6): прод-сборка из ./dist, страницы — из sitemap
// плюс /404.html (scripts/lhci-urls.mjs), медиана трёх прогонов, порог 0.95 по четырём
// категориям. Порог не снижается (Constitution 8). Отчёты — только в файловую систему
// (.lighthouseci/<профиль>/), в публичное хранилище не уходят.
const { lhciUrls } = require('./scripts/lhci-urls.mjs');

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const MIN_SCORE = 0.95;

/**
 * @param {'mobile' | 'desktop'} profile
 * @param {Record<string, unknown>} [settings] настройки Lighthouse (по умолчанию — мобайл)
 */
function lhciConfig(profile, settings = {}) {
  return {
    ci: {
      collect: {
        staticDistDir: './dist',
        url: lhciUrls('dist'),
        numberOfRuns: 3,
        settings,
      },
      assert: {
        assertions: Object.fromEntries(
          CATEGORIES.map((category) => [
            `categories:${category}`,
            ['error', { minScore: MIN_SCORE, aggregationMethod: 'median-run' }],
          ]),
        ),
      },
      upload: {
        target: 'filesystem',
        outputDir: `./.lighthouseci/${profile}`,
      },
    },
  };
}

module.exports = { lhciConfig };
