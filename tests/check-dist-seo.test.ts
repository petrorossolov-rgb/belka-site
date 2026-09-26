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

  it('внешний ресурс через style="", SVG <image>, object, embed, track, input, script src JSON-LD и @import "…" → ошибки', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', (html) =>
      html.replace(
        '</body>',
        [
          '<div style="background-image:url(https://cdn.example.com/a.png)"></div>',
          '<div style="background:url(&quot;//cdn.example.com/b.png&quot;)"></div>',
          '<svg><image href="https://cdn.example.com/c.png"/><image xlink:href="https://cdn.example.com/d.png"/></svg>',
          '<object data="https://cdn.example.com/e.pdf"></object>',
          '<embed src="https://cdn.example.com/f.pdf">',
          '<video><track src="https://cdn.example.com/g.vtt"></video>',
          '<input type="image" src="https://cdn.example.com/h.png" alt="">',
          '<script type="application/ld+json" src="https://cdn.example.com/i.json"></script>',
          '</body>',
        ].join(''),
      ),
    );
    writeFileSync(join(dir, '_astro', 'base.css'), '@import "https://cdn.example.com/j.css";@import \'//cdn.example.com/k.css\';');
    expect(check(dir, 'production').errors.sort()).toEqual([
      '_astro/base.css: внешний ресурс //cdn.example.com/k.css',
      '_astro/base.css: внешний ресурс https://cdn.example.com/j.css',
      'index.html: внешний ресурс <embed src> https://cdn.example.com/f.pdf',
      'index.html: внешний ресурс <image href> https://cdn.example.com/c.png',
      'index.html: внешний ресурс <image xlink:href> https://cdn.example.com/d.png',
      'index.html: внешний ресурс <input src> https://cdn.example.com/h.png',
      'index.html: внешний ресурс <object data> https://cdn.example.com/e.pdf',
      'index.html: внешний ресурс <script src> https://cdn.example.com/i.json',
      'index.html: внешний ресурс <track src> https://cdn.example.com/g.vtt',
      'index.html: внешний ресурс url() в style у <div> //cdn.example.com/b.png',
      'index.html: внешний ресурс url() в style у <div> https://cdn.example.com/a.png',
    ].sort());
  });

  it('свои ресурсы в style="", SVG <image> и @import проходят', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', (html) =>
      html.replace('</body>', '<div style="background:url(/_astro/a.png)"></div><svg><image href="/_astro/c.png"/></svg></body>'),
    );
    writeFileSync(join(dir, '_astro', 'base.css'), '@import "/_astro/j.css";');
    expect(check(dir, 'production').errors).toEqual([]);
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

describe('check-dist-seo: черновые блоки', () => {
  const draftBlock = (html: string) =>
    html.replace('</main>', '<section data-draft-block="theses"><h2>Секция</h2></section></main>');

  it('data-draft-block в production → ошибка с маршрутом', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', draftBlock);
    expect(check(dir, 'production').errors).toEqual([
      'index.html: черновой блок <section data-draft-block="theses"> в прод-сборке (маршрут /)',
    ]);
  });

  it('атрибут без значения и на вложенной странице тоже ловится', () => {
    const dir = fixture('production');
    edit(dir, '404.html', (html) => html.replace('</main>', '<div class="x" data-draft-block></div></main>'));
    expect(check(dir, 'production').errors).toEqual([
      '404.html: черновой блок <div data-draft-block> в прод-сборке (маршрут /404.html)',
    ]);
  });

  it('data-draft-block в staging → без нарушений', () => {
    const dir = fixture('staging');
    edit(dir, 'index.html', draftBlock);
    expect(check(dir, 'staging')).toEqual({ errors: [], draftRoutes: ['/products/wms/'] });
  });

  it('похожий атрибут и текст в содержимом — не маркер', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', (html) =>
      html.replace('</main>', '<section data-draft-blocks="x"><p>атрибут data-draft-block</p></section></main>'),
    );
    expect(check(dir, 'production').errors).toEqual([]);
  });
});

