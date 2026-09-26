// Валидные сырые данные записей (как во frontmatter / YAML) — база для негативных тестов схем.

export const validPlatformProduct = {
  name: 'Belka WMS',
  short: 'WMS',
  domain: 'warehouse',
  kind: 'platform',
  summary: 'Заглушка теста.',
  mapOrder: 1,
  hasPage: true,
  readiness: 'in-development',
  draft: true,
};

export const validStandaloneProduct = {
  name: 'Belka PackApp',
  short: 'PackApp',
  domain: 'packing',
  kind: 'standalone',
  summary: 'Заглушка теста.',
  readiness: 'available',
};

export const validCase = {
  product: 'packapp',
  title: 'Упаковка на складе оператора',
  clientLabel: 'крупный фулфилмент-оператор',
};

export const validPage = {
  title: 'Контакты',
  description: 'Как связаться с командой Belka SCM: почта и мессенджер для вопросов о платформе.',
  nav: { label: 'Контакты', order: 10, placement: 'header' },
  ogImage: './og-contacts.png',
  ogImageAlt: 'Карточка страницы контактов',
  hero: { eyebrow: 'Надзаголовок', lead: 'Подзаголовок' },
};

export const validSite = {
  name: 'Belka SCM',
  slogan: 'Знает, где что лежит.',
  url: 'https://belkascm.ru',
  contacts: {},
  legal: {},
  flags: { legalEntityReady: false, metrikaEnabled: false, showReadiness: false },
  metrika: {},
  seo: {},
};

/** Полный набор: юрлицо заведено, Метрика включена. Данные вымышленные, только для тестов. */
export const validSiteWithMetrika = {
  ...validSite,
  contacts: { email: 'hello@example.ru', phone: '+79990000000', telegram: 'https://t.me/example' },
  legal: { entityName: 'ООО «Пример»', inn: '7700000000', ogrn: '1027700000000' },
  flags: { legalEntityReady: true, metrikaEnabled: true, showReadiness: false },
  metrika: { counterId: '12345678' },
  seo: { defaultOgImage: './og-default.png', defaultOgImageAlt: 'Карточка сайта' },
};

/** Секция со всеми полями; `link.page` — id страницы (в тестах `reference()` — строка). */
export const validCardsBlock = {
  view: 'cards',
  eyebrow: 'Надзаголовок',
  title: 'Заголовок секции',
  lead: 'Лид секции.',
  items: [
    { title: 'Первый пункт', text: 'Текст первого пункта.' },
    { title: 'Второй пункт', text: 'Текст второго пункта.' },
  ],
  link: { page: 'approach', label: 'Подробнее' },
};

/** Секция поверхностей: у пункта текст, мокап и продукт (в тестах `reference()` — строка). */
export const validSurfacesBlock = {
  view: 'surfaces',
  title: 'Поверхности',
  items: [{ title: 'Веб-консоль', text: 'Текст пункта.', mockup: 'wms-console', product: 'wms' }],
};

/** Минимально полный мокап каждого вида; значения — нейтральные демо-данные. */
export const validMockups = {
  console: {
    kind: 'console',
    caption: 'Подпись фигуры.',
    app: 'Консоль',
    screen: 'Монитор',
    nav: ['Раздел 1', 'Раздел 2', 'Раздел 3', 'Раздел 4'],
    kpis: [
      { label: 'Показатель 1', value: 1284, unit: 'шт.' },
      { label: 'Показатель 2', value: 82 },
    ],
    zones: [
      { label: 'Зона 1', load: 0 },
      { label: 'Зона 2', load: 50 },
      { label: 'Зона 3', load: 100 },
    ],
    waves: [
      { code: 'W-0001', status: { label: 'Статус', tone: 'ok' }, progress: 40 },
      { code: 'W-0002', status: { label: 'Статус', tone: 'warn' }, progress: 10 },
    ],
    exceptions: [{ text: 'Исключение 1', tone: 'risk' }],
  },
  terminal: {
    kind: 'terminal',
    caption: 'Подпись фигуры.',
    app: 'ТСД',
    screen: 'Отбор',
    step: { code: '04', label: 'Шаг' },
    cell: 'A-04-12-3',
    item: { label: 'Товар 1', code: '4600000000001' },
    take: { label: 'Взять', qty: 6, unit: 'шт.' },
    progress: { done: 3, total: 8 },
    scan: 'Скан',
    actions: ['Действие'],
  },
  pack: {
    kind: 'pack',
    caption: 'Подпись фигуры.',
    app: 'Стол',
    screen: 'Упаковка',
    order: { label: 'Заказ', code: 'O-0001' },
    scan: { label: 'Скан', last: '4600000000001' },
    place: { label: 'Место', code: 'P-0001', weight: 24.5, unit: 'кг' },
    lines: [
      { label: 'Товар 1', code: 'SKU-0001', qty: 2, packed: 2 },
      { label: 'Товар 2', code: 'SKU-0002', qty: 1, packed: 0 },
      { label: 'Товар 3', code: 'SKU-0003', qty: 4, packed: 1 },
    ],
    devices: [{ label: 'Весы', tone: 'ok' }],
  },
  dashboard: {
    kind: 'dashboard',
    caption: 'Подпись фигуры.',
    app: 'Аналитика',
    screen: 'Операции',
    period: 'Смена 1',
    kpis: [
      { label: 'Показатель 1', value: 12500, trend: [1, 2, 3, 4, 5, 6] },
      { label: 'Показатель 2', value: 98.5, unit: '%', trend: [6, 5, 4, 3, 2, 1] },
    ],
    hourly: {
      label: 'По часам',
      points: [
        { hour: '08', value: 10 },
        { hour: '09', value: 20 },
        { hour: '10', value: 30 },
        { hour: '11', value: 20 },
        { hour: '12', value: 10 },
        { hour: '13', value: 0 },
      ],
    },
    processes: [
      { label: 'Процесс 1', load: 10 },
      { label: 'Процесс 2', load: 60 },
      { label: 'Процесс 3', load: 90 },
    ],
  },
} as const;
