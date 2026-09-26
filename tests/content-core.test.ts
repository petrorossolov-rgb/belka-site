import { describe, expect, it } from 'vitest';
import {
  RESERVED_PAGE_IDS,
  assertContentIntegrity,
  blockLink,
  buildNav,
  filterVisible,
  getFeaturedProducts,
  getPlatformMap,
  getProductPages,
  getStandaloneProducts,
  isLinkable,
  pageHref,
  resolveSections,
  showsDrafts,
  visibleContacts,
  visibleLegal,
} from '../src/lib/content-core';
import { block, caseEntry, ep01Products, page, product, refs, standalone } from './fixtures/content';

const ids = (entries: readonly { id: string }[]) => entries.map((e) => e.id);

describe('filterVisible', () => {
  const draft = product('wms', { draft: true });
  const ready = product('portal', { mapOrder: 2 });

  it('черновик скрыт в production', () => {
    expect(ids(filterVisible([draft, ready], 'production'))).toEqual(['portal']);
  });

  it('черновик виден в staging и development', () => {
    expect(ids(filterVisible([draft, ready], 'staging'))).toEqual(['wms', 'portal']);
    expect(ids(filterVisible([draft, ready], 'development'))).toEqual(['wms', 'portal']);
  });

  it('неопубликованный кейс скрыт в любом окружении', () => {
    const cases = [caseEntry('hidden', 'packapp', false), caseEntry('shown', 'packapp', true)];
    for (const env of ['production', 'staging', 'development'] as const) {
      expect(ids(filterVisible(cases, env))).toEqual(['shown']);
    }
  });

  it('пустая коллекция — пустой массив', () => {
    expect(filterVisible([], 'production')).toEqual([]);
  });

  it('showsDrafts: только production скрывает черновики', () => {
    expect(showsDrafts('production')).toBe(false);
    expect(showsDrafts('staging')).toBe(true);
    expect(showsDrafts('development')).toBe(true);
  });
});

describe('buildNav', () => {
  const pages = [
    page('about', { title: 'О компании', nav: { order: 20, placement: 'header' } }),
    page('contacts', { title: 'Контакты', nav: { label: 'Связаться', order: 10, placement: 'header' } }),
    page('legal/privacy', { title: 'Политика', nav: { order: 1, placement: 'footer' } }),
    page('index', { title: 'Главная' }),
  ];

  it('сортирует по order и фильтрует по placement; label по умолчанию — title', () => {
    expect(buildNav(pages, 'header')).toEqual([
      { href: '/contacts/', label: 'Связаться', order: 10 },
      { href: '/about/', label: 'О компании', order: 20 },
    ]);
    expect(buildNav(pages, 'footer')).toEqual([{ href: '/legal/privacy/', label: 'Политика', order: 1 }]);
  });

  it('при равном order порядок задаёт id', () => {
    const tied = [
      page('b', { nav: { order: 1, placement: 'header' } }),
      page('a', { nav: { order: 1, placement: 'header' } }),
    ];
    expect(buildNav(tied, 'header').map((i) => i.href)).toEqual(['/a/', '/b/']);
  });

  it('страница без nav не попадает в меню', () => {
    expect(buildNav([page('index')], 'header')).toEqual([]);
    expect(buildNav([page('index')], 'footer')).toEqual([]);
  });

  it('черновая страница в production не попадает в навигацию, на стейджинге — попадает', () => {
    const withDraft = [...pages, page('wip', { draft: true, nav: { order: 5, placement: 'header' } })];
    expect(buildNav(filterVisible(withDraft, 'production'), 'header').map((i) => i.href)).toEqual([
      '/contacts/',
      '/about/',
    ]);
    expect(buildNav(filterVisible(withDraft, 'staging'), 'header').map((i) => i.href)).toEqual([
      '/wip/',
      '/contacts/',
      '/about/',
    ]);
  });

  it('пустая коллекция — пустое меню', () => {
    expect(buildNav([], 'header')).toEqual([]);
  });
});

describe('pageHref', () => {
  it('index — корень, остальные — со слэшем на конце', () => {
    expect(pageHref('index')).toBe('/');
    expect(pageHref('contacts')).toBe('/contacts/');
    expect(pageHref('legal/privacy')).toBe('/legal/privacy/');
  });
});

