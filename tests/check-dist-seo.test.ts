import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDistSeo, routeOf } from '../scripts/check-dist-seo.mjs';

// Фикстуры повторяют вывод Astro: встроенные @font-face, preload двух файлов Onest, картинка
// через <picture>, canonical на прод-домен. Каждый тест правит свою копию во временном каталоге.
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/check-dist-seo.mjs', import.meta.url));

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(env: 'production' | 'staging'): string {
  const dir = mkdtempSync(join(tmpdir(), `dist-${env}-`));
  temps.push(dir);
  cpSync(join(FIXTURES, `dist-${env}`), dir, { recursive: true });
  return dir;
}

function edit(dir: string, file: string, change: (text: string) => string): void {
  const path = join(dir, file);
  writeFileSync(path, change(readFileSync(path, 'utf8')));
}

const addToHead = (tag: string) => (html: string) => html.replace('</head>', `${tag}</head>`);

function check(dir: string, env: 'production' | 'staging') {
  return checkDistSeo({ distDir: dir, env });
}

describe('check-dist-seo: production', () => {
  it('корректная прод-сборка → без нарушений, черновиков нет', () => {
    expect(check(fixture('production'), 'production')).toEqual({ errors: [], draftRoutes: [] });
  });

  it('404 в sitemap → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'sitemap-0.xml', (xml) =>
      xml.replace('</urlset>', '<url><loc>https://belkascm.ru/404/</loc></url></urlset>'),
    );
    expect(check(dir, 'production').errors).toContain('sitemap: страница ошибки https://belkascm.ru/404/');
  });

  it('noindex в прод-HTML → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', addToHead('<meta name="robots" content="noindex, nofollow">'));
    expect(check(dir, 'production').errors).toEqual(['index.html: noindex в прод-сборке']);
  });

  it('data-draft в прод-HTML → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', (html) => html.replace('<html lang="ru">', '<html lang="ru" data-draft>'));
    const result = check(dir, 'production');
    expect(result.errors).toContain('index.html: черновая страница (data-draft) в прод-сборке');
    expect(result.errors).toContain('sitemap: черновая страница https://belkascm.ru/');
  });

  it('robots.txt без Allow и Sitemap → ошибка', () => {
    const dir = fixture('production');
    writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    expect(check(dir, 'production').errors).toEqual([
      'robots.txt: «Disallow: /» в прод-сборке',
      'robots.txt: нет «Allow: /»',
      'robots.txt: нет «Sitemap: https://belkascm.ru/sitemap-index.xml»',
    ]);
  });

  it('нет sitemap-index.xml → ошибка', () => {
    const dir = fixture('production');
    rmSync(join(dir, 'sitemap-index.xml'));
    expect(check(dir, 'production').errors).toEqual(['нет sitemap-index.xml']);
  });

  it('URL чужого хоста в sitemap → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'sitemap-0.xml', (xml) => xml.replace('https://belkascm.ru/', 'https://staging.belkascm.ru/'));
    expect(check(dir, 'production').errors).toContain(
      'sitemap: https://staging.belkascm.ru/ — не https://belkascm.ru',
    );
  });

  it('sitemap ссылается на страницу, которой нет в сборке → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'sitemap-0.xml', (xml) =>
      xml.replace('</urlset>', '<url><loc>https://belkascm.ru/products/wms/</loc></url></urlset>'),
    );
    expect(check(dir, 'production').errors).toEqual([
      'sitemap: https://belkascm.ru/products/wms/ — такой страницы нет в сборке',
    ]);
  });
});

describe('check-dist-seo: staging', () => {
  it('корректная staging-сборка → без нарушений, одна черновая страница', () => {
    expect(check(fixture('staging'), 'staging')).toEqual({ errors: [], draftRoutes: ['/products/wms/'] });
  });

  it('staging без черновиков → пустой список маршрутов', () => {
    const dir = fixture('staging');
    rmSync(join(dir, 'products'), { recursive: true });
    expect(check(dir, 'staging')).toEqual({ errors: [], draftRoutes: [] });
  });

  it('staging без Disallow → ошибка', () => {
    const dir = fixture('staging');
    writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
    expect(check(dir, 'staging').errors).toEqual(['robots.txt: нет «Disallow: /» вне прода']);
  });

  it('staging с sitemap → ошибка', () => {
    const dir = fixture('staging');
    cpSync(join(FIXTURES, 'dist-production', 'sitemap-index.xml'), join(dir, 'sitemap-index.xml'));
    expect(check(dir, 'staging').errors).toEqual(['sitemap-index.xml: sitemap вне прод-сборки']);
  });

  it('страница без noindex → ошибка', () => {
    const dir = fixture('staging');
    edit(dir, '404.html', (html) => html.replace('<meta name="robots" content="noindex, nofollow">', ''));
    expect(check(dir, 'staging').errors).toEqual(['404.html: нет <meta name="robots" content="noindex, nofollow">']);
  });
});

