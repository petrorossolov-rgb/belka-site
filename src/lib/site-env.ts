// Окружение сборки: какие страницы видны, какой `site`, включён ли sitemap.
// Чистые функции без импорта `astro:*` — их читают и `astro.config.mjs`, и тесты.

export const SITE_ENVS = ['development', 'staging', 'production'] as const;

export type SiteEnv = (typeof SITE_ENVS)[number];

export const DEFAULT_SITE_ENV: SiteEnv = 'development';

const SITE_URLS: Record<SiteEnv, string> = {
  production: 'https://belkascm.ru',
  staging: 'https://staging.belkascm.ru',
  development: 'https://staging.belkascm.ru',
};

export function isSiteEnv(value: unknown): value is SiteEnv {
  return typeof value === 'string' && (SITE_ENVS as readonly string[]).includes(value);
}

/** Пустое значение — `development`; неизвестное — ошибка, а не тихий откат. */
export function parseSiteEnv(value: string | undefined): SiteEnv {
  if (value === undefined || value === '') return DEFAULT_SITE_ENV;
  if (!isSiteEnv(value)) {
    throw new Error(`SITE_ENV: неизвестное значение «${value}», допустимо: ${SITE_ENVS.join(', ')}`);
  }
  return value;
}

export function resolveSiteUrl(env: string): string {
  if (!isSiteEnv(env)) {
    throw new Error(`SITE_ENV: неизвестное значение «${env}», допустимо: ${SITE_ENVS.join(', ')}`);
  }
  return SITE_URLS[env];
}

export function sitemapEnabled(env: SiteEnv): boolean {
  return env === 'production';
}

/** Индексируется только прод: стейджинг и разработка отдают noindex и `Disallow: /` (Constitution 7). */
export function indexable(env: SiteEnv): boolean {
  return env === 'production';
}

/** Страницы кодов ответа (`/404/`, `/404.html`, то же для 500) в sitemap не попадают. */
export function sitemapPageFilter(page: string): boolean {
  return !/^\/(404|500)(\/|\.html)?$/.test(new URL(page).pathname);
}

/** Содержимое `robots.txt` для окружения. */
export function robotsTxt(env: SiteEnv): string {
  if (!indexable(env)) {
    return 'User-agent: *\nDisallow: /\n';
  }
  return `User-agent: *\nAllow: /\n\nSitemap: ${resolveSiteUrl(env)}/sitemap-index.xml\n`;
}