describe('карта платформы и отдельные продукты', () => {
  it('карта — только platform, по mapOrder', () => {
    expect(ids(getPlatformMap(ep01Products))).toEqual([
      'wms',
      'portal',
      'yms',
      'tms',
      'oms',
      'analytics',
      'billing',
      'labor',
    ]);
  });

  it('PackApp не на карте, а в отдельных продуктах', () => {
    expect(ids(getPlatformMap(ep01Products))).not.toContain('packapp');
    expect(ids(getStandaloneProducts(ep01Products))).toEqual(['packapp']);
  });

  it('не меняет входной массив', () => {
    const before = ids(ep01Products);
    getPlatformMap(ep01Products);
    getStandaloneProducts(ep01Products);
    expect(ids(ep01Products)).toEqual(before);
  });

  it('пустая коллекция — пустые массивы', () => {
    expect(getPlatformMap([])).toEqual([]);
    expect(getStandaloneProducts([])).toEqual([]);
  });
});

describe('assertContentIntegrity', () => {
  const valid = {
    products: ep01Products,
    pages: [page('index'), page('legal/privacy')],
    cases: [],
    blocks: [],
    site: {},
  };

  it('принимает набор ep01 и вложенный id страницы', () => {
    expect(() => assertContentIntegrity(valid)).not.toThrow();
  });

  it('пустые коллекции — без исключений', () => {
    expect(() => assertContentIntegrity({ products: [], pages: [], cases: [], blocks: [], site: {} })).not.toThrow();
  });

  it('дубль mapOrder — исключение с именами обоих файлов', () => {
    const products = [product('wms', { mapOrder: 3 }), product('yms', { mapOrder: 3 })];
    expect(() => assertContentIntegrity({ ...valid, products })).toThrow(
      /mapOrder 3 повторяется: src\/content\/products\/wms\.md и src\/content\/products\/yms\.md/,
    );
  });

  it.each(['Wms', 'pack_app', 'wms-', '-wms', 'wms--app', 'wms/app'])('id продукта «%s» — исключение', (id) => {
    expect(() => assertContentIntegrity({ ...valid, products: [product(id)] })).toThrow(/не соответствует формату/);
  });

  it('id страницы проверяется по сегментам', () => {
    expect(() => assertContentIntegrity({ ...valid, pages: [page('legal/Privacy')] })).toThrow(/legal\/Privacy/);
    expect(() => assertContentIntegrity({ ...valid, pages: [page('legal_docs/privacy')] })).toThrow(
      /по сегментам/,
    );
    expect(() => assertContentIntegrity({ ...valid, pages: [page('legal//privacy')] })).toThrow();
  });

  it('id кейса с заглавной буквой — исключение', () => {
    const cases = [caseEntry('Big-client', 'packapp', false)];
    expect(() => assertContentIntegrity({ ...valid, cases })).toThrow(/Big-client/);
  });

  it('hasPage с пустым телом — исключение', () => {
    for (const body of ['', '  \n\n  ']) {
      const products = [product('wms', { hasPage: true }, body)];
      expect(() => assertContentIntegrity({ ...valid, products })).toThrow(/wms\.md: hasPage: true/);
    }
  });

  it('пустое тело без hasPage допустимо', () => {
    expect(() => assertContentIntegrity({ ...valid, products: [standalone('packapp', {})] })).not.toThrow();
    const products = [product('yms', {}, '')];
    expect(() => assertContentIntegrity({ ...valid, products })).not.toThrow();
  });

  it('опубликованный кейс при черновом продукте — исключение, неопубликованный — допустим', () => {
    const products = [product('wms', { draft: true })];
    expect(() =>
      assertContentIntegrity({ ...valid, products, cases: [caseEntry('first', 'wms', true)] }),
    ).toThrow(/first\.md: опубликованный кейс ссылается на черновик src\/content\/products\/wms\.md/);
    expect(() =>
      assertContentIntegrity({ ...valid, products, cases: [caseEntry('first', 'wms', false)] }),
    ).not.toThrow();
  });

  it('кейс на несуществующий продукт — исключение', () => {
    expect(() => assertContentIntegrity({ ...valid, cases: [caseEntry('first', 'nope', false)] })).toThrow(
      /продукт «nope» не найден/,
    );
  });

  it('собирает все нарушения в одно исключение', () => {
    const products = [product('Wms', { mapOrder: 1 }), product('yms', { mapOrder: 1, hasPage: true }, '')];
    let message = '';
    try {
      assertContentIntegrity({ ...valid, products });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/не соответствует формату/);
    expect(message).toMatch(/mapOrder 1 повторяется/);
    expect(message).toMatch(/hasPage: true/);
  });
});

