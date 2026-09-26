import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChromeError, checkLayout, findOverflow, parseArgs } from '../scripts/check-layout.mjs';
import { startStaticServer } from '../scripts/lib/static-server.mjs';

// Пробы plan ep02 A6 и граничные случаи T03. Интеграционная часть запускает системный Chrome:
// без него тест падает, а не пропускается (Constitution 8). Тест не читает dist/, только
// фикстуры tests/fixtures/layout/.
const FIXTURES = fileURLToPath(new URL('./fixtures/layout/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/check-layout.mjs', import.meta.url));
const CHROME_TIMEOUT = 120_000;

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'layout-'));
  temps.push(dir);
  return dir;
}

type Rect = Parameters<typeof findOverflow>[0]['rects'][number];

/** Видимый блочный элемент 100×20 у левого края, содержимое по размеру бокса. */
function rect(over: Partial<Rect> = {}): Rect {
  return {
    selector: 'div',
    parent: -1,
    left: 0,
    right: 100,
    width: 100,
    height: 20,
    hidden: false,
    scrollWidth: 100,
    clientWidth: 100,
    overflowX: 'visible',
    clipped: false,
    ...over,
  };
}

const check = (rects: Rect[], viewport = 360, scrollWidth = viewport) => findOverflow({ viewport, scrollWidth, rects });

