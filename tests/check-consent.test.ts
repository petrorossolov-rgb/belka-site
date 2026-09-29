import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChromeError, checkConsent, evaluateConsent, launchChrome, parseArgs, readCspMetrika } from '../scripts/check-consent.mjs';

// Гейт согласия (ep05 T09). Фикстура tests/fixtures/consent/ — разметка трёх страниц (плашка,
// «Настройки cookie», ссылки); скрипт в неё кладётся из настоящего src/client/consent.mjs. Мутанты —
// точечные правки копии скрипта или разметки, каждый роняет гейт сообщением своей проверки.
// Интеграционная часть запускает системный Chrome: без него тест падает, а не пропускается.
const FIXTURE = fileURLToPath(new URL('./fixtures/consent/', import.meta.url));
const CONSENT = readFileSync(fileURLToPath(new URL('../src/client/consent.mjs', import.meta.url)), 'utf8');
const SCRIPT = fileURLToPath(new URL('../scripts/check-consent.mjs', import.meta.url));
const CHROME_TIMEOUT = 120_000;

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Patch = [from: string, to: string];

/** Копия фикстуры с настоящим скриптом; правки скрипта и разметки главной должны найтись. */
function dist({ script = [], html = [] }: { script?: Patch[]; html?: Patch[] } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'consent-'));
  temps.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  const apply = (text: string, patches: Patch[]) =>
    patches.reduce((acc, [from, to]) => {
      if (!acc.includes(from)) throw new Error(`мутант не применился: ${from}`);
      return acc.replace(from, to);
    }, text);
  mkdirSync(join(dir, 'js'));
  writeFileSync(join(dir, 'js', 'consent.js'), apply(CONSENT, script));
  const index = join(dir, 'index.html');
  writeFileSync(index, apply(readFileSync(index, 'utf8'), html));
  return dir;
}

type Measure = Parameters<typeof evaluateConsent>[0];

/** Измерения исправного сайта; `over` подменяет группы целиком. */
function measure(over: Partial<Measure> = {}): Measure {
  return {
    pages: [{ route: '/', status: 200, yandex: [], cookies: [], bannerVisible: true }],
    deny: { yandex: [], cookies: [], visibleAfterReload: false },
    allow: { tags: ['https://mc.yandex.ru/metrika/tag.js'], init: [1, 'init', { webvisor: false, clickmap: false }] },
    revoke: { cookiesBefore: ['_ym_uid@.belkascm.test'], shownBySettings: true, cookiesAfter: [], keysAfter: [], tagsAfter: [] },
    keyboard: { activeOnLoad: 'body', activeAfterSettings: 'settings', names: ['Разрешить', 'Отказаться'], reached: ['allow', 'deny'] },
    mobile: { height: 200, viewportHeight: 800 },
    csp: [],
    external: [],
    ...over,
  };
}

