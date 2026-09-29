import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function fixture(env: 'production' | 'staging' | 'metrika'): string {
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

// Режим Метрики (ep05) у функции обязателен; помощник теста передаёт «выкл.» по умолчанию —
// прежние пробы проверяют сборку сайта без Метрики, как и раньше.
function check(dir: string, env: 'production' | 'staging', metrika: 'on' | 'off' = 'off') {
  return checkDistSeo({ distDir: dir, env, metrika });
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
  // `--metrika` обязателен (ep05); помощник добавляет «off», если вызов его не задал.
  function run(args: string[]) {
    const mode = args.includes('--metrika') ? [] : ['--metrika', 'off'];
    return spawnSync(process.execPath, [SCRIPT, ...args, ...mode], { encoding: 'utf8' });
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

// ep05: режим Метрики. Режим берётся из site.yaml (site-flags), а не из сборки. «Выкл.» — прежние
// правила плюс два новых; «вкл.» — ровно один <script src="/js/consent.js" defer> без тела на
// каждой странице, файл скрипта в сборке, без <noscript>. Каждая проба ждёт сообщение НОВОГО
// правила. Фикстура «вкл.» — tests/fixtures/dist-metrika/ (staging-сборка пробы с плашкой).
describe('check-dist-seo: режим Метрики «выкл.» (ep05)', () => {
  it('файл js/consent.js в сборке → ошибка', () => {
    const dir = fixture('production');
    mkdirSync(join(dir, 'js'));
    writeFileSync(join(dir, 'js', 'consent.js'), '(function () {})();\n');
    expect(check(dir, 'production').errors).toEqual([
      'js/consent.js: скрипт согласия в сборке, а Метрика выключена (site.flags.metrikaEnabled)',
    ]);
  });

  it('разметка плашки <aside hidden data-consent> → ошибка с маршрутом', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', (html) => html.replace('</body>', '<aside hidden data-consent><p>Плашка</p></aside></body>'));
    expect(check(dir, 'production').errors).toEqual([
      'index.html: разметка плашки согласия <aside data-consent> в сборке, а Метрика выключена (маршрут /)',
    ]);
  });

  it('data-consent на любом элементе и в staging тоже ловится; похожий атрибут — нет', () => {
    const dir = fixture('staging');
    edit(dir, 'index.html', (html) => html.replace('</body>', '<div data-consent="x"></div><div data-consented></div></body>'));
    expect(check(dir, 'staging').errors).toEqual([
      'index.html: разметка плашки согласия <div data-consent> в сборке, а Метрика выключена (маршрут /)',
    ]);
  });

  // ep05 T10: REVIEWER.md обещает, что при выключенном флаге нет и кнопки «Настройки cookie» —
  // элемент с атрибутом data-consent-* (settings, allow, deny) тоже разметка согласия.
  it('кнопка «Настройки cookie» <button data-consent-settings> без плашки → ошибка своим сообщением', () => {
    const dir = fixture('production');
    edit(dir, 'index.html', (html) => html.replace('</body>', '<footer><button type="button" data-consent-settings>Настройки</button></footer></body>'));
    expect(check(dir, 'production').errors).toEqual([
      'index.html: элемент согласия <button data-consent-settings> в сборке, а Метрика выключена (маршрут /)',
    ]);
  });

  it('data-consent-allow и data-consent-deny ловятся по одному разу; data-consented — нет', () => {
    const dir = fixture('staging');
    edit(dir, 'index.html', (html) => html.replace('</body>', '<button data-consent-allow>Да</button><button data-consent-deny>Нет</button><div data-consented></div></body>'));
    expect(check(dir, 'staging').errors).toEqual([
      'index.html: элемент согласия <button data-consent-allow> в сборке, а Метрика выключена (маршрут /)',
      'index.html: элемент согласия <button data-consent-deny> в сборке, а Метрика выключена (маршрут /)',
    ]);
  });

  it('положительная пара: текущая dist-production проходит в «выкл.» и падает в «вкл.»', () => {
    expect(check(fixture('production'), 'production', 'off').errors).toEqual([]);
    expect(check(fixture('production'), 'production', 'on').errors).toContain(
      'index.html: нет <script src="/js/consent.js" defer> — Метрика включена',
    );
  });

  it('фикстура «вкл.» в режиме «выкл.» → новые правила и прежний запрет скрипта', () => {
    const errors = check(fixture('metrika'), 'staging', 'off').errors;
    expect(errors).toContain('js/consent.js: скрипт согласия в сборке, а Метрика выключена (site.flags.metrikaEnabled)');
    expect(errors).toContain('index.html: <script src="/js/consent.js"> — клиентский JS запрещён');
  });
});

describe('check-dist-seo: режим Метрики «вкл.» (ep05)', () => {
  const tag = '<script src="/js/consent.js" defer></script>';
  const mutate = (change: (html: string) => string) => {
    const dir = fixture('metrika');
    edit(dir, 'index.html', change);
    return check(dir, 'staging', 'on').errors;
  };

  it('чистая фикстура dist-metrika проходит; черновые маршруты — как у staging', () => {
    expect(check(fixture('metrika'), 'staging', 'on')).toEqual({ errors: [], draftRoutes: ['/products/wms/'] });
  });

  it('страница без скрипта → ошибка', () => {
    expect(mutate((html) => html.replace(tag, ''))).toEqual([
      'index.html: нет <script src="/js/consent.js" defer> — Метрика включена',
    ]);
  });

  it('скрипт согласия с телом → ошибка', () => {
    expect(mutate((html) => html.replace(tag, '<script src="/js/consent.js" defer>ym(1, "init")</script>'))).toEqual([
      'index.html: у <script src="/js/consent.js"> есть тело — скрипт подключается только файлом',
    ]);
  });

  it('два скрипта согласия → ошибка', () => {
    expect(mutate((html) => html.replace(tag, tag + tag))).toEqual([
      'index.html: <script src="/js/consent.js"> подключён 2 раза — нужен ровно один',
    ]);
  });

  it('src="/js/other.js" вместо скрипта согласия → нет скрипта согласия и прежний запрет', () => {
    expect(mutate((html) => html.replace(tag, '<script src="/js/other.js" defer></script>'))).toEqual([
      'index.html: нет <script src="/js/consent.js" defer> — Метрика включена',
      'index.html: <script src="/js/other.js"> — клиентский JS запрещён',
    ]);
  });

  it('внешний src вместо скрипта согласия → нет скрипта согласия и прежние запреты', () => {
    const errors = mutate((html) => html.replace(tag, '<script src="https://mc.yandex.ru/metrika/tag.js" defer></script>'));
    expect(errors[0]).toBe('index.html: нет <script src="/js/consent.js" defer> — Метрика включена');
    expect(errors).toContain('index.html: <script src="https://mc.yandex.ru/metrika/tag.js"> — клиентский JS запрещён');
  });

  it('инлайн-скрипт рядом со скриптом согласия → прежний запрет', () => {
    expect(mutate((html) => html.replace(tag, `${tag}<script>ym(1, "init")</script>`))).toEqual([
      'index.html: <script> — клиентский JS запрещён',
    ]);
  });

  it.each([
    ['type="module"', '<script type="module" src="/js/consent.js" defer></script>', 'defer, src, type'],
    ['без defer', '<script src="/js/consent.js"></script>', 'src'],
    ['async вместо defer', '<script src="/js/consent.js" async></script>', 'async, src'],
    ['лишний атрибут', '<script src="/js/consent.js" defer data-counter="1"></script>', 'data-counter, defer, src'],
  ])('%s → ошибка формы тега', (_name, replacement, attrs) => {
    expect(mutate((html) => html.replace(tag, replacement))).toEqual([
      `index.html: <script src="/js/consent.js"> с атрибутами «${attrs}» — нужны ровно src и defer`,
    ]);
  });

  it('<noscript> с пикселем → ошибка', () => {
    const pixel = '<noscript><div><img src="/pixel.gif" alt=""></div></noscript>';
    expect(mutate((html) => html.replace('</body>', `${pixel}</body>`))).toEqual([
      'index.html: <noscript> запрещён — Метрика без JS грузилась бы без согласия',
    ]);
  });

  it('нет файла js/consent.js → ошибка', () => {
    const dir = fixture('metrika');
    rmSync(join(dir, 'js', 'consent.js'));
    expect(check(dir, 'staging', 'on').errors).toEqual(['js/consent.js: нет файла скрипта согласия, а Метрика включена']);
  });

  it('JSON-LD рядом со скриптом согласия проходит', () => {
    const jsonLd = '<script type="application/ld+json">{"@type":"Organization"}</script>';
    expect(mutate((html) => html.replace(tag, `${tag}${jsonLd}`))).toEqual([]);
  });

  it('неизвестный режим или его нет → исключение', () => {
    const dir = fixture('metrika');
    expect(() => checkDistSeo({ distDir: dir, env: 'staging', metrika: 'maybe' })).toThrow(/режим Метрики «maybe»/);
    expect(() => checkDistSeo({ distDir: dir, env: 'staging' })).toThrow(/режим Метрики «undefined»/);
  });
});

describe('check-dist-seo: --metrika в командной строке (ep05)', () => {
  const cli = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const outFor = (dir: string) => {
    const out = join(dir, '..', `${dir.split(/[\\/]/).pop()}-draft-routes.json`);
    temps.push(out);
    return out;
  };

  it('без --metrika → код 2', () => {
    const dir = fixture('staging');
    const result = cli(['staging', '--dist', dir, '--out', outFor(dir)]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--metrika');
  });

  it('--metrika maybe → код 2', () => {
    const dir = fixture('staging');
    expect(cli(['staging', '--dist', dir, '--out', outFor(dir), '--metrika', 'maybe']).status).toBe(2);
  });

  it('--metrika on по чистой фикстуре → код 0', () => {
    const dir = fixture('metrika');
    const result = cli(['staging', '--dist', dir, '--out', outFor(dir), '--metrika', 'on']);
    expect([result.status, result.stderr]).toEqual([0, '']);
  });
});
