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
