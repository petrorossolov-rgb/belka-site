// Lighthouse CI, мобайл: настройки Lighthouse по умолчанию (эмуляция телефона, троттлинг).
//   npx lhci autorun --config=lighthouserc.mobile.cjs
const { lhciConfig } = require('./lighthouserc.base.cjs');

module.exports = lhciConfig('mobile');