describe('RESERVED_PAGE_IDS', () => {
  it('главная и 404 — свои шаблоны', () => {
    expect(RESERVED_PAGE_IDS).toEqual(['index', '404']);
  });
});

describe('getFeaturedProducts', () => {
  const products = [
    standalone('packapp', { featured: true }),
    standalone('another', { featured: true }),
    product('portal', { mapOrder: 2, featured: true }),
    product('wms', { mapOrder: 1, featured: true }),
    product('yms', { mapOrder: 3 }),
  ];

  it('сначала платформа по mapOrder, затем отдельные по id; без featured — не карточка', () => {
    expect(ids(getFeaturedProducts(products))).toEqual(['wms', 'portal', 'another', 'packapp']);
  });

  it('черновой продукт в production исключён, на стейджинге — есть', () => {
    const withDraft = [...products, product('tms', { mapOrder: 4, featured: true, draft: true })];
    expect(ids(getFeaturedProducts(filterVisible(withDraft, 'production')))).not.toContain('tms');
    expect(ids(getFeaturedProducts(filterVisible(withDraft, 'staging')))).toContain('tms');
  });

  it('пустая коллекция — пустой массив', () => {
    expect(getFeaturedProducts([])).toEqual([]);
  });
});

describe('getProductPages и pageDraft', () => {
  const wms = product('wms', { mapOrder: 1, hasPage: true, pageDraft: true });
  const portal = product('portal', { mapOrder: 2, hasPage: true });
  const yms = product('yms', { mapOrder: 3 });
  const products = [wms, portal, yms];

  it('pageDraft: страницы нет в production, есть в staging и development', () => {
    expect(ids(getProductPages(products, 'production'))).toEqual(['portal']);
    expect(ids(getProductPages(products, 'staging'))).toEqual(['wms', 'portal']);
    expect(ids(getProductPages(products, 'development'))).toEqual(['wms', 'portal']);
  });

  it('сам продукт с pageDraft видим в обоих окружениях', () => {
    for (const env of ['production', 'staging'] as const) {
      expect(ids(getPlatformMap(filterVisible(products, env)))).toContain('wms');
    }
  });

  it('черновой продукт — без страницы в production, даже без pageDraft', () => {
    const draft = product('tms', { mapOrder: 4, hasPage: true, draft: true });
    expect(ids(getProductPages([draft], 'production'))).toEqual([]);
    expect(ids(getProductPages([draft], 'staging'))).toEqual(['tms']);
  });

  it('без hasPage страницы нет ни в одном окружении', () => {
    expect(getProductPages([yms], 'staging')).toEqual([]);
  });

  it('isLinkable: ссылка только на собранную страницу', () => {
    expect(isLinkable(wms, getProductPages(products, 'production'))).toBe(false);
    expect(isLinkable(wms, getProductPages(products, 'staging'))).toBe(true);
    expect(isLinkable(portal, getProductPages(products, 'production'))).toBe(true);
    expect(isLinkable(yms, getProductPages(products, 'staging'))).toBe(false);
  });
});

describe('resolveSections', () => {
  const blocks = [block('b'), block('a'), block('wip', { draft: true }), block('c')];
  const home = page('index', { sections: refs('c', 'wip', 'a') });

  it('порядок — как в sections, не как в коллекции', () => {
    expect(ids(resolveSections(home, blocks, 'staging'))).toEqual(['c', 'wip', 'a']);
  });

  it('production исключает черновые блоки, staging и development — показывают', () => {
    expect(ids(resolveSections(home, blocks, 'production'))).toEqual(['c', 'a']);
    expect(ids(resolveSections(home, blocks, 'development'))).toEqual(['c', 'wip', 'a']);
  });

  it('страница без sections — пустой список', () => {
    expect(resolveSections(page('about'), blocks, 'production')).toEqual([]);
  });

  it('отсутствующий блок — ошибка с именем файла страницы', () => {
    expect(() => resolveSections(page('index', { sections: refs('a', 'nope') }), blocks, 'production')).toThrow(
      /src\/content\/pages\/index\.md: секция «nope» не найдена/,
    );
  });
});

