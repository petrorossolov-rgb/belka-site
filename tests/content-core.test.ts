import { describe, expect, it } from 'vitest';
import {
  assertContentIntegrity,
  buildNav,
  filterVisible,
  getPlatformMap,
  getStandaloneProducts,
  pageHref,
  showsDrafts,
  visibleContacts,
  visibleLegal,
} from '../src/lib/content-core';
import { caseEntry, ep01Products, page, product, standalone } from './fixtures/content';

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
  const valid = { products: ep01Products, pages: [page('index'), page('legal/privacy')], cases: [] };

  it('принимает набор ep01 и вложенный id страницы', () => {
    expect(() => assertContentIntegrity(valid)).not.toThrow();
  });

  it('пустые коллекции — без исключений', () => {
    expect(() => assertContentIntegrity({ products: [], pages: [], cases: [] })).not.toThrow();
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