describe('check-consent: evaluateConsent', () => {
  it('исправный сайт — без нарушений', () => {
    expect(evaluateConsent(measure())).toEqual([]);
  });

  it('6: ровно треть окна проходит, на 0,1 px больше — нет', () => {
    expect(evaluateConsent(measure({ mobile: { height: 800 / 3, viewportHeight: 800 } }))).toEqual([]);
    expect(evaluateConsent(measure({ mobile: { height: 800 / 3 + 0.1, viewportHeight: 800 } }))).toEqual([
      '6 на 360 × 800 плашка 266.8 px — выше трети окна (266.7 px)',
    ]);
  });

  it('3: tag.js ровно один; init с webvisor и clickmap строго false', () => {
    const tag = 'https://mc.yandex.ru/metrika/tag.js';
    expect(evaluateConsent(measure({ allow: { tags: [tag, tag], init: [1, 'init', { webvisor: false, clickmap: false }] } }))).toEqual([
      '3 «Разрешить»: tag.js загружен 2 раз, ожидался 1',
    ]);
    expect(evaluateConsent(measure({ allow: { tags: [tag], init: [1, 'init', { clickmap: false }] } }))).toEqual([
      '3 init: webvisor — undefined, нужен false',
    ]);
    expect(evaluateConsent(measure({ allow: { tags: [tag], init: undefined } }))).toEqual([
      "3 «Разрешить»: ym(…, 'init', …) не вызван",
    ]);
  });

  it('1: ответ не 200, запрос к Яндексу, cookie, скрытая плашка; пустая сборка', () => {
    expect(evaluateConsent(measure({ pages: [{ route: '/x/', status: 404, yandex: [], cookies: [], bannerVisible: true }] }))).toEqual([
      '1 /x/: ответ 404 вместо 200',
    ]);
    expect(evaluateConsent(measure({ pages: [{ route: '/', status: 200, yandex: ['https://mc.yandex.ru/metrika/tag.js'], cookies: ['_ym_uid@belkascm.test'], bannerVisible: false }] }))).toEqual([
      '1 /: до решения запросы к Яндексу — https://mc.yandex.ru/metrika/tag.js',
      '1 /: до решения cookie — _ym_uid@belkascm.test',
      '1 /: без решения плашка не показана',
    ]);
    expect(evaluateConsent(measure({ pages: [] }))).toEqual(['1: в сборке нет ни одной HTML-страницы']);
  });

  it('4: отзыв без cookie до него не считается проверенным', () => {
    expect(evaluateConsent(measure({ revoke: { cookiesBefore: [], shownBySettings: true, cookiesAfter: [], keysAfter: [], tagsAfter: [] } }))).toEqual([
      '4 отзыв не проверен: после «Разрешить» заглушка не поставила cookie',
    ]);
  });

  it('5: пустое имя, нет кнопки, недостижимость, перенос фокуса', () => {
    expect(
      evaluateConsent(measure({ keyboard: { activeOnLoad: 'плашка (aside)', activeAfterSettings: 'settings', names: ['', undefined], reached: ['allow'] } })),
    ).toEqual([
      '5 фокус перенесён при показе плашки: плашка (aside)',
      '5 кнопка allow: нет доступного имени',
      '5 кнопка deny: нет на плашке',
      '5 кнопка deny: недостижима с клавиатуры (Tab)',
    ]);
  });
});

describe('check-consent: аргументы и CSP', () => {
  it('--dist обязателен и единственен', () => {
    expect(parseArgs(['--dist', 'dist'])).toEqual({ distDir: 'dist' });
    expect(parseArgs([])).toBeUndefined();
    expect(parseArgs(['--dist'])).toBeUndefined();
    expect(parseArgs(['--dist', 'a', '--x', 'b'])).toBeUndefined();
  });

  it('CSP гейта — строка сниппета «Метрика»', () => {
    expect(readCspMetrika()).toContain("script-src 'self' https://mc.yandex.ru https://yastatic.net");
  });
});

const FOREIGN_FROM = '</main>';
const FOREIGN_TO = '<img src="https://example.com/pixel.png" alt=""></main>';
const WIDE_CSP = readCspMetrika().replace("img-src 'self' data:", "img-src 'self' data: https://example.com");

// Мутанты: [название, сборка, CSP (только проба «CSP шире»), ожидаемое сообщение (начало)].
const MUTANTS: [string, () => string, string | undefined, string][] = [
  ['tag.js грузится до решения', () => dist({ script: [['  const choice = read();\n', '  load();\n  const choice = read();\n']] }), undefined, '1 /: до решения запросы к Яндексу'],
  ['отказ не запоминается', () => dist({ script: [['    write(choice);\n', "    if (choice === 'allow') write(choice);\n"]] }), undefined, '2 отказ не сохранился'],
  ['«Разрешить» ничего не грузит', () => dist({ script: [["    if (choice === 'allow') load();\n", "    if (choice === 'allow') void 0;\n"]] }), undefined, '3 «Разрешить»: tag.js загружен 0 раз'],
  ['webvisor: true', () => dist({ script: [['webvisor: false', 'webvisor: true']] }), undefined, '3 init: webvisor — true'],
  ['отзыв оставляет _ym_uid', () => dist({ script: [["if (!name.startsWith('_ym')) continue;", "if (!name.startsWith('_ym') || name === '_ym_uid') continue;"]] }), undefined, '4 отзыв оставил cookie — _ym_uid@'],
  ['кнопка без доступного имени', () => dist({ html: [['data-consent-deny>Отказаться</button>', 'data-consent-deny></button>']] }), undefined, '5 кнопка deny: нет доступного имени'],
  ['плашка выше трети окна на 360', () => dist({ html: [['<h2 id="consent-title">', '<div style="height: 300px"></div><h2 id="consent-title">']] }), undefined, '6 на 360 × 800 плашка'],
  ['инлайн-скрипт (CSP)', () => dist({ html: [['</main>', "<script>document.title = 'x';</script></main>"]] }), undefined, 'CSP: '],
  ['запрос на чужой домен при CSP шире нужного', () => dist({ html: [[FOREIGN_FROM, FOREIGN_TO]] }), WIDE_CSP, 'запрос на чужой домен: https://example.com/pixel.png'],
  // Без расширенного CSP чужой домен режет CSP раньше сети — гейт падает сообщением CSP.
  ['чужой домен при строгом CSP «Метрика»', () => dist({ html: [[FOREIGN_FROM, FOREIGN_TO]] }), undefined, 'CSP: '],
];

