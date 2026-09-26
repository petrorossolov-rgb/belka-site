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
import { LIMITS } from '../src/lib/schemas';
import {
  block,
  caseEntry,
  ep01Products,
  mockup,
  og,
  page,
  pageProduct,
  product,
  refs,
  standalone,
  surface,
  wmsScope,
} from './fixtures/content';

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
    blocks: [wmsScope],
    mockups: [],
    site: {},
  };

  it('принимает набор ep01 и вложенный id страницы', () => {
    expect(() => assertContentIntegrity(valid)).not.toThrow();
  });

  it('пустые коллекции — без исключений', () => {
    expect(() => assertContentIntegrity({ products: [], pages: [], cases: [], blocks: [], mockups: [], site: {} })).not.toThrow();
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

  it('тело без hasPage допустимо — служебная заглушка продукта без страницы', () => {
    expect(() => assertContentIntegrity({ ...valid, products: [standalone('packapp', {})] })).not.toThrow();
    const products = [product('yms', {}, 'Заглушка ep01.')];
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
    expect(message).toMatch(/yms\.md: у продукта со страницей \(hasPage\) нужны descriptor, lead, sections/);
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
    mockups: [],
    site: {},
  };
  // Секция страницы WMS из набора ep01 (`pageProduct`) есть при любой подмене блоков.
  const check = (patch: Partial<Parameters<typeof assertContentIntegrity>[0]>) => () =>
    assertContentIntegrity({ ...base, ...patch, blocks: [...(patch.blocks ?? base.blocks), wmsScope] });

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

describe('assertContentIntegrity: страница продукта, мокапы, OG (ep03)', () => {
  const wmsSurfaces = block('wms-surfaces', { view: 'surfaces', items: [surface('wms-console', 'wms')] });
  const wms = pageProduct('wms', { sections: refs('wms-scope', 'wms-surfaces') });
  const base = {
    products: [wms, product('analytics', { mapOrder: 6 })],
    pages: [page('index')],
    cases: [],
    blocks: [wmsScope, wmsSurfaces],
    mockups: [mockup('wms-console')],
    site: { mockupNote: 'Демо-данные.' },
  };
  const check = (patch: Partial<Parameters<typeof assertContentIntegrity>[0]>) => () =>
    assertContentIntegrity({ ...base, ...patch });

  it('набор с поверхностями, мокапом и подписью — без исключений', () => {
    expect(check({})).not.toThrow();
  });

  it('концепт-продукт: hasPage, descriptor, lead, секции text и cards, без surfaces и мокапов', () => {
    const concept = pageProduct('portal', { mapOrder: 2, sections: refs('portal-about', 'portal-fit') });
    const blocks = [block('portal-about', { view: 'text' }, 'Текст концепции.'), block('portal-fit')];
    expect(check({ products: [concept], blocks, mockups: [], site: {} })).not.toThrow();
  });

  describe('1: у продукта со страницей — descriptor, lead и секции, тела нет', () => {
    it.each(['descriptor', 'lead'] as const)('нет %s — исключение', (field) => {
      expect(check({ products: [pageProduct('wms', { [field]: undefined })] })).toThrow(
        new RegExp(`wms\\.md: у продукта со страницей \\(hasPage\\) нужны ${field}$`, 'm'),
      );
    });

    it('нет секций — исключение, и на черновой странице тоже', () => {
      expect(check({ products: [pageProduct('wms', { sections: [] })] })).toThrow(/нужны sections/);
      expect(check({ products: [pageProduct('wms', { sections: undefined, pageDraft: true })] })).toThrow(
        /нужны sections/,
      );
    });

    it('тело из одного непробельного символа — исключение; из одних пробелов — тела нет', () => {
      expect(check({ products: [pageProduct('wms', {}, '.')] })).toThrow(/wms\.md: у продукта со страницей \(hasPage\) тела нет/);
      expect(check({ products: [pageProduct('wms', {}, '  \n\n  ')] })).not.toThrow();
    });

    it('<title> «имя — пояснение» ровно titleMax проходит, +1 без seo.title падает, +1 с seo.title проходит', () => {
      const prefix = 'Belka WMS — ';
      const withDescriptor = (length: number, seo?: { title: string }) =>
        pageProduct('wms', { name: 'Belka WMS', descriptor: 'я'.repeat(length - prefix.length), seo });
      expect(check({ products: [withDescriptor(LIMITS.titleMax)] })).not.toThrow();
      expect(check({ products: [withDescriptor(LIMITS.titleMax + 1)] })).toThrow(
        /wms\.md: заголовок страницы «Belka WMS — я+» длиннее 60 символов — задайте seo\.title/,
      );
      expect(check({ products: [withDescriptor(LIMITS.titleMax + 1, { title: 'Belka WMS' })] })).not.toThrow();
    });

    it('длина заголовка у продукта без страницы не проверяется', () => {
      const long = product('wms', { mapOrder: 1, descriptor: 'я'.repeat(LIMITS.titleMax) });
      expect(check({ products: [long], blocks: [wmsScope] })).not.toThrow();
    });

    it('без hasPage descriptor, lead и секции не нужны', () => {
      // Без блока поверхностей: пункт `surfaces` требует descriptor у продукта (правило 3).
      expect(check({ products: [product('wms', { mapOrder: 1 }, 'Заглушка ep01.')], blocks: [wmsScope] })).not.toThrow();
    });
  });

  describe('2: секции продукта — существующие блоки без повторов', () => {
    it('несуществующий блок — исключение', () => {
      expect(check({ products: [pageProduct('wms', { sections: refs('wms-scope', 'nope') })] })).toThrow(
        /wms\.md: секция «nope» не найдена в src\/content\/blocks/,
      );
    });

    it('повтор блока — исключение; тот же блок у страницы и у продукта — допустим', () => {
      expect(check({ products: [pageProduct('wms', { sections: refs('wms-scope', 'wms-scope') })] })).toThrow(
        /wms\.md: секция «wms-scope» повторяется/,
      );
      expect(check({ pages: [page('index', { sections: refs('wms-scope') })] })).not.toThrow();
    });
  });

  describe('3: пункт surfaces — мокап и продукт существуют, продукт с descriptor и не черновик', () => {
    const surfaces = (items: ReturnType<typeof surface>[], draft = false) =>
      block('wms-surfaces', { view: 'surfaces', items, draft });

    it('несуществующий мокап — исключение', () => {
      expect(check({ blocks: [wmsScope, surfaces([surface('nope', 'wms')])] })).toThrow(
        /wms-surfaces\.md: пункт 1 — мокап «nope» не найден в src\/content\/mockups/,
      );
    });

    it('несуществующий продукт — исключение', () => {
      expect(check({ blocks: [wmsScope, surfaces([surface('wms-console', 'nope')])] })).toThrow(
        /wms-surfaces\.md: пункт 1 — продукт «nope» не найден/,
      );
    });

    it('продукт без descriptor — исключение; с descriptor — допустим', () => {
      const blocks = [wmsScope, surfaces([surface('wms-console', 'wms'), surface('wms-console-2', 'analytics')])];
      const mockups = [mockup('wms-console'), mockup('wms-console-2', 'dashboard')];
      expect(check({ blocks, mockups })).toThrow(
        /wms-surfaces\.md: пункт 2 — у продукта src\/content\/products\/analytics\.md нет descriptor/,
      );
      const analytics = product('analytics', { mapOrder: 6, descriptor: 'пояснение имени' });
      expect(check({ blocks, mockups, products: [wms, analytics] })).not.toThrow();
    });

    it('нечерновой блок с черновым продуктом — исключение; черновой блок — допустим', () => {
      const analytics = product('analytics', { mapOrder: 6, descriptor: 'пояснение имени', draft: true });
      const items = [surface('wms-console', 'analytics')];
      const products = [wms, analytics];
      expect(check({ products, blocks: [wmsScope, surfaces(items)] })).toThrow(
        /нечерновой блок называет черновой продукт src\/content\/products\/analytics\.md/,
      );
      expect(check({ products, blocks: [wmsScope, surfaces(items, true)] })).not.toThrow();
    });
  });

  describe('4: мокап не повторяется в секциях одной записи', () => {
    const second = block('surfaces', { view: 'surfaces', items: [surface('wms-console', 'wms')] });

    it('тот же мокап в двух блоках одной страницы — исключение', () => {
      const pages = [page('index', { sections: refs('wms-surfaces', 'surfaces') })];
      expect(check({ pages, blocks: [wmsScope, wmsSurfaces, second] })).toThrow(
        /index\.md: мокап «wms-console» повторяется в секциях/,
      );
    });

    it('тот же мокап дважды в одном блоке продукта — исключение', () => {
      const twice = block('wms-surfaces', {
        view: 'surfaces',
        items: [surface('wms-console', 'wms'), surface('wms-console', 'wms')],
      });
      expect(check({ blocks: [wmsScope, twice] })).toThrow(/wms\.md: мокап «wms-console» повторяется в секциях/);
    });

    it('один мокап на главной и на странице продукта — допустим', () => {
      const pages = [page('index', { sections: refs('surfaces') })];
      expect(check({ pages, blocks: [wmsScope, wmsSurfaces, second] })).not.toThrow();
    });
  });

  describe('5: мокап в секциях ⇒ site.mockupNote', () => {
    it('нет подписи или она из пробелов — исключение с именем мокапа', () => {
      expect(check({ site: {} })).toThrow(/site\.yaml: на сайте есть мокапы \(wms-console\), но не задан mockupNote/);
      expect(check({ site: { mockupNote: '  ' } })).toThrow(/не задан mockupNote/);
    });

    it('мокап только в черновом блоке — подпись всё равно нужна: стейджинг его рендерит', () => {
      const draft = block('wms-surfaces', { view: 'surfaces', items: [surface('wms-console', 'wms')], draft: true });
      expect(check({ blocks: [wmsScope, draft], site: {} })).toThrow(/не задан mockupNote/);
    });

    it('мокап есть в коллекции, но ни в одной секции — подпись не нужна', () => {
      const products = [pageProduct('wms')];
      expect(check({ products, site: {} })).not.toThrow();
    });
  });

  describe('6: OG — PNG 1200×630 у страницы, продукта и сайта', () => {
    const cases = [
      ['JPG 1200×630', og('jpg')],
      ['PNG 1200×600', og('png', 1200, 600)],
      ['PNG 1201×630', og('png', 1201, 630)],
    ] as const;

    it.each(cases)('%s у страницы — исключение', (_, image) => {
      expect(check({ pages: [page('index', { ogImage: image })] })).toThrow(/index\.md: ogImage: OG-картинка .* нужна png 1200×630/);
    });

    it.each(cases)('%s у продукта — исключение', (_, image) => {
      expect(check({ products: [pageProduct('wms', { sections: refs('wms-scope'), ogImage: image })] })).toThrow(
        /wms\.md: ogImage: OG-картинка/,
      );
    });

    it.each(cases)('%s у сайта — исключение', (_, image) => {
      expect(check({ site: { mockupNote: 'Демо-данные.', seo: { defaultOgImage: image } } })).toThrow(
        /site\.yaml: seo\.defaultOgImage: OG-картинка/,
      );
    });

    it('PNG 1200×630 у всех трёх — допустимо', () => {
      expect(
        check({
          pages: [page('index', { ogImage: og() })],
          products: [pageProduct('wms', { sections: refs('wms-scope', 'wms-surfaces'), ogImage: og() })],
          site: { mockupNote: 'Демо-данные.', seo: { defaultOgImage: og() } },
        }),
      ).not.toThrow();
    });
  });

  it.each(['Wms_Console', 'a/b', 'wms-console-'])('7: id мокапа «%s» — исключение', (id) => {
    expect(check({ mockups: [mockup('wms-console'), mockup(id)] })).toThrow(`${id}.yaml: id «${id}» не соответствует формату`);
  });

  describe('8: видимая в production страница продукта не пустеет без черновых блоков', () => {
    const allDraft = [block('wms-scope', { view: 'list', draft: true }), block('wms-surfaces', { ...wmsSurfaces.data, draft: true })];

    it('pageDraft: false и все секции черновые — исключение; pageDraft: true — допустимо', () => {
      expect(check({ blocks: allDraft })).toThrow(/wms\.md: страница продукта видима в production, но все её секции — черновики/);
      expect(check({ blocks: allDraft, products: [{ ...wms, data: { ...wms.data, pageDraft: true } }] })).not.toThrow();
    });

    it('черновой продукт — допустимо; хотя бы одна нечерновая секция — допустимо', () => {
      expect(check({ blocks: allDraft, products: [{ ...wms, data: { ...wms.data, draft: true } }] })).not.toThrow();
      expect(check({ blocks: [wmsScope, allDraft[1]!] })).not.toThrow();
    });
  });
});

describe('resolveSections для продукта', () => {
  const blocks = [block('a'), block('wip', { draft: true }), block('b')];
  const wms = pageProduct('wms', { sections: refs('b', 'wip', 'a') });

  it('порядок — как в sections; production исключает черновой блок', () => {
    expect(ids(resolveSections(wms, blocks, 'staging'))).toEqual(['b', 'wip', 'a']);
    expect(ids(resolveSections(wms, blocks, 'production'))).toEqual(['b', 'a']);
  });

  it('отсутствующий блок — ошибка с именем файла продукта', () => {
    expect(() => resolveSections(pageProduct('wms', { sections: refs('nope') }), blocks, 'staging')).toThrow(
      /src\/content\/products\/wms\.md: секция «nope» не найдена/,
    );
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