describe('blockLink', () => {
  const pages = [page('index'), page('approach', { draft: true })];
  const teaser = block('approach-teaser', { link: { page: { id: 'approach' }, label: 'Подробнее' } });

  it('целевая страница — черновик: в production ссылки нет, в staging есть', () => {
    expect(blockLink(teaser, filterVisible(pages, 'production'))).toBeUndefined();
    expect(blockLink(teaser, filterVisible(pages, 'staging'))).toEqual({ href: '/approach/', label: 'Подробнее' });
  });

  it('блок без link — без ссылки', () => {
    expect(blockLink(block('plain'), pages)).toBeUndefined();
  });

  it('ссылка на главную — корень', () => {
    const home = block('home-link', { link: { page: { id: 'index' }, label: 'На главную' } });
    expect(blockLink(home, pages)).toEqual({ href: '/', label: 'На главную' });
  });
});

describe('assertContentIntegrity: секции, маршруты, контакты (ep02)', () => {
  const home = (...sections: string[]) => page('index', { sections: refs(...sections) });
  const theses = block('theses');
  const team = block('team', { view: 'text' }, 'Текст команды.');
  const base = {
    products: ep01Products,
    pages: [home('theses', 'team')],
    cases: [],
    blocks: [theses, team],
    site: {},
  };
  const check = (patch: Partial<Parameters<typeof assertContentIntegrity>[0]>) => () =>
    assertContentIntegrity({ ...base, ...patch });

  it('набор с секциями — без исключений', () => {
    expect(check({})).not.toThrow();
  });

  it('1: id блока — формат ENTRY_ID, вложенный id не допускается', () => {
    for (const id of ['Theses', 'the_ses', 'team/one']) {
      expect(check({ blocks: [theses, team, block(id)] })).toThrow(`${id}.md: id «${id}» не соответствует формату`);
    }
  });

  it('2: секция на несуществующий блок — исключение, в том числе на черновой странице', () => {
    expect(check({ pages: [home('theses', 'nope')] })).toThrow(/index\.md: секция «nope» не найдена/);
    expect(check({ pages: [home('theses'), page('wip', { draft: true, sections: refs('nope') })] })).toThrow(
      /wip\.md: секция «nope» не найдена/,
    );
  });

  it('2: ссылка блока на несуществующую страницу — исключение, на черновую — допустима', () => {
    const linked = (id: string) => block('theses', { link: { page: { id }, label: 'Подробнее' } });
    expect(check({ blocks: [linked('nope'), team] })).toThrow(/theses\.md: ссылка на страницу «nope», которой нет/);
    expect(
      check({ blocks: [linked('approach'), team], pages: [...base.pages, page('approach', { draft: true })] }),
    ).not.toThrow();
  });

  it('2: ссылка блока на 404 — исключение: pageHref дал бы /404/, а такого маршрута нет; на index — допустима', () => {
    const linked = (id: string) => block('theses', { link: { page: { id }, label: 'Подробнее' } });
    expect(check({ blocks: [linked('404'), team], pages: [...base.pages, page('404')] })).toThrow(
      /theses\.md: ссылка на страницу «404» — у неё нет маршрута/,
    );
    expect(check({ blocks: [linked('index'), team] })).not.toThrow();
  });

  it('3: блок повторяется в sections одной страницы — исключение; на разных страницах — допустимо', () => {
    expect(check({ pages: [home('theses', 'team', 'theses')] })).toThrow(/секция «theses» повторяется/);
    expect(check({ pages: [home('theses'), page('about', { sections: refs('theses') })] })).not.toThrow();
  });

  it('4: у view: text нужно непустое тело', () => {
    for (const body of ['', '  \n\n  ']) {
      expect(check({ blocks: [theses, block('team', { view: 'text' }, body)] })).toThrow(
        /team\.md: у view: text нужен текст в теле/,
      );
    }
  });

  it('4: у остальных view тела нет; пробелы телом не считаются', () => {
    expect(check({ blocks: [block('theses', {}, 'Лишний текст.'), team] })).toThrow(
      /theses\.md: у view: cards тела нет/,
    );
    expect(check({ blocks: [block('theses', { view: 'platform-map' }, 'Текст.'), team] })).toThrow(
      /у view: platform-map тела нет/,
    );
    expect(check({ blocks: [block('theses', {}, '\n  \n'), team] })).not.toThrow();
  });

  it('5: id страницы не начинается с products/', () => {
    expect(check({ pages: [...base.pages, page('products/wms')] })).toThrow(
      /products\/wms\.md: id «products\/wms» занимает маршрут страниц продуктов/,
    );
    expect(check({ pages: [...base.pages, page('products-overview')] })).not.toThrow();
  });

  it('6: у 404 нет nav, sections и draft', () => {
    expect(check({ pages: [...base.pages, page('404')] })).not.toThrow();
    expect(check({ pages: [...base.pages, page('404', { sections: [] })] })).not.toThrow();
    expect(check({ pages: [...base.pages, page('404', { nav: { order: 1, placement: 'footer' } })] })).toThrow(
      /404\.md: у страницы 404 нет nav/,
    );
    expect(check({ pages: [...base.pages, page('404', { sections: refs('theses') })] })).toThrow(
      /404\.md: у страницы 404 нет sections/,
    );
    expect(check({ pages: [...base.pages, page('404', { draft: true })] })).toThrow(
      /404\.md: страница 404 не бывает черновиком/,
    );
  });

  it('7: видимая страница контактов требует канал; черновая — нет', () => {
    expect(check({ pages: [...base.pages, page('contacts')] })).toThrow(
      /contacts\.md: страница контактов видима, но в site\.contacts нет ни одного канала/,
    );
    expect(check({ pages: [...base.pages, page('contacts', { draft: true })] })).not.toThrow();
    expect(
      check({ pages: [...base.pages, page('contacts')], site: { contacts: { email: 'hello@example.ru' } } }),
    ).not.toThrow();
  });

  it('7: канал из одних пробелов не считается', () => {
    expect(
      check({ pages: [...base.pages, page('contacts')], site: { contacts: { email: '  ', telegram: ' ' } } }),
    ).toThrow(/нет ни одного канала/);
  });

  it('8: черновой блок на видимой странице допустим', () => {
    expect(check({ blocks: [block('theses', { draft: true }), team] })).not.toThrow();
  });
});