describe('check-dist-seo: инварианты сборки', () => {
  it('стили Google Fonts → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', addToHead('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest">'));
    expect(check(dir, 'production').errors).toEqual([
      'index.html: внешний ресурс <link rel="stylesheet"> https://fonts.googleapis.com/css2?family=Onest',
    ]);
  });

  it('внешние картинки, srcset и url() в CSS → ошибки', () => {
    const dir = fixture('staging');
    edit(dir, 'index.html', (html) =>
      html
        .replace('<img src="/_astro/mark.png"', '<img src="//cdn.example.com/mark.png"')
        .replace('/_astro/mark@2x.avif 2x', 'https://cdn.example.com/mark.avif 2x'),
    );
    writeFileSync(join(dir, '_astro', 'base.css'), '@font-face{src:url(https://fonts.gstatic.com/x.woff2)}');
    expect(check(dir, 'staging').errors).toEqual([
      'index.html: внешний ресурс <source srcset> https://cdn.example.com/mark.avif',
      'index.html: внешний ресурс <img src> //cdn.example.com/mark.png',
      '_astro/base.css: внешний ресурс https://fonts.gstatic.com/x.woff2',
    ]);
  });

  it('preload файла Plex Mono (--font-mono) → ошибка', () => {
    const dir = fixture('production');
    edit(
      dir,
      'index.html',
      addToHead('<link rel="preload" href="/_astro/fonts/plex-mono-400.woff2" as="font" type="font/woff2" crossorigin>'),
    );
    expect(check(dir, 'production').errors).toEqual([
      'index.html: preload шрифта /_astro/fonts/plex-mono-400.woff2 — не файл основной гарнитуры (--font-sans)',
    ]);
  });

  it('<script src> → ошибка', () => {
    const dir = fixture('production');
    edit(dir, '404.html', addToHead('<script type="module" src="/x.js"></script>'));
    expect(check(dir, 'production').errors).toEqual(['404.html: <script src="/x.js"> — клиентский JS запрещён']);
  });

  it('встроенный <script> без src → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', addToHead('<script>console.log(1)</script>'));
    expect(check(dir, 'production').errors).toEqual(['index.html: <script> — клиентский JS запрещён']);
  });

  it('<script type="application/ld+json"> → без нарушений', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', addToHead('<script type="application/ld+json">{"@type":"Organization"}</script>'));
    expect(check(dir, 'production').errors).toEqual([]);
  });

  it('обычная внешняя ссылка <a href="https://…"> и canonical — не ресурсы', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', (html) => html.replace('</main>', '<p><a href="https://example.com/">Пример</a></p></main>'));
    expect(check(dir, 'production').errors).toEqual([]);
  });
});

describe('check-dist-seo: граничные случаи', () => {
  it('нет robots.txt → ошибка в обоих окружениях', () => {
    for (const env of ['production', 'staging'] as const) {
      const dir = fixture(env);
      rmSync(join(dir, 'robots.txt'));
      expect(check(dir, env).errors).toEqual(['нет robots.txt']);
    }
  });

  it('пустой sitemap при наличии страниц → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'sitemap-0.xml', (xml) => xml.replace('<url><loc>https://belkascm.ru/</loc></url>', ''));
    expect(check(dir, 'production').errors).toEqual(['sitemap пуст, хотя в сборке есть страницы']);
  });

  it('неизвестное окружение → исключение', () => {
    expect(() => checkDistSeo({ distDir: fixture('production'), env: 'prod' })).toThrow(/окружение «prod»/);
  });

  it('маршрут по файлу', () => {
    expect(routeOf('index.html')).toBe('/');
    expect(routeOf('products/wms/index.html')).toBe('/products/wms/');
    expect(routeOf('404.html')).toBe('/404.html');
  });
});

describe('check-dist-seo: запуск из командной строки', () => {
  function run(args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  }

  it('staging: код 0 и draft-routes.json с черновыми маршрутами', () => {
    const dir = fixture('staging');
    const out = join(dir, '..', `${dir.split(/[\\/]/).pop()}-draft-routes.json`);
    temps.push(out);
    const result = run(['staging', '--dist', dir, '--out', out]);
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(['/products/wms/']);
  });

  it('нарушение → код 1 и список в stderr', () => {
    const dir = fixture('staging');
    const out = join(dir, '..', `${dir.split(/[\\/]/).pop()}-draft-routes.json`);
    temps.push(out);
    const result = run(['production', '--dist', dir, '--out', out]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('нет sitemap-index.xml');
    expect(existsSync(out)).toBe(true);
  });

  it('неверный вызов → код 2', () => {
    expect(run(['prod']).status).toBe(2);
    expect(run(['staging', '--dist']).status).toBe(2);
  });
});
