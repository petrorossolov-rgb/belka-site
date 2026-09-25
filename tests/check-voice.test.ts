import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDist, checkHtml, checkTextFile, collectSegments } from '../scripts/check-voice.mjs';

// Пробы plan ep02 A4 и граничные случаи T02: у каждого правила — случай, который проходит, и
// случай, который гейт обязан уронить. Тест не читает dist/: только фикстуры tests/fixtures/voice/.
const FIXTURES = fileURLToPath(new URL('./fixtures/voice/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/check-voice.mjs', import.meta.url));

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'));
  temps.push(dir);
  return dir;
}

function fixtureDist(): string {
  const dir = tempDir();
  cpSync(join(FIXTURES, 'dist'), dir, { recursive: true });
  return dir;
}

const page = (body: string, head = '<title>Склад</title>') =>
  `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

/** Правила, которые сработали на теле страницы (по порядку). */
function rules(body: string, env = 'production', head?: string): string[] {
  return checkHtml(page(body, head), { env, route: '/' }).map((e) => /: (?:<[^>]+> )?(V\d+) /.exec(e)?.[1] ?? e);
}

describe('check-voice: фикстура сборки', () => {
  it('чистая страница с граничными допустимыми случаями → без нарушений', () => {
    const html = readFileSync(join(FIXTURES, 'dist/index.html'), 'utf8');
    expect(checkHtml(html, { env: 'production', route: '/' })).toEqual([]);
  });

  it('формат нарушения: маршрут, место, правило, цитата ±20 символов', () => {
    const errors = checkHtml(page('<p>Это длинная вводная фраза, после которой склад готов для Вас и всей смены целиком.</p>', '<title>Склад!</title>'), {
      env: 'production',
      route: '/products/wms/',
    });
    expect(errors).toEqual([
      '/products/wms/: V1 восклицательный знак — «Склад!»',
      '/products/wms/: V5 «вы» со строчной не в начале предложения — «рой склад готов для Вас и всей смены целико»',
    ]);
  });

  it('V9: черновая страница падает в production и проходит в staging', () => {
    const dir = fixtureDist();
    const production = checkDist({ distDir: dir, env: 'production' });
    expect(production.pages).toBe(3);
    expect(production.errors).toEqual([
      '/products/wms/: <meta description> V9 незаконченный текст в production — «Заглушка: описание появится »',
      '/products/wms/: V9 незаконченный текст в production — «Заглушка. Черновик страницы »',
    ]);
    expect(checkDist({ distDir: dir, env: 'staging' })).toEqual({ errors: [], pages: 3 });
  });

  it('пустая сборка → нарушение, а не молчаливый успех', () => {
    expect(checkDist({ distDir: tempDir(), env: 'production' }).errors).toEqual(['в сборке нет ни одной HTML-страницы']);
  });

  it('неизвестное окружение и отсутствующий каталог → исключение', () => {
    expect(() => checkDist({ distDir: fixtureDist(), env: 'development' })).toThrow(/окружение/);
    expect(() => checkDist({ distDir: join(tempDir(), 'nope'), env: 'production' })).toThrow(/нет каталога/);
  });
});

describe('check-voice: сбор текста', () => {
  it('строчные узлы склеиваются в блок, блочные разделяют, пробелы HTML схлопываются', () => {
    const segments = collectSegments(page('<p>Склад <a href="/">готов</a>\n   <strong>сейчас</strong></p><ul><li>Первый</li><li>Второй</li></ul>'));
    expect(segments.map((s) => s.text)).toEqual(['Склад', 'Склад готов сейчас', 'Первый', 'Второй']);
  });

  it('сущности декодируются как в браузере: &#8201; и &#x202F; — тонкие пробелы, &nbsp; — неразрывный', () => {
    const [, segment] = collectSegments(page('<p>1&#8201;284 и 1&#x202F;284 и 1&nbsp;284</p>'));
    expect(segment?.text).toBe('1\u2009284 и 1\u202F284 и 1\u00A0284');
  });

  it('script, style, code, pre, template, noscript и hidden не проверяются', () => {
    expect(rules('<script>"!"</script><style>a::after{content:"!"}</style><pre>!</pre><template><p>!</p></template><noscript>!</noscript><p hidden>!</p><p>Склад <code>!</code> готов.</p><div hidden><img alt="!"></div>')).toEqual([]);
  });

  it('проверяются alt, aria-label, title, description и текстовые og-свойства, служебные og — нет', () => {
    const head = [
      '<title>Склад!</title>',
      '<meta name="description" content="Склад!">',
      '<meta property="og:title" content="Склад!">',
      '<meta property="og:description" content="Склад!">',
      '<meta property="og:image:alt" content="Знак!">',
      '<meta property="og:url" content="https://belkascm.ru/!">',
      '<meta property="og:image" content="https://belkascm.ru/a!.png">',
      '<meta property="og:type" content="web!">',
      '<meta property="og:locale" content="ru_RU!">',
      '<meta name="twitter:card" content="summary!">',
    ].join('');
    const errors = checkHtml(page('<img src="/a.png" alt="Знак!"><a href="/" aria-label="Домой!" title="Главная!">x</a>', head), { env: 'production', route: '/' });
    expect(errors.map((e) => e.split(' V1 ')[0])).toEqual([
      '/:',
      '/: <meta description>',
      '/: <meta og:title>',
      '/: <meta og:description>',
      '/: <meta og:image:alt>',
      '/: <img alt>',
      '/: <a aria-label>',
      '/: <a title>',
    ]);
  });
});

describe('V1 — нет восклицаний', () => {
  it('! в тексте, alt и <title> падает', () => {
    expect(rules('<p>Склад готов!</p>')).toEqual(['V1']);
    expect(rules('<img src="/a.png" alt="Склад!">')).toEqual(['V1']);
    expect(rules('<p>Склад</p>', 'production', '<title>Склад!</title>')).toEqual(['V1']);
  });
  it('! внутри <code> проходит, внутри raw — падает (V1 не снимается)', () => {
    expect(rules('<p>Команда <code>git commit -m "!"</code> готова.</p>')).toEqual([]);
    expect(rules('<p data-voice="raw">Склад!</p>')).toEqual(['V1']);
  });
});

describe('V2 — «ёлочки»', () => {
  it('«…» и „…“ внутри «…» проходят', () => {
    expect(rules('<p>Склад «Север» и цитата «склад „Север“ открыт».</p>')).toEqual([]);
  });
  it('прямые и английские кавычки падают', () => {
    expect(rules('<p>Склад "Север"</p>')).toEqual(['V2', 'V2']);
    expect(rules('<p>Склад “Север”</p>')).toEqual(['V2', 'V2']);
  });
  it('“ без открывающей „ падает; „лапки“ без «ёлочек» падают', () => {
    expect(rules('<p>Склад Север“ открыт</p>')).toEqual(['V2']);
    expect(rules('<p>Склад „Север“ открыт</p>')).toEqual(['V2']);
  });
  it('raw не снимает V2', () => {
    expect(rules('<p data-voice="raw">"Север"</p>')).toEqual(['V2', 'V2']);
  });
});

describe('V3 — тире с пробелами', () => {
  it('диапазоны «–» без пробелов и «—» в начале блока проходят', () => {
    expect(rules('<p>Запас на 3–5 дней, отчёты за 2025–2026 годы, склад — двор.</p><p>— в начале блока</p>')).toEqual([]);
  });
  it('неразрывный пробел перед «—» проходит', () => {
    expect(rules('<p>Belka WMS&nbsp;— система управления складом</p>')).toEqual([]);
  });
  it('дефис и «–» в роли тире падают', () => {
    expect(rules('<p>склад - двор</p>')).toEqual(['V3']);
    expect(rules('<p>склад – двор</p>')).toEqual(['V3']);
    expect(rules('<p>- пункт как тире</p>')).toEqual(['V3']);
  });
  it('«—» без пробела перед или после падает', () => {
    expect(rules('<p>склад—двор</p>')).toEqual(['V3', 'V3']);
    expect(rules('<p>склад —двор</p>')).toEqual(['V3']);
    expect(rules('<p>склад— двор</p>')).toEqual(['V3']);
  });
  it('дефис в слове проходит', () => {
    expect(rules('<p>кто-то, из-за, e-mail</p>')).toEqual([]);
  });
  it('raw снимает V3 только в своём поддереве', () => {
    expect(rules('<p data-voice="raw">склад - двор</p><p>склад - двор</p>')).toEqual(['V3']);
  });
});

describe('V4 — разряды тонким пробелом', () => {
  it('1 284 с U+2009 и U+202F проходит, 2026 и 999 проходят', () => {
    expect(rules('<p>1&#8201;284 и 1&#x202F;284, 12&#8201;500, 1&#8201;000&#8201;000, 2026 год, 999 зон</p>')).toEqual([]);
  });
  it('группировка обычным и неразрывным пробелом падает', () => {
    expect(rules('<p>1 284 ячейки</p>')).toEqual(['V4']);
    expect(rules('<p>1&nbsp;284 ячейки</p>')).toEqual(['V4']);
  });
  it('число от пяти цифр без разрядов падает', () => {
    expect(rules('<p>12500 заказов</p>')).toEqual(['V4']);
  });
  it('12500 в raw проходит, в соседнем <p> падает', () => {
    expect(rules('<p data-voice="raw">12500</p><p>12500</p>')).toEqual(['V4']);
  });
  it('вложенный raw внутри raw работает, raw внутри обычного блока — только на себя', () => {
    expect(rules('<div data-voice="raw"><p><span data-voice="raw">12500</span> и 98765</p></div>')).toEqual([]);
    expect(rules('<p><span data-voice="raw">12500</span> и 98765</p>')).toEqual(['V4']);
  });
  it('коды с буквами и десятичные дроби не числа-разряды', () => {
    expect(rules('<p>SKU12500, коэффициент 0,12500</p>')).toEqual([]);
  });
});

describe('V5 — «вы» со строчной', () => {
  it('«Вы» в начале абзаца, пункта, после «. », «? », «… », «« » проходит', () => {
    expect(rules('<p>Вы получаете отчёт.</p><ul><li>Вы задаёте зоны</li></ul>')).toEqual([]);
    expect(rules('<p>Склад готов. Вы получаете отчёт. Готово? Вам не нужно ждать… Вас ждёт отчёт.</p>')).toEqual([]);
    expect(rules('<p>Он сказал: «Вы выбираете зону».</p>')).toEqual([]);
    expect(rules('<p>Готово.&nbsp;Вы видите отчёт. «Да?» Вы выбираете.</p>')).toEqual([]);
  });
  it('начало предложения видно сквозь разметку', () => {
    expect(rules('<p><strong>Вы</strong> получаете</p><p><a href="/">Ваши</a> данные</p>')).toEqual([]);
  });
  it('«Вы» в середине предложения падает, в том числе внутри <a>', () => {
    expect(rules('<p>Склад готов для Вас</p>')).toEqual(['V5']);
    expect(rules('<p>Мы <a href="/">покажем Вам</a> склад</p>')).toEqual(['V5']);
    expect(rules('<p>Склад: Ваши данные</p>')).toEqual(['V5']);
  });
  it('все формы: Вами, Вашего, Вашу', () => {
    expect(rules('<p>склад с Вами, для Вашего склада, про Вашу зону</p>')).toEqual(['V5', 'V5', 'V5']);
  });
  it('«вы» со строчной и слова на «Вы…» проходят', () => {
    expect(rules('<p>Склад для вас. Выход и Выборка — операции.</p>')).toEqual([]);
  });
  it('raw не снимает V5', () => {
    expect(rules('<p data-voice="raw">склад для Вас</p>')).toEqual(['V5']);
  });
});

describe('V6 — стоп-фразы', () => {
  it.each([
    'Решение под ключ',
    'Решение Под ключ',
    'Решение ПОД КЛЮЧ',
    'Решение под&nbsp;ключ',
    'Отчёт в один клик',
    'Легко и просто',
    'Кликните здесь',
    'Уникальный склад',
    'Революционная система',
    'Лучший на рынке',
    'Инновационные решения',
    'Продукт № 1',
    'Продукт №1',
    'Лидер рынка',
    'Стать лидером рынка',
    'Лапки белки',
  ])('«%s» падает', (text) => {
    expect(rules(`<p>${text}</p>`)).toEqual(['V6']);
  });
  it('стоп-фраза внутри слова не срабатывает', () => {
    expect(rules('<p>Подключение склада, неуникальность, документ № 12, приложение 1.</p>')).toEqual([]);
  });
});

describe('V7 — «Белка» в составе имени', () => {
  it('«Белка УЦП», «Белки УЦП», «белка» и «Белка» как слово проходят', () => {
    expect(rules('<p>Белка УЦП. У Белки УЦП. Белка прыгает, белка — образ. Belka SCM и Belka WMS.</p>')).toEqual([]);
  });
  it.each([
    'Белка SCM',
    'Белка WMS',
    'Белка&nbsp;SCM',
    'у Белки SCM',
    'с Белкой WMS',
    'к Белке PackApp',
    'про Белку TMS',
    'белка SCM',
    'Белка-WMS',
    'Белка ЦУП',
  ])('«%s» падает', (text) => {
    expect(rules(`<p>${text}</p>`)).toEqual(['V7']);
  });
  it('raw не снимает V7', () => {
    expect(rules('<p data-voice="raw">Белка SCM</p>')).toEqual(['V7']);
  });
});

describe('V8 — без эмодзи', () => {
  it('эмодзи падает, ©, ®, ™ и № проходят', () => {
    expect(rules('<p>Склад 📦</p>')).toEqual(['V8']);
    expect(rules('<p>© 2026 Belka SCM®, Belka™, № 12</p>')).toEqual([]);
  });
});

describe('V9 — нет незаконченного', () => {
  it('падает в production и проходит в staging', () => {
    for (const text of ['Заглушка ep02', 'заглушки', 'TODO: текст', 'FIXME', 'Lorem ipsum']) {
      expect(rules(`<p>${text}</p>`, 'production')).toEqual(['V9']);
      expect(rules(`<p>${text}</p>`, 'staging')).toEqual([]);
    }
  });
  it('на staging остальные правила действуют', () => {
    expect(rules('<p>Заглушка!</p>', 'staging')).toEqual(['V1']);
  });
});

describe('V10 — многоточие', () => {
  it('«...» падает, «…» проходит, в raw «...» проходит', () => {
    expect(rules('<p>Склад...</p>')).toEqual(['V10']);
    expect(rules('<p>Склад…</p>')).toEqual([]);
    expect(rules('<p data-voice="raw">Склад...</p>')).toEqual([]);
  });
});

describe('--text: пакет черновиков', () => {
  it('проверяются только блоки ```text, номер строки — строка файла, V9 действует', () => {
    const file = join(FIXTURES, 'packet.md');
    const errors = checkTextFile(readFileSync(file, 'utf8'), 'packet.md');
    expect(errors).toEqual([
      'packet.md:10: V4 разряды обычным или неразрывным пробелом — нужен тонкий (U+2009 или U+202F) — «олучаете остатки по 1 284 ячейкам.»',
      'packet.md:17: V5 «вы» со строчной не в начале предложения — «Склад для Вас!»',
      'packet.md:17: V1 восклицательный знак — «Склад для Вас!»',
      'packet.md:28: V9 незаконченный текст в production — «Заглушка ep02»',
    ]);
  });
  it('незакрытый блок — нарушение', () => {
    expect(checkTextFile('# Пакет\n\n```text\nСклад готов.\n', 'p.md')).toEqual(['p.md:3: блок ```text не закрыт']);
  });
  it('CRLF не ломает номера строк', () => {
    expect(checkTextFile('# Пакет\r\n```text\r\nСклад!\r\n```\r\n', 'p.md')).toEqual(['p.md:3: V1 восклицательный знак — «Склад!»']);
  });
});

