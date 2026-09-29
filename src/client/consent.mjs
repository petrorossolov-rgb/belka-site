// @ts-check
// Согласие на cookie и Метрику (ep05 T08). Выходит в сборку как /js/consent.js только при
// site.flags.metrikaEnabled (src/pages/js/[file].js.ts) и подключается классическим
// <script src defer> — поэтому IIFE без import/export. Счётчик, версия текста и адрес tag.js —
// из data-* плашки. До решения ничего не грузится; фокус не переносится.
(() => {
  const KEY = 'belka-consent';
  const banner = document.querySelector('[data-consent]');
  if (!(banner instanceof HTMLElement)) return;
  const { counter, version, tag } = banner.dataset;
  const w = /** @type {any} */ (window);

  /** @returns {'allow' | 'deny' | undefined} */
  const read = () => {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) ?? '');
      return d?.v === Number(version) && (d.choice === 'allow' || d.choice === 'deny') ? d.choice : undefined;
    } catch {
      return undefined;
    }
  };

  const write = (/** @type {'allow' | 'deny'} */ choice) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: Number(version), choice }));
    } catch {
      // Хранилище недоступно — решение живёт до перезагрузки.
    }
  };

  const load = () => {
    if (w.ym || !tag) return;
    w.ym = (/** @type {unknown[]} */ ...args) => (w.ym.a = w.ym.a || []).push(args);
    w.ym.l = Date.now();
    const script = document.createElement('script');
    script.async = true;
    script.src = tag;
    document.head.append(script);
    w.ym(Number(counter), 'init', { webvisor: false, clickmap: false, trackLinks: true, accurateTrackBounce: true });
  };

  // Отзыв: cookie _ym* — без домена и на каждый домен-предок (Метрика ставит их на домен сайта),
  // ключи _ym* в localStorage.
  const wipe = () => {
    const parts = location.hostname.split('.');
    for (const pair of document.cookie.split(';')) {
      const name = pair.split('=')[0]?.trim() ?? '';
      if (!name.startsWith('_ym')) continue;
      const expired = `${name}=; path=/; max-age=0`;
      document.cookie = expired;
      for (let i = 0; i < parts.length - 1; i++) document.cookie = `${expired}; domain=.${parts.slice(i).join('.')}`;
    }
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('_ym')) localStorage.removeItem(key);
    } catch {
      // Хранилище недоступно — ключей Метрики в нём тоже нет.
    }
  };

  const choose = (/** @type {'allow' | 'deny'} */ choice) => {
    const before = read();
    write(choice);
    banner.hidden = true;
    if (choice === 'allow') load();
    else if (before === 'allow' || w.ym) {
      wipe();
      location.reload();
    }
  };

  banner.querySelector('[data-consent-allow]')?.addEventListener('click', () => choose('allow'));
  banner.querySelector('[data-consent-deny]')?.addEventListener('click', () => choose('deny'));
  for (const button of document.querySelectorAll('[data-consent-settings]')) {
    button.addEventListener('click', () => {
      banner.hidden = false;
    });
  }

  const choice = read();
  if (choice === undefined) banner.hidden = false;
  else if (choice === 'allow') load();
})();