describe('check-consent: фикстура и мутанты в Chrome', { timeout: CHROME_TIMEOUT }, () => {
  let clean: { errors: string[]; pages: number };
  let names: { errors: string[]; pages: number };
  const results = new Map<string, string[]>();

  beforeAll(async () => {
    // Один Chrome на все прогоны, прогоны — по одному: гейт и так открывает пять контекстов
    // параллельно, а соседние файлы с дочерними процессами (CLI, Stylelint) под нагрузкой упираются
    // в таймаут 5 с. Запуск Chrome гейтом проверяет CLI ниже.
    const browser = await launchChrome();
    const queue = MUTANTS.map(([name, build, csp]) => async () => {
      const result = await checkConsent(csp ? { distDir: build(), csp, browser } : { distDir: build(), browser });
      results.set(name, result.errors);
    });
    queue.unshift(
      async () => {
        clean = await checkConsent({ distDir: dist(), browser });
      },
      async () => {
        names = await checkConsent({
          browser,
          distDir: dist({
            html: [
              ['data-consent-allow>Разрешить</button>', 'data-consent-allow aria-label="Разрешить cookie"></button>'],
              ['data-consent-deny>Отказаться</button>', 'data-consent-deny>Отказаться: без cookie</button>'],
            ],
          }),
        });
      },
    );
    try {
      for (const job of queue) await job();
    } finally {
      await browser.close();
    }
  }, CHROME_TIMEOUT);

  it('положительная пара: чистая фикстура с настоящим consent.mjs проходит, проверены все HTML', () => {
    expect(clean.errors).toEqual([]);
    expect(clean.pages).toBe(3);
  });

  it('положительная пара имени: имя из aria-label и имя с двоеточием проходят (дерево доступности, не текст)', () => {
    expect(names.errors).toEqual([]);
  });

  for (const [name, , , message] of MUTANTS) {
    it(`мутант «${name}» → ${message}`, () => {
      const errors = results.get(name) ?? [];
      expect(errors.some((e) => e.startsWith(message)), errors.join('\n')).toBe(true);
    });
  }

  it('Chrome не найден → ChromeError (CLI отдаёт код 2)', async () => {
    await expect(checkConsent({ distDir: dist(), executablePath: join(tmpdir(), 'нет-такого-chrome.exe') })).rejects.toBeInstanceOf(ChromeError);
  });
});

describe('check-consent: CLI', { timeout: CHROME_TIMEOUT }, () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: CHROME_TIMEOUT });

  it('неверный вызов или нет каталога → код 2', () => {
    expect(run().status).toBe(2);
    expect(run('--dist', join(tmpdir(), 'нет-такой-сборки')).status).toBe(2);
  });

  it('чистая сборка → 0, мутант → 1 с номером проверки', () => {
    const ok = run('--dist', dist());
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('check-consent (страниц: 3): OK');
    const bad = run('--dist', dist({ script: [['webvisor: false', 'webvisor: true']] }));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('- 3 init: webvisor — true, нужен false');
  });
});
