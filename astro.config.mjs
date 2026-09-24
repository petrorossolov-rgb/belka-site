// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { loadEnv } from 'vite';
import {
  SITE_ENVS,
  DEFAULT_SITE_ENV,
  parseSiteEnv,
  resolveSiteUrl,
  sitemapEnabled,
  sitemapPageFilter,
} from './src/lib/site-env.ts';

// `astro:env` в конфиге недоступен, поэтому SITE_ENV читается через loadEnv:
// он учитывает и process.env, и файлы .env*.
const { SITE_ENV } = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const siteEnv = parseSiteEnv(SITE_ENV);

// Подмножества Fontsource (unicode.json пакетов). Латиница нужна и русскому тексту:
// в ней пробел, цифры, «ёлочки» и тире.
/** @typedef {[string, ...string[]]} UnicodeRange */
/** @type {UnicodeRange} */
const UNICODE_CYRILLIC = ['U+0301', 'U+0400-045F', 'U+0490-0491', 'U+04B0-04B1', 'U+2116'];
/** @type {UnicodeRange} */
const UNICODE_LATIN = [
  'U+0000-00FF', 'U+0131', 'U+0152-0153', 'U+02BB-02BC', 'U+02C6', 'U+02DA', 'U+02DC', 'U+0304',
  'U+0308', 'U+0329', 'U+2000-206F', 'U+20AC', 'U+2122', 'U+2191', 'U+2193', 'U+2212', 'U+2215',
  'U+FEFF', 'U+FFFD',
];
const FONTS_DIR = './src/assets/fonts';

/** @typedef {{ weight: string, style: 'normal', display: 'swap', unicodeRange: UnicodeRange, src: [string] }} SubsetVariant */

/**
 * Два варианта одного начертания: кириллица и латиница.
 * @param {string} weight
 * @param {string} file имя файла, `%` — подмножество
 * @returns {[SubsetVariant, SubsetVariant]}
 */
const subsetVariants = (weight, file) => [
  { weight, style: 'normal', display: 'swap', unicodeRange: UNICODE_CYRILLIC, src: [`${FONTS_DIR}/${file.replace('%', 'cyrillic')}`] },
  { weight, style: 'normal', display: 'swap', unicodeRange: UNICODE_LATIN, src: [`${FONTS_DIR}/${file.replace('%', 'latin')}`] },
];

export default defineConfig({
  site: resolveSiteUrl(siteEnv),
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  // Sitemap только в проде; черновиков в прод-сборке нет, 404 отсекает фильтр (T16).
  integrations: sitemapEnabled(siteEnv) ? [sitemap({ filter: sitemapPageFilter })] : [],
  // Self-host, без внешних запросов (Constitution 4); fallback-метрики Fonts API включены по умолчанию.
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Onest',
      cssVariable: '--font-sans',
      fallbacks: ['sans-serif'],
      options: {
        variants: subsetVariants('100 900', 'onest-%-wght-normal.woff2'),
      },
    },
    {
      provider: fontProviders.local(),
      name: 'IBM Plex Mono',
      cssVariable: '--font-mono',
      fallbacks: ['monospace'],
      options: {
        variants: [
          ...subsetVariants('400', 'ibm-plex-mono-%-400-normal.woff2'),
          ...subsetVariants('500', 'ibm-plex-mono-%-500-normal.woff2'),
        ],
      },
    },
  ],
  env: {
    schema: {
      SITE_ENV: envField.enum({
        context: 'server',
        access: 'public',
        values: [...SITE_ENVS],
        default: DEFAULT_SITE_ENV,
      }),
    },
  },
});