describe('check-voice: CLI', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('чистая сборка → код 0', () => {
    const dir = fixtureDist();
    rmSync(join(dir, 'products'), { recursive: true });
    const result = run('--dist', dir, '--env', 'production');
    expect(result.stdout).toContain('check-voice production (страниц: 2): OK');
    expect(result.status).toBe(0);
  });

  it('нарушения → код 1; то же на staging без V9 → код 0; порядок флагов не важен', () => {
    const dir = fixtureDist();
    const production = run('--dist', dir, '--env', 'production');
    expect(production.status).toBe(1);
    expect(production.stderr).toContain('/products/wms/: V9');
    expect(run('--env', 'staging', '--dist', dir).status).toBe(0);
  });

  it('--text: нарушения → 1, чистый пакет → 0', () => {
    expect(run('--text', join(FIXTURES, 'packet.md')).status).toBe(1);
    const dir = tempDir();
    const clean = join(dir, 'clean.md');
    writeFileSync(clean, '# Пакет\n\n```text\nСклад готов. Вы получаете отчёт.\n```\n');
    expect(run('--text', clean).status).toBe(0);
  });

  it('неверный вызов → код 2', () => {
    const dir = fixtureDist();
    expect(run().status).toBe(2);
    expect(run('--dist', dir).status).toBe(2);
    expect(run('--dist', dir, '--env', 'development').status).toBe(2);
    expect(run('--dist', join(dir, 'nope'), '--env', 'production').status).toBe(2);
    expect(run('--dist', dir, '--env', 'production', '--extra', 'x').status).toBe(2);
    expect(run('--text').status).toBe(2);
    expect(run('--text', join(dir, 'nope.md')).status).toBe(2);
  });

  it('пустая сборка → код 1', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'assets'));
    expect(run('--dist', dir, '--env', 'production').status).toBe(1);
  });
});
