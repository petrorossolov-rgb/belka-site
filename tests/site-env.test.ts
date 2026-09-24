import { describe, expect, it } from 'vitest';
import { indexable, parseSiteEnv, resolveSiteUrl, robotsTxt, sitemapEnabled, sitemapPageFilter } from '../src/lib/site-env';

describe('resolveSiteUrl', () => {
  it('production → основной домен', () => {
    expect(resolveSiteUrl('production')).toBe('https://belkascm.ru');
  });

  it('staging и development → стейджинг', () => {
    expect(resolveSiteUrl('staging')).toBe('https://staging.belkascm.ru');
    expect(resolveSiteUrl('development')).toBe('https://staging.belkascm.ru');
  });

  it('неизвестное значение → ошибка', () => {
    expect(() => resolveSiteUrl('prod')).toThrow(/SITE_ENV/);
    expect(() => resolveSiteUrl('')).toThrow(/SITE_ENV/);
  });
});

describe('sitemapEnabled', () => {
  it('включён только в production', () => {
    expect(sitemapEnabled('production')).toBe(true);
    expect(sitemapEnabled('staging')).toBe(false);
    expect(sitemapEnabled('development')).toBe(false);
  });
});

describe('parseSiteEnv', () => {
  it('пустое значение → development', () => {
    expect(parseSiteEnv(undefined)).toBe('development');
    expect(parseSiteEnv('')).toBe('development');
  });

  it('допустимые значения проходят как есть', () => {
    expect(parseSiteEnv('staging')).toBe('staging');
    expect(parseSiteEnv('production')).toBe('production');
  });

  it('неизвестное значение → ошибка, без отката к development', () => {
    expect(() => parseSiteEnv('Production')).toThrow(/SITE_ENV/);
  });
});

describe('indexable', () => {
  it('индексируется только production', () => {
    expect(indexable('production')).toBe(true);
    expect(indexable('staging')).toBe(false);
    expect(indexable('development')).toBe(false);
  });
});

describe('robotsTxt', () => {
  it('production — Allow и ссылка на sitemap-index', () => {
    expect(robotsTxt('production')).toBe('User-agent: *\nAllow: /\n\nSitemap: https://belkascm.ru/sitemap-index.xml\n');
  });

  it('staging и development — Disallow: /', () => {
    expect(robotsTxt('staging')).toBe('User-agent: *\nDisallow: /\n');
    expect(robotsTxt('development')).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('sitemapPageFilter', () => {
  it('отсекает страницы ошибок', () => {
    expect(sitemapPageFilter('https://belkascm.ru/404/')).toBe(false);
    expect(sitemapPageFilter('https://belkascm.ru/404.html')).toBe(false);
    expect(sitemapPageFilter('https://belkascm.ru/500/')).toBe(false);
  });

  it('обычные страницы проходят, включая похожие пути', () => {
    expect(sitemapPageFilter('https://belkascm.ru/')).toBe(true);
    expect(sitemapPageFilter('https://belkascm.ru/products/wms/')).toBe(true);
    expect(sitemapPageFilter('https://belkascm.ru/404-guide/')).toBe(true);
  });
});