describe('функции подвала', () => {
  it('пустые группы — пустые списки', () => {
    expect(visibleContacts({ contacts: {}, legal: {} })).toEqual([]);
    expect(visibleLegal({ contacts: {}, legal: {} })).toEqual([]);
  });

  it('групп contacts и legal нет вовсе — пустые списки, без ошибок', () => {
    expect(visibleContacts({})).toEqual([]);
    expect(visibleLegal({})).toEqual([]);
  });

  it('частично заполненные контакты — только заполненные, со ссылками', () => {
    expect(visibleContacts({ contacts: { email: 'hello@example.ru', telegram: 'https://t.me/example' } })).toEqual([
      { key: 'email', href: 'mailto:hello@example.ru', text: 'hello@example.ru' },
      { key: 'telegram', href: 'https://t.me/example', text: 't.me/example' },
    ]);
    expect(visibleContacts({ contacts: { phone: '+79990000000' } })).toEqual([
      { key: 'phone', href: 'tel:+79990000000', text: '+79990000000' },
    ]);
  });

  it('частично заполненные реквизиты — только заполненные, с подписями', () => {
    expect(visibleLegal({ legal: { entityName: 'ООО «Пример»', inn: '7700000000' } })).toEqual([
      { key: 'entityName', text: 'ООО «Пример»' },
      { key: 'inn', text: 'ИНН 7700000000' },
    ]);
  });

  it('пустая строка и пробелы считаются пустым полем', () => {
    expect(visibleContacts({ contacts: { email: '', phone: '  ', telegram: 'https://t.me/example' } })).toEqual([
      { key: 'telegram', href: 'https://t.me/example', text: 't.me/example' },
    ]);
    expect(visibleLegal({ legal: { entityName: '', inn: ' ', ogrn: '1027700000000', address: '' } })).toEqual([
      { key: 'ogrn', text: 'ОГРН 1027700000000' },
    ]);
  });
});
