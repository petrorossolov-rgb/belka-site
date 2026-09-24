// Lighthouse CI, десктоп: пресет Lighthouse `desktop`.
//   npx lhci autorun --config=lighthouserc.desktop.cjs
const { lhciConfig } = require('./lighthouserc.base.cjs');

module.exports = lhciConfig('desktop', { preset: 'desktop' });
