import { describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import {
  BLOCK_VIEWS,
  LIMITS,
  MOCKUP_KIND_NAMES,
  blockSchema,
  caseSchema,
  mockupSchema,
  pageSchema,
  productSchema,
  siteSchema,
} from '../src/lib/schemas';
import {
  validCardsBlock,
  validCase,
  validMockups,
  validPage,
  validPlatformProduct,
  validSite,
  validSiteWithMetrika,
  validStandaloneProduct,
  validSurfacesBlock,
} from './fixtures/schemas';

// `image()` и `reference()` есть только у Astro — в тестах их заменяют строки.
const image = () => z.string();
const reference = () => z.string();
const product = productSchema(image, reference);
const page = pageSchema(image, reference);
const block = blockSchema(reference);
const site = siteSchema(image);
const caseWithProduct = caseSchema.extend({ product: z.string() });

/** Пути полей, на которые указывают ошибки валидации. */
function issuePaths(schema: z.ZodType, data: unknown): string[] {
  const result = schema.safeParse(data);
  expect(result.success, 'ожидалась ошибка валидации').toBe(false);
  return result.error!.issues.map((issue) => issue.path.join('.'));
}

/** Строка ровно по лимиту проходит, на символ длиннее — единственная ошибка по пути `path`. */
function expectLimit(schema: z.ZodType, build: (value: string) => unknown, max: number, path: string) {
  expect(schema.safeParse(build('я'.repeat(max))).success, `${path}: ${max} символов`).toBe(true);
  expect(issuePaths(schema, build('я'.repeat(max + 1)))).toEqual([path]);
}

describe('LIMITS и BLOCK_VIEWS', () => {
  it('лимиты новых полей — как в плане ep02', () => {
    expect(LIMITS).toMatchObject({ headingMax: 80, eyebrowMax: 60, leadMax: 320, linkLabelMax: 40, altMax: 120 });
  });

  it('лимиты ep03 — как в плане ep03', () => {
    expect(LIMITS).toMatchObject({ descriptorMax: 60, captionMax: 160, mockLabelMax: 28, mockCodeMax: 16, mockupNoteMax: 60 });
  });

  it('виды секций', () => {
    expect(BLOCK_VIEWS).toEqual(['text', 'cards', 'steps', 'list', 'platform-map', 'products', 'surfaces']);
  });
});

describe('product', () => {
  it('принимает продукт платформы и отдельный продукт', () => {
    expect(product.parse(validPlatformProduct)).toMatchObject({ kind: 'platform', mapOrder: 1 });
    expect(product.parse(validStandaloneProduct)).toMatchObject({ kind: 'standalone' });
  });

  it('подставляет значения по умолчанию: hasPage, pageDraft, featured и draft — false', () => {
    const parsed = product.parse(validStandaloneProduct);
    expect(parsed).toMatchObject({ hasPage: false, pageDraft: false, featured: false, draft: false });
    expect(parsed.lead).toBeUndefined();
  });

  it('принимает карточку на главной с lead', () => {
    const parsed = product.parse({ ...validStandaloneProduct, featured: true, lead: 'Текст карточки.' });
    expect(parsed).toMatchObject({ featured: true, lead: 'Текст карточки.' });
  });

  it('отклоняет featured без lead', () => {
    expect(issuePaths(product, { ...validStandaloneProduct, featured: true })).toEqual(['lead']);
  });

  it('принимает lead без featured', () => {
    expect(product.safeParse({ ...validStandaloneProduct, lead: 'Лид страницы.' }).success).toBe(true);
  });

  it('ограничивает lead лимитом leadMax', () => {
    expectLimit(product, (lead) => ({ ...validStandaloneProduct, lead }), LIMITS.leadMax, 'lead');
  });

  it('принимает черновую страницу у продукта со страницей', () => {
    const parsed = product.parse({ ...validPlatformProduct, draft: false, pageDraft: true });
    expect(parsed).toMatchObject({ hasPage: true, pageDraft: true, draft: false });
  });

  it('отклоняет pageDraft без hasPage — и явный false, и по умолчанию', () => {
    expect(issuePaths(product, { ...validPlatformProduct, hasPage: false, pageDraft: true })).toEqual(['pageDraft']);
    expect(issuePaths(product, { ...validStandaloneProduct, pageDraft: true })).toEqual(['pageDraft']);
  });

  it('отклоняет неверный kind', () => {
    expect(issuePaths(product, { ...validStandaloneProduct, kind: 'module' })).toContain('kind');
  });

  it('отклоняет платформенный продукт без mapOrder', () => {
    const { mapOrder: _, ...withoutOrder } = validPlatformProduct;
    expect(issuePaths(product, withoutOrder)).toEqual(['mapOrder']);
  });

  it('отклоняет отдельный продукт с mapOrder', () => {
    expect(issuePaths(product, { ...validStandaloneProduct, mapOrder: 9 })).toEqual(['mapOrder']);
  });

  it('отклоняет mapOrder не больше нуля и дробный', () => {
    expect(issuePaths(product, { ...validPlatformProduct, mapOrder: 0 })).toContain('mapOrder');
    expect(issuePaths(product, { ...validPlatformProduct, mapOrder: 1.5 })).toContain('mapOrder');
  });

  it('отклоняет имя без префикса «Belka »', () => {
    expect(issuePaths(product, { ...validPlatformProduct, name: 'WMS' })).toContain('name');
    expect(issuePaths(product, { ...validPlatformProduct, name: 'BelkaWMS' })).toContain('name');
  });

  it('ограничивает summary 140 символами', () => {
    expect(product.safeParse({ ...validPlatformProduct, summary: 'я'.repeat(140) }).success).toBe(true);
    expect(issuePaths(product, { ...validPlatformProduct, summary: 'я'.repeat(141) })).toContain('summary');
  });

  it('отклоняет неизвестные domain и readiness', () => {
    const paths = issuePaths(product, { ...validPlatformProduct, domain: 'retail', readiness: 'done' });
    expect(paths).toEqual(expect.arrayContaining(['domain', 'readiness']));
  });

  it('ограничивает seo.title 60 и seo.description 160 символами', () => {
    const paths = issuePaths(product, {
      ...validPlatformProduct,
      seo: { title: 'я'.repeat(61), description: 'я'.repeat(161) },
    });
    expect(paths).toEqual(expect.arrayContaining(['seo.title', 'seo.description']));
  });

  it('sections по умолчанию — пустой список; поля mockup больше нет', () => {
    const parsed = product.parse({ ...validPlatformProduct, mockup: 'WmsConsole' });
    expect(parsed.sections).toEqual([]);
    expect(parsed).not.toHaveProperty('mockup');
  });

  it('принимает descriptor, sections и ogImage с ogImageAlt', () => {
    const parsed = product.parse({
      ...validPlatformProduct,
      descriptor: 'система управления складом',
      sections: ['wms-scope', 'approach'],
      ogImage: './og-wms.png',
      ogImageAlt: 'Карточка продукта',
    });
    expect(parsed).toMatchObject({ descriptor: 'система управления складом', sections: ['wms-scope', 'approach'] });
  });

  it('ограничивает descriptor лимитом descriptorMax, пустой — ошибка', () => {
    expectLimit(product, (descriptor) => ({ ...validPlatformProduct, descriptor }), LIMITS.descriptorMax, 'descriptor');
    expect(issuePaths(product, { ...validPlatformProduct, descriptor: '' })).toEqual(['descriptor']);
  });

  it('отклоняет ogImage без ogImageAlt', () => {
    expect(issuePaths(product, { ...validPlatformProduct, ogImage: './og-wms.png' })).toEqual(['ogImageAlt']);
  });

  it('ограничивает ogImageAlt лимитом altMax', () => {
    const withAlt = (ogImageAlt: string) => ({ ...validPlatformProduct, ogImage: './og-wms.png', ogImageAlt });
    expectLimit(product, withAlt, LIMITS.altMax, 'ogImageAlt');
  });
});

describe('case', () => {
  it('принимает кейс; published по умолчанию false', () => {
    expect(caseWithProduct.parse(validCase).published).toBe(false);
  });

  it('требует title и clientLabel', () => {
    const paths = issuePaths(caseWithProduct, { product: 'packapp' });
    expect(paths).toEqual(expect.arrayContaining(['title', 'clientLabel']));
  });
});

describe('page', () => {
  it('принимает страницу; draft по умолчанию false', () => {
    const parsed = page.parse(validPage);
    expect(parsed.draft).toBe(false);
    expect(parsed.nav).toEqual({ label: 'Контакты', order: 10, placement: 'header' });
  });

  it('принимает страницу без nav, hero и ogImage', () => {
    const { nav: _n, hero: _h, ogImage: _o, ...minimal } = validPage;
    expect(page.safeParse(minimal).success).toBe(true);
  });

  it('ограничивает title 60 символами', () => {
    expect(page.safeParse({ ...validPage, title: 'я'.repeat(60) }).success).toBe(true);
    expect(issuePaths(page, { ...validPage, title: 'я'.repeat(61) })).toContain('title');
  });

  it('держит description в пределах 50–160 символов', () => {
    expect(page.safeParse({ ...validPage, description: 'я'.repeat(50) }).success).toBe(true);
    expect(page.safeParse({ ...validPage, description: 'я'.repeat(160) }).success).toBe(true);
    expect(issuePaths(page, { ...validPage, description: 'я'.repeat(49) })).toContain('description');
    expect(issuePaths(page, { ...validPage, description: 'я'.repeat(161) })).toContain('description');
  });

  it('отклоняет неизвестный placement', () => {
    const paths = issuePaths(page, { ...validPage, nav: { order: 1, placement: 'sidebar' } });
    expect(paths).toContain('nav.placement');
  });

  it('sections по умолчанию — пустой список, когда поля нет', () => {
    expect(page.parse(validPage).sections).toEqual([]);
  });

  it('хранит sections в порядке записи', () => {
    expect(page.parse({ ...validPage, sections: ['theses', 'platform', 'team'] }).sections).toEqual([
      'theses',
      'platform',
      'team',
    ]);
  });

  it('отклоняет sections не списком', () => {
    expect(issuePaths(page, { ...validPage, sections: 'theses' })).toEqual(['sections']);
  });

  it('отклоняет ogImage без ogImageAlt', () => {
    const { ogImageAlt: _, ...withoutAlt } = validPage;
    expect(issuePaths(page, withoutAlt)).toEqual(['ogImageAlt']);
  });

  it('принимает страницу без ogImage и без ogImageAlt', () => {
    const { ogImage: _i, ogImageAlt: _a, ...withoutOg } = validPage;
    expect(page.safeParse(withoutOg).success).toBe(true);
  });

  it('ограничивает ogImageAlt лимитом altMax', () => {
    expectLimit(page, (ogImageAlt) => ({ ...validPage, ogImageAlt }), LIMITS.altMax, 'ogImageAlt');
  });

  it('hero.heading необязателен и ограничен лимитом headingMax', () => {
    expect(page.parse(validPage).hero?.heading).toBeUndefined();
    expectLimit(page, (heading) => ({ ...validPage, hero: { heading } }), LIMITS.headingMax, 'hero.heading');
  });
});

describe('block', () => {
  /** Минимальная валидная секция каждого вида. */
  const minimal = {
    text: { view: 'text', title: 'Команда' },
    cards: { view: 'cards', title: 'Тезисы', items: [{ title: 'Пункт', text: 'Текст.' }] },
    steps: { view: 'steps', title: 'Подход', items: [{ title: 'Этап', text: 'Текст.' }] },
    list: { view: 'list', title: 'Охват', items: [{ title: 'Процесс' }] },
    'platform-map': { view: 'platform-map', title: 'Состав платформы' },
    products: { view: 'products', title: 'Продукты' },
    surfaces: validSurfacesBlock,
  } as const;

  it('минимальная фикстура есть у каждого вида', () => {
    expect(Object.keys(minimal)).toEqual([...BLOCK_VIEWS]);
  });

  it.each(BLOCK_VIEWS)('принимает минимальную секцию view: %s', (view) => {
    expect(block.safeParse(minimal[view]).success).toBe(true);
  });

  it('подставляет значения по умолчанию: items — [], draft — false, без link', () => {
    const parsed = block.parse(minimal.text);
    expect(parsed).toMatchObject({ items: [], draft: false });
    expect(parsed.link).toBeUndefined();
  });

  it('принимает секцию со всеми полями', () => {
    expect(block.parse(validCardsBlock)).toMatchObject({ link: { page: 'approach', label: 'Подробнее' } });
  });

  it('отклоняет неизвестный view и секцию без title', () => {
    expect(issuePaths(block, { ...validCardsBlock, view: 'gallery' })).toEqual(['view']);
    const { title: _, ...withoutTitle } = validCardsBlock;
    expect(issuePaths(block, withoutTitle)).toEqual(['title']);
    expect(issuePaths(block, { ...validCardsBlock, title: '' })).toEqual(['title']);
  });

  it.each(['cards', 'steps', 'list'] as const)('view: %s требует хотя бы один пункт', (view) => {
    const { items: _, ...withoutItems } = minimal[view];
    expect(issuePaths(block, withoutItems)).toEqual(['items']);
    expect(issuePaths(block, { ...minimal[view], items: [] })).toEqual(['items']);
  });

  it.each(['cards', 'steps'] as const)('view: %s требует text у каждого пункта', (view) => {
    const items = [{ title: 'С текстом', text: 'Текст.' }, { title: 'Без текста' }];
    expect(issuePaths(block, { ...minimal[view], items })).toEqual(['items.1.text']);
  });

  it('view: list принимает пункты без text', () => {
    expect(block.safeParse({ ...minimal.list, items: [{ title: 'А' }, { title: 'Б', text: 'Пояснение.' }] }).success).toBe(
      true,
    );
  });

  it.each(['text', 'platform-map', 'products'] as const)('view: %s не принимает пункты', (view) => {
    expect(issuePaths(block, { ...minimal[view], items: [{ title: 'Пункт', text: 'Текст.' }] })).toEqual(['items']);
  });

  it('view: surfaces требует хотя бы один пункт', () => {
    const { items: _, ...withoutItems } = validSurfacesBlock;
    expect(issuePaths(block, withoutItems)).toEqual(['items']);
    expect(issuePaths(block, { ...validSurfacesBlock, items: [] })).toEqual(['items']);
  });

  it.each(['text', 'mockup', 'product'] as const)('view: surfaces требует %s у каждого пункта', (field) => {
    const item = validSurfacesBlock.items[0]!;
    const { [field]: _, ...withoutField } = item;
    expect(issuePaths(block, { ...validSurfacesBlock, items: [item, withoutField] })).toEqual([`items.1.${field}`]);
  });

  it.each([
    ['cards', 'mockup'],
    ['cards', 'product'],
    ['list', 'mockup'],
    ['list', 'product'],
    ['steps', 'mockup'],
  ] as const)('view: %s не принимает %s в пункте', (view, field) => {
    const items = [{ title: 'Пункт', text: 'Текст.', [field]: 'wms' }];
    expect(issuePaths(block, { ...minimal[view], items })).toEqual([`items.0.${field}`]);
  });

  it('link требует page и label', () => {
    expect(issuePaths(block, { ...validCardsBlock, link: { label: 'Подробнее' } })).toEqual(['link.page']);
    expect(issuePaths(block, { ...validCardsBlock, link: { page: 'approach' } })).toEqual(['link.label']);
  });

  it('draft — только boolean', () => {
    expect(block.parse({ ...minimal.text, draft: true }).draft).toBe(true);
    expect(issuePaths(block, { ...minimal.text, draft: 'да' })).toEqual(['draft']);
  });

  it.each([
    ['eyebrow', LIMITS.eyebrowMax, (v: string) => ({ ...validCardsBlock, eyebrow: v })],
    ['title', LIMITS.headingMax, (v: string) => ({ ...validCardsBlock, title: v })],
    ['lead', LIMITS.leadMax, (v: string) => ({ ...validCardsBlock, lead: v })],
    ['items.0.title', LIMITS.headingMax, (v: string) => ({ ...validCardsBlock, items: [{ title: v, text: 'Текст.' }] })],
    ['items.0.text', LIMITS.leadMax, (v: string) => ({ ...validCardsBlock, items: [{ title: 'Пункт', text: v }] })],
    ['link.label', LIMITS.linkLabelMax, (v: string) => ({ ...validCardsBlock, link: { page: 'approach', label: v } })],
  ] as const)('ограничивает %s лимитом (%i символов)', (path, max, build) => {
    expectLimit(block, build, max, path);
  });
});

describe('site', () => {
  it('принимает пустые контакты, реквизиты и выключенные флаги', () => {
    expect(site.parse(validSite).flags).toEqual({
      legalEntityReady: false,
      metrikaEnabled: false,
      showReadiness: false,
    });
  });

  it('подставляет пустые объекты, если группы полей опущены', () => {
    const { contacts: _c, legal: _l, metrika: _m, seo: _s, ...bare } = validSite;
    expect(site.parse(bare)).toMatchObject({ contacts: {}, legal: {}, metrika: {}, seo: {} });
  });

  it('принимает полный набор: юрлицо, счётчик и включённую Метрику', () => {
    expect(site.safeParse(validSiteWithMetrika).success).toBe(true);
  });

  it('отклоняет Метрику без юрлица', () => {
    const data = {
      ...validSiteWithMetrika,
      flags: { ...validSiteWithMetrika.flags, legalEntityReady: false },
    };
    expect(issuePaths(site, data)).toEqual(['flags.metrikaEnabled']);
  });

  it('отклоняет Метрику при юрлице, но без counterId', () => {
    expect(issuePaths(site, { ...validSiteWithMetrika, metrika: {} })).toEqual(['flags.metrikaEnabled']);
  });

  it('отклоняет флаг юрлица без ИНН и без названия', () => {
    const base = { ...validSite, flags: { ...validSite.flags, legalEntityReady: true } };
    expect(issuePaths(site, { ...base, legal: { entityName: 'ООО «Пример»' } })).toEqual(['flags.legalEntityReady']);
    expect(issuePaths(site, { ...base, legal: { inn: '7700000000' } })).toEqual(['flags.legalEntityReady']);
  });

  it('проверяет форматы ИНН и ОГРН', () => {
    const withLegal = (legal: object) => ({ ...validSite, legal });
    expect(site.safeParse(withLegal({ inn: '770000000000', ogrn: '302770000000000' })).success).toBe(true);
    expect(issuePaths(site, withLegal({ inn: '77000000000' }))).toEqual(['legal.inn']);
    expect(issuePaths(site, withLegal({ ogrn: '10277000000000' }))).toEqual(['legal.ogrn']);
  });

  it('проверяет телефон в E.164', () => {
    const withPhone = (phone: string) => ({ ...validSite, contacts: { phone } });
    expect(issuePaths(site, withPhone('79990000000'))).toEqual(['contacts.phone']);
    expect(issuePaths(site, withPhone('+7 999 000-00-00'))).toEqual(['contacts.phone']);
  });

  it('принимает Telegram только на t.me', () => {
    const withTelegram = (telegram: string) => ({ ...validSite, contacts: { telegram } });
    expect(issuePaths(site, withTelegram('https://telegram.me/example'))).toEqual(['contacts.telegram']);
    expect(issuePaths(site, withTelegram('https://t.me.evil.ru/example'))).toEqual(['contacts.telegram']);
    expect(issuePaths(site, withTelegram('http://t.me/example'))).toEqual(['contacts.telegram']);
  });

  it('отклоняет нечисловой counterId и невалидную почту', () => {
    expect(issuePaths(site, { ...validSite, metrika: { counterId: 'abc123' } })).toEqual(['metrika.counterId']);
    expect(issuePaths(site, { ...validSite, contacts: { email: 'hello@' } })).toEqual(['contacts.email']);
  });

  it('отклоняет seo.defaultOgImage без seo.defaultOgImageAlt', () => {
    const data = { ...validSite, seo: { defaultOgImage: './og-default.png' } };
    expect(issuePaths(site, data)).toEqual(['seo.defaultOgImageAlt']);
  });

  it('ограничивает seo.defaultOgImageAlt лимитом altMax', () => {
    const withAlt = (defaultOgImageAlt: string) => ({
      ...validSite,
      seo: { defaultOgImage: './og-default.png', defaultOgImageAlt },
    });
    expectLimit(site, withAlt, LIMITS.altMax, 'seo.defaultOgImageAlt');
  });

  it('требует https в url', () => {
    expect(issuePaths(site, { ...validSite, url: 'http://belkascm.ru' })).toEqual(['url']);
  });

  it('mockupNote необязателен и ограничен лимитом mockupNoteMax', () => {
    expect(site.parse(validSite).mockupNote).toBeUndefined();
    expectLimit(site, (mockupNote) => ({ ...validSite, mockupNote }), LIMITS.mockupNoteMax, 'mockupNote');
    expect(issuePaths(site, { ...validSite, mockupNote: '' })).toEqual(['mockupNote']);
  });
});

describe('mockup', () => {
  const { console: consoleMockup, terminal, pack, dashboard } = validMockups;

  it('фикстура есть у каждого вида', () => {
    expect(Object.keys(validMockups)).toEqual([...MOCKUP_KIND_NAMES]);
    expect(MOCKUP_KIND_NAMES).toEqual(['console', 'terminal', 'pack', 'dashboard']);
  });

  it.each(MOCKUP_KIND_NAMES)('принимает мокап kind: %s', (kind) => {
    expect(mockupSchema.parse(validMockups[kind])).toMatchObject({ kind });
  });

  it('exceptions консоли по умолчанию — пустой список', () => {
    const { exceptions: _, ...withoutExceptions } = consoleMockup;
    expect(mockupSchema.parse(withoutExceptions)).toMatchObject({ exceptions: [] });
  });

  it('отклоняет неизвестный kind и мокап без kind', () => {
    expect(issuePaths(mockupSchema, { ...consoleMockup, kind: 'gallery' })).toEqual(['kind']);
    const { kind: _, ...withoutKind } = consoleMockup;
    expect(issuePaths(mockupSchema, withoutKind)).toEqual(['kind']);
  });

  it('отклоняет поле чужого вида: cell у console', () => {
    const result = mockupSchema.safeParse({ ...consoleMockup, cell: 'A-04-12-3' });
    expect(result.success).toBe(false);
    expect(result.error!.issues).toMatchObject([{ code: 'unrecognized_keys', keys: ['cell'] }]);
  });

  it('отклоняет опечатку в необязательном поле: units вместо unit', () => {
    const kpis = [{ label: 'Показатель', value: 1, units: 'шт.' }, consoleMockup.kpis[1]];
    const result = mockupSchema.safeParse({ ...consoleMockup, kpis });
    expect(result.success).toBe(false);
    expect(result.error!.issues).toMatchObject([{ code: 'unrecognized_keys', keys: ['units'], path: ['kpis', 0] }]);
  });

  it('держит load и progress в пределах 0…100', () => {
    const zones = (load: number) => [{ label: 'Зона 1', load }, ...consoleMockup.zones.slice(1)];
    expect(issuePaths(mockupSchema, { ...consoleMockup, zones: zones(-1) })).toEqual(['zones.0.load']);
    expect(issuePaths(mockupSchema, { ...consoleMockup, zones: zones(101) })).toEqual(['zones.0.load']);
    const waves = [{ ...consoleMockup.waves[0], progress: 101 }, consoleMockup.waves[1]];
    expect(issuePaths(mockupSchema, { ...consoleMockup, waves })).toEqual(['waves.0.progress']);
    const processes = [{ label: 'Процесс 1', load: -1 }, ...dashboard.processes.slice(1)];
    expect(issuePaths(mockupSchema, { ...dashboard, processes })).toEqual(['processes.0.load']);
  });

  it('держит trend в пределах 6…12 точек', () => {
    const withTrend = (trend: number[]) => ({ ...dashboard, kpis: [{ ...dashboard.kpis[0], trend }, dashboard.kpis[1]] });
    expect(mockupSchema.safeParse(withTrend(Array(12).fill(1))).success).toBe(true);
    expect(issuePaths(mockupSchema, withTrend(Array(5).fill(1)))).toEqual(['kpis.0.trend']);
    expect(issuePaths(mockupSchema, withTrend(Array(13).fill(1)))).toEqual(['kpis.0.trend']);
  });

  it('держит счётчики списков: nav 4…7, kpis 2…4, lines 3…6, actions 1…3, devices 1…4', () => {
    expect(issuePaths(mockupSchema, { ...consoleMockup, nav: consoleMockup.nav.slice(0, 3) })).toEqual(['nav']);
    expect(issuePaths(mockupSchema, { ...consoleMockup, kpis: consoleMockup.kpis.slice(0, 1) })).toEqual(['kpis']);
    expect(issuePaths(mockupSchema, { ...pack, lines: pack.lines.slice(0, 2) })).toEqual(['lines']);
    expect(issuePaths(mockupSchema, { ...terminal, actions: [] })).toEqual(['actions']);
    expect(issuePaths(mockupSchema, { ...pack, devices: [] })).toEqual(['devices']);
    const exceptions = Array(4).fill({ text: 'Исключение', tone: 'warn' });
    expect(issuePaths(mockupSchema, { ...consoleMockup, exceptions })).toEqual(['exceptions']);
  });

  it('отклоняет нечисловое value, дробный qty и неизвестный тон', () => {
    const kpis = [{ ...consoleMockup.kpis[0], value: '1 284' }, consoleMockup.kpis[1]];
    expect(issuePaths(mockupSchema, { ...consoleMockup, kpis })).toEqual(['kpis.0.value']);
    expect(issuePaths(mockupSchema, { ...terminal, take: { ...terminal.take, qty: 1.5 } })).toEqual(['take.qty']);
    expect(issuePaths(mockupSchema, { ...pack, devices: [{ label: 'Весы', tone: 'error' }] })).toEqual(['devices.0.tone']);
  });

  it.each([
    ['caption', LIMITS.captionMax, (v: string) => ({ ...consoleMockup, caption: v })],
    ['app', LIMITS.mockLabelMax, (v: string) => ({ ...consoleMockup, app: v })],
    ['screen', LIMITS.mockLabelMax, (v: string) => ({ ...terminal, screen: v })],
    ['nav.0', LIMITS.mockLabelMax, (v: string) => ({ ...consoleMockup, nav: [v, ...consoleMockup.nav.slice(1)] })],
    ['waves.0.status.label', LIMITS.mockLabelMax, (v: string) => ({
      ...consoleMockup,
      waves: [{ ...consoleMockup.waves[0], status: { label: v, tone: 'ok' } }, consoleMockup.waves[1]],
    })],
    ['take.unit', LIMITS.mockLabelMax, (v: string) => ({ ...terminal, take: { ...terminal.take, unit: v } })],
    ['hourly.points.0.hour', LIMITS.mockLabelMax, (v: string) => ({
      ...dashboard,
      hourly: { ...dashboard.hourly, points: [{ hour: v, value: 1 }, ...dashboard.hourly.points.slice(1)] },
    })],
    ['waves.0.code', LIMITS.mockCodeMax, (v: string) => ({
      ...consoleMockup,
      waves: [{ ...consoleMockup.waves[0], code: v }, consoleMockup.waves[1]],
    })],
    ['cell', LIMITS.mockCodeMax, (v: string) => ({ ...terminal, cell: v })],
    ['scan.last', LIMITS.mockCodeMax, (v: string) => ({ ...pack, scan: { ...pack.scan, last: v } })],
  ] as const)('ограничивает %s лимитом (%i символов)', (path, max, build) => {
    expectLimit(mockupSchema, build, max, path);
  });
});