describe('check-dist-seo: og:image', () => {
  const PNG = join('_astro', 'og-default.png');

  /** PNG-заголовок с IHDR нужных размеров, добитый нулями до `bytes` (гейт читает только IHDR и вес). */
  function writePng(dir: string, file: string, width: number, height: number, bytes = 64) {
    const buffer = Buffer.alloc(bytes);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
    buffer.writeUInt32BE(13, 8);
    buffer.write('IHDR', 12, 'latin1');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    writeFileSync(join(dir, file), buffer);
  }

  const setMeta = (property: string, content: string | null) => (html: string) => {
    const re = new RegExp(`<meta property="${property}" content="[^"]*">`);
    expect(html).toMatch(re);
    return html.replace(re, content === null ? '' : `<meta property="${property}" content="${content}">`);
  };

  it('корректная картинка в обоих окружениях → без нарушений', () => {
    for (const env of ['production', 'staging'] as const) {
      expect(check(fixture(env), env).errors).toEqual([]);
    }
  });

  it('страница без og:image проходит (404 фикстуры)', () => {
    const dir = fixture('production');
    expect(readFileSync(join(dir, '404.html'), 'utf8')).not.toContain('og:image');
    rmSync(join(dir, PNG));
    edit(dir, 'index.html', (html) => html.replace(/<meta property="og:image[^>]*>/g, ''));
    expect(check(dir, 'production').errors).toEqual([]);
  });

  it('og:image на несуществующий файл → ошибка в обоих окружениях', () => {
    for (const env of ['production', 'staging'] as const) {
      const dir = fixture(env);
      edit(dir, 'index.html', setMeta('og:image', 'https://belkascm.ru/_astro/missing.png'));
      expect(check(dir, env).errors).toEqual([
        'index.html: og:image https://belkascm.ru/_astro/missing.png — файла _astro/missing.png нет в сборке',
      ]);
    }
  });

  it('og:image с чужого хоста → ошибка', () => {
    const dir = fixture('staging');
    edit(dir, 'index.html', setMeta('og:image', 'https://staging.belkascm.ru/_astro/og-default.png'));
    expect(check(dir, 'staging').errors).toEqual([
      'index.html: og:image: https://staging.belkascm.ru/_astro/og-default.png — не https://belkascm.ru',
    ]);
  });

  it('размеры файла не совпадают с разметкой → ошибка (и по ширине, и по высоте)', () => {
    const dir = fixture('production');
    writePng(dir, PNG, 1200, 631);
    expect(check(dir, 'production').errors).toEqual([
      'index.html: og:image _astro/og-default.png — 1200×631, в разметке 1200×630',
    ]);
    writePng(dir, PNG, 1199, 630);
    expect(check(dir, 'production').errors).toEqual([
      'index.html: og:image _astro/og-default.png — 1199×630, в разметке 1200×630',
    ]);
  });

  it('307 200 байт проходит, 307 201 — ошибка', () => {
    const dir = fixture('production');
    writePng(dir, PNG, 1200, 630, 307_200);
    expect(check(dir, 'production').errors).toEqual([]);
    writePng(dir, PNG, 1200, 630, 307_201);
    expect(check(dir, 'production').errors).toEqual([
      'index.html: og:image _astro/og-default.png — 307201 байт, предел 307200',
    ]);
  });

  it('не PNG → ошибка: размеры не проверить', () => {
    const dir = fixture('production');
    writeFileSync(join(dir, PNG), Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(0)]));
    expect(check(dir, 'production').errors).toEqual([
      'index.html: og:image _astro/og-default.png — не PNG, размеры не проверить',
    ]);
  });

  it('alt из пробелов или без alt → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', setMeta('og:image:alt', '   '));
    expect(check(dir, 'production').errors).toEqual(['index.html: у og:image нет непустого og:image:alt']);
    edit(dir, 'index.html', setMeta('og:image:alt', null));
    expect(check(dir, 'production').errors).toEqual(['index.html: у og:image нет непустого og:image:alt']);
  });

  it('нет og:image:height или og:image:width → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', setMeta('og:image:height', null));
    expect(check(dir, 'production').errors).toEqual(['index.html: у og:image нет og:image:height']);
    const other = fixture('staging');
    edit(other, 'index.html', setMeta('og:image:width', null));
    expect(check(other, 'staging').errors).toEqual(['index.html: у og:image нет og:image:width']);
  });

  it('два og:image → ошибка', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', addToHead('<meta property="og:image" content="https://belkascm.ru/_astro/og-default.png">'));
    expect(check(dir, 'production').errors).toEqual(['index.html: og:image встречается 2 раза — нужен один']);
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