describe('check-layout: findOverflow', () => {
  it('ровно по краю проходит, на 1 px больше — падает', () => {
    expect(check([rect({ right: 360, width: 360, scrollWidth: 360, clientWidth: 360 })])).toEqual([]);
    expect(check([rect({ selector: 'div.block', right: 361, width: 361, scrollWidth: 361, clientWidth: 361 })])).toEqual([
      { selector: 'div.block', reason: 'правая граница 361px за окном 360px' },
    ]);
  });

  it('документ шире окна — нарушение, даже если элементы не пойманы', () => {
    expect(check([], 360, 360)).toEqual([]);
    expect(check([], 360, 361)).toEqual([{ selector: 'html', reason: 'страница шире окна: scrollWidth 361px > 360px' }]);
  });

  it('дробные доли пикселя от раскладки не считаются переполнением', () => {
    expect(check([rect({ right: 360.4 })])).toEqual([]);
    expect(check([rect({ right: 360.6 })])).toHaveLength(1);
  });

  it('потомок контейнера overflow-x: auto, который умещается в окно, проходит', () => {
    const rects = [
      rect({ selector: 'div.scroll', right: 360, width: 360, scrollWidth: 800, clientWidth: 360, overflowX: 'auto' }),
      rect({ selector: 'table', parent: 0, right: 800, width: 800, scrollWidth: 800, clientWidth: 800 }),
      rect({ selector: 'td', parent: 1, right: 800, width: 400, scrollWidth: 400, clientWidth: 400 }),
    ];
    expect(check(rects)).toEqual([]);
    expect(check([{ ...rects[0]!, overflowX: 'scroll' }, rects[1]!, rects[2]!])).toEqual([]);
  });

  it('сам контейнер прокрутки шире окна — падает, и его потомки не освобождены', () => {
    const rects = [
      rect({ selector: 'div.scroll', right: 400, width: 400, scrollWidth: 800, clientWidth: 400, overflowX: 'auto' }),
      rect({ selector: 'table', parent: 0, right: 800, width: 800, scrollWidth: 800, clientWidth: 800 }),
    ];
    expect(check(rects).map((o) => o.selector)).toEqual(['div.scroll', 'table']);
  });

  it('обрезка внутри контейнера прокрутки — нарушение: освобождена только правая граница', () => {
    const rects = [
      rect({ selector: 'div.scroll', right: 360, width: 360, scrollWidth: 800, clientWidth: 360, overflowX: 'auto' }),
      rect({ selector: 'div.clip', parent: 0, right: 800, width: 800, scrollWidth: 900, clientWidth: 800, overflowX: 'hidden', clipped: true }),
    ];
    expect(check(rects)).toEqual([
      { selector: 'div.clip', reason: 'содержимое шире бокса, обрезано (overflow-x: hidden): scrollWidth 900px > clientWidth 800px' },
    ]);
  });

  it('потомок overflow-x: hidden|clip за его границей — падает (контейнер не исключение)', () => {
    for (const overflowX of ['hidden', 'clip']) {
      const rects = [
        rect({ selector: 'div.wrapper', right: 360, width: 360, scrollWidth: 361, clientWidth: 360, overflowX, clipped: true }),
        rect({ selector: 'div.block', parent: 0, right: 361, width: 361, scrollWidth: 361, clientWidth: 361 }),
      ];
      expect(check(rects).map((o) => o.selector)).toEqual(['div.wrapper', 'div.block']);
    }
  });

  it('обрезка внутри окна тоже нарушение: карточка overflow: hidden с содержимым шире себя', () => {
    const rects = [rect({ selector: 'div.card', right: 200, width: 150, scrollWidth: 300, clientWidth: 150, overflowX: 'hidden', clipped: true })];
    expect(check(rects)).toEqual([
      { selector: 'div.card', reason: 'содержимое шире бокса, обрезано (overflow-x: hidden): scrollWidth 300px > clientWidth 150px' },
    ]);
  });

  it('длинное слово вылезает из карточки внутри окна — падает', () => {
    const rects = [rect({ selector: 'div.card > p', right: 150, width: 150, scrollWidth: 330, clientWidth: 150 })];
    expect(check(rects)).toEqual([
      { selector: 'div.card > p', reason: 'содержимое шире бокса, вылезает: scrollWidth 330px > clientWidth 150px' },
    ]);
  });

  it('невидимые элементы не проверяются: display: none, visibility: hidden, нулевой размер', () => {
    const wide = { right: 900, width: 900, scrollWidth: 1000, clientWidth: 900 };
    expect(check([rect({ ...wide, hidden: true })])).toEqual([]);
    expect(check([rect({ ...wide, width: 0 })])).toEqual([]);
    expect(check([rect({ ...wide, height: 0 })])).toEqual([]);
  });

  it('visually-hidden ≤ 1×1 с обрезкой и его потомки не проверяются; 2×2 с обрезанным текстом — падает', () => {
    const srOnly = rect({ selector: 'span.sr-only', right: 1, width: 1, height: 1, scrollWidth: 300, clientWidth: 1, overflowX: 'hidden', clipped: true });
    const child = rect({ selector: 'span.sr-only > b', parent: 0, right: 400, width: 400, scrollWidth: 0, clientWidth: 0 });
    expect(check([srOnly, child])).toEqual([]);
    expect(check([{ ...srOnly, width: 2, height: 2, right: 2, clientWidth: 2 }])).toEqual([
      { selector: 'span.sr-only', reason: 'содержимое шире бокса, обрезано (overflow-x: hidden): scrollWidth 300px > clientWidth 2px' },
    ]);
    // 1×1 без обрезки — не visually-hidden: содержимое вылезает видимым.
    expect(check([{ ...srOnly, overflowX: 'visible', clipped: false }])).toHaveLength(1);
  });

  it('левая граница за краем окна падает: дробная доля пикселя — нет, 1 px — да', () => {
    expect(check([rect({ left: -0.4 })])).toEqual([]);
    expect(check([rect({ selector: 'div.block', left: -0.6 })])).toEqual([
      { selector: 'div.block', reason: 'левая граница -0.6px за левым краем окна' },
    ]);
  });

  it('левая граница: контейнер прокрутки не освобождает — влево от начала он не прокручивается', () => {
    const scroller = rect({ selector: 'div.scroll', right: 360, width: 360, scrollWidth: 800, clientWidth: 360, overflowX: 'auto' });
    const child = rect({ selector: 'div.item', parent: 0, left: -200, right: 100, width: 300 });
    expect(check([scroller, child]).map((o) => o.selector)).toEqual(['div.item']);
    expect(check([{ ...scroller, left: -1 }, child]).map((o) => o.selector)).toEqual(['div.scroll', 'div.item']);
    // Потомок правее окна в умещающемся контейнере по-прежнему освобождён.
    expect(check([scroller, rect({ selector: 'div.item', parent: 0, left: 300, right: 800, width: 500 })])).toEqual([]);
  });

  it('visually-hidden за левым краем не проверяется', () => {
    const srOnly = rect({ selector: 'span.sr-only', left: -9999, right: -9998, width: 1, height: 1, scrollWidth: 1, clientWidth: 1, overflowX: 'hidden', clipped: true });
    expect(check([srOnly])).toEqual([]);
  });

  it('строчные элементы (scrollWidth и clientWidth = 0): проверяется правая граница', () => {
    expect(check([rect({ scrollWidth: 0, clientWidth: 0, right: 200 })])).toEqual([]);
    expect(check([rect({ scrollWidth: 0, clientWidth: 0, right: 400 })])).toHaveLength(1);
  });
});

describe('check-layout: аргументы', () => {
  it('--dist обязателен, --widths — целые через запятую', () => {
    expect(parseArgs(['--dist', 'dist'])).toEqual({ distDir: 'dist', widths: [360, 768, 1440] });
    expect(parseArgs(['--widths', '360,1440', '--dist', 'd'])).toEqual({ distDir: 'd', widths: [360, 1440] });
    for (const argv of [[], ['--dist'], ['--widths', '360'], ['--dist', 'd', '--widths', '360,'], ['--dist', 'd', '--widths', '0'], ['--dist', 'd', '--widths', '36.5'], ['--dist', 'd', '--dist', 'e'], ['--env', 'production']]) {
      expect(parseArgs(argv), argv.join(' ')).toBeUndefined();
    }
  });
});

describe('check-layout: статический сервер', () => {
  /** Сырой запрос: http.request не нормализует `..` в пути. */
  function get(origin: string, path: string): Promise<{ status: number; type: string; body: string }> {
    return new Promise((done, fail) => {
      const req = request(`${origin}/`, { path }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => done({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body }));
      });
      req.on('error', fail);
      req.end();
    });
  }

  it('127.0.0.1, /путь/ → index.html, неизвестное → 404.html с кодом 404, файлы вне корня → 404', async () => {
    const dir = tempDir();
    const root = join(dir, 'dist');
    mkdirSync(join(root, 'wms'), { recursive: true });
    writeFileSync(join(root, 'wms/index.html'), '<p>wms</p>');
    writeFileSync(join(root, '404.html'), '<p>404</p>');
    writeFileSync(join(root, 'a.css'), 'p{}');
    writeFileSync(join(root, 'f.woff2'), 'x');
    writeFileSync(join(dir, 'secret.txt'), 'secret');
    const server = await startStaticServer(root);
    try {
      expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await get(server.origin, '/wms/')).toEqual({ status: 200, type: 'text/html; charset=utf-8', body: '<p>wms</p>' });
      expect((await get(server.origin, '/wms')).status).toBe(200);
      expect((await get(server.origin, '/a.css')).type).toBe('text/css; charset=utf-8');
      expect((await get(server.origin, '/f.woff2')).type).toBe('font/woff2');
      expect(await get(server.origin, '/nope/')).toEqual({ status: 404, type: 'text/html; charset=utf-8', body: '<p>404</p>' });
      for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%5csecret.txt', '/wms/../../secret.txt', '/%E0%A4%A']) {
        const res = await get(server.origin, path);
        expect([path, res.status, res.body]).toEqual([path, 404, '<p>404</p>']);
      }
    } finally {
      await server.close();
    }
  });

  it('/../package.json от корня фикстуры → 404', async () => {
    const server = await startStaticServer(FIXTURES);
    try {
      for (const path of ['/../package.json', '/../../../package.json']) expect((await get(server.origin, path)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

describe('check-layout: фикстуры в Chrome', () => {
  let result: { errors: string[]; pages: number };

  beforeAll(async () => {
    result = await checkLayout({ distDir: FIXTURES, widths: [360] });
  }, CHROME_TIMEOUT);

  const failing = () => [...new Set(result.errors.map((e) => e.split(' ')[0]))];

  it('проверены все HTML, включая /404.html', () => {
    expect(result.pages).toBe(10);
  });

  it('падают ровно пробы: 361px, 361px под html/body и обёрткой overflow-x: hidden, длинное слово, absolute за краем, 1px за левым краем', () => {
    expect(failing()).toEqual(['/absolute/', '/body-hidden/', '/left-hidden/', '/long-word-hidden/', '/long-word/', '/wide/', '/wrapper-hidden/']);
  });

  it('проходят: ровно 360px, visually-hidden, скрытые (в том числе visibility: hidden с обрезанным словом), таблица 800px в overflow-x: auto, 404', () => {
    for (const route of ['/', '/table-scroll/', '/404.html']) expect(failing()).not.toContain(route);
  });

  it('вывод: маршрут, ширина, селектор, правая граница', () => {
    expect(result.errors).toContain('/wide/ @360: div.block — правая граница 361px за окном 360px');
    expect(result.errors).toContain('/body-hidden/ @360: div.block — правая граница 361px за окном 360px');
    expect(result.errors).toContain('/wrapper-hidden/ @360: div.wrapper > div.block — правая граница 361px за окном 360px');
    expect(result.errors).toContain('/left-hidden/ @360: div.wrapper > div.block — левая граница -1px за левым краем окна');
    expect(result.errors.some((e) => e.startsWith('/long-word/ @360: div.card > p — содержимое шире бокса, вылезает'))).toBe(true);
    expect(result.errors.some((e) => e.startsWith('/long-word-hidden/ @360: div.card > p — содержимое шире бокса'))).toBe(true);
    expect(result.errors).toContain('/absolute/ @360: div.badge — правая граница 380px за окном 360px');
  });

  it('Chrome не найден → ChromeError (CLI отдаёт код 2)', async () => {
    const dir = tempDir();
    await expect(checkLayout({ distDir: FIXTURES, widths: [360], executablePath: join(dir, 'no-chrome.exe') })).rejects.toBeInstanceOf(ChromeError);
  });
});

describe('check-layout: CLI', { timeout: CHROME_TIMEOUT }, () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: CHROME_TIMEOUT });

  function passingDist(): string {
    const dir = tempDir();
    for (const file of ['index.html', '404.html', 'table-scroll']) cpSync(join(FIXTURES, file), join(dir, file), { recursive: true });
    return dir;
  }

  it('чистая сборка → код 0 на трёх ширинах', () => {
    const result = run('--dist', passingDist());
    expect(result.stdout).toContain('check-layout 360/768/1440 (страниц: 3): OK');
    expect(result.status).toBe(0);
  });

  it('переполнение → код 1 с маршрутом и шириной', () => {
    const dir = passingDist();
    cpSync(join(FIXTURES, 'wide'), join(dir, 'wide'), { recursive: true });
    const result = run('--widths', '360', '--dist', dir);
    expect(result.stderr).toContain('check-layout 360 (страниц: 4): нарушений — 2');
    expect(result.stderr).toContain('/wide/ @360: html — страница шире окна: scrollWidth 361px > 360px');
    expect(result.stderr).toContain('/wide/ @360: div.block — правая граница 361px за окном 360px');
    expect(result.status).toBe(1);
  });

  it('страница, которую сервер не отдал (ответ не 200), — нарушение, а не молчаливый замер 404', () => {
    const dir = passingDist();
    cpSync(join(FIXTURES, 'wide'), join(dir, '100%'), { recursive: true });
    const result = run('--widths', '360', '--dist', dir);
    expect(result.stderr).toContain('/100%/ @360: ответ 404 вместо 200');
    expect(result.status).toBe(1);
  });

  it('пустая сборка → код 1: гейт с пустым входом не проходит молча', () => {
    const result = run('--dist', tempDir());
    expect(result.stderr).toContain('в сборке нет ни одной HTML-страницы');
    expect(result.status).toBe(1);
  });

  it('неверный вызов или нет каталога → код 2', () => {
    for (const args of [[], ['--dist'], ['--dist', 'd', '--widths', 'x'], ['--env', 'production']]) {
      expect(run(...args).status, args.join(' ')).toBe(2);
    }
    const missing = run('--dist', join(tempDir(), 'nope'));
    expect(missing.stderr).toContain('нет каталога сборки');
    expect(missing.status).toBe(2);
  });
});
