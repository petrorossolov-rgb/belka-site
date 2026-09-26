import { describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import {
  BLOCK_VIEWS,
  LIMITS,
  blockSchema,
  caseSchema,
  pageSchema,
  productSchema,
  siteSchema,
} from '../src/lib/schemas';
import {
  validCardsBlock,
  validCase,
  validPage,
  validPlatformProduct,
  validSite,
  validSiteWithMetrika,
  validStandaloneProduct,
} from './fixtures/schemas';

// `image()` и `reference()` есть только у Astro — в тестах их заменяют строки.
const image = () => z.string();
const reference = () => z.string();
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

  it('виды секций', () => {
    expect(BLOCK_VIEWS).toEqual(['text', 'cards', 'steps', 'list', 'platform-map', 'products']);
  });
});

describe('product', () => {
  it('принимает продукт платформы и отдельный продукт', () => {
    expect(productSchema.parse(validPlatformProduct)).toMatchObject({ kind: 'platform', mapOrder: 1 });
    expect(productSchema.parse(validStandaloneProduct)).toMatchObject({ kind: 'standalone' });
  });

  it('подставляет значения по умолчанию: hasPage, pageDraft, featured и draft — false', () => {
    const parsed = productSchema.parse(validStandaloneProduct);
    expect(parsed).toMatchObject({ hasPage: false, pageDraft: false, featured: false, draft: false });
    expect(parsed.lead).toBeUndefined();
  });

  it('принимает карточку на главной с lead', () => {
    const parsed = productSchema.parse({ ...validStandaloneProduct, featured: true, lead: 'Текст карточки.' });
    expect(parsed).toMatchObject({ featured: true, lead: 'Текст карточки.' });
  });

  it('отклоняет featured без lead', () => {
    expect(issuePaths(productSchema, { ...validStandaloneProduct, featured: true })).toEqual(['lead']);
  });

  it('принимает lead без featured', () => {
    expect(productSchema.safeParse({ ...validStandaloneProduct, lead: 'Лид страницы.' }).success).toBe(true);
  });

  it('ограничивает lead лимитом leadMax', () => {
    expectLimit(productSchema, (lead) => ({ ...validStandaloneProduct, lead }), LIMITS.leadMax, 'lead');
  });

  it('принимает черновую страницу у продукта со страницей', () => {
    const parsed = productSchema.parse({ ...validPlatformProduct, draft: false, pageDraft: true });
    expect(parsed).toMatchObject({ hasPage: true, pageDraft: true, draft: false });
  });

  it('отклоняет pageDraft без hasPage — и явный false, и по умолчанию', () => {
    expect(issuePaths(productSchema, { ...validPlatformProduct, hasPage: false, pageDraft: true })).toEqual(['pageDraft']);
    expect(issuePaths(productSchema, { ...validStandaloneProduct, pageDraft: true })).toEqual(['pageDraft']);
  });

  it('отклоняет неверный kind', () => {
    expect(issuePaths(productSchema, { ...validStandaloneProduct, kind: 'module' })).toContain('kind');
  });

  it('отклоняет платформенный продукт без mapOrder', () => {
    const { mapOrder: _, ...withoutOrder } = validPlatformProduct;
    expect(issuePaths(productSchema, withoutOrder)).toEqual(['mapOrder']);
  });

  it('отклоняет отдельный продукт с mapOrder', () => {
    expect(issuePaths(productSchema, { ...validStandaloneProduct, mapOrder: 9 })).toEqual(['mapOrder']);
  });

  it('отклоняет mapOrder не больше нуля и дробный', () => {
    expect(issuePaths(productSchema, { ...validPlatformProduct, mapOrder: 0 })).toContain('mapOrder');
    expect(issuePaths(productSchema, { ...validPlatformProduct, mapOrder: 1.5 })).toContain('mapOrder');
  });

  it('отклоняет имя без префикса «Belka »', () => {
    expect(issuePaths(productSchema, { ...validPlatformProduct, name: 'WMS' })).toContain('name');
    expect(issuePaths(productSchema, { ...validPlatformProduct, name: 'BelkaWMS' })).toContain('name');
  });

  it('ограничивает summary 140 символами', () => {
    expect(productSchema.safeParse({ ...validPlatformProduct, summary: 'я'.repeat(140) }).success).toBe(true);
    expect(issuePaths(productSchema, { ...validPlatformProduct, summary: 'я'.repeat(141) })).toContain('summary');
  });

  it('отклоняет неизвестные domain и readiness', () => {
    const paths = issuePaths(productSchema, { ...validPlatformProduct, domain: 'retail', readiness: 'done' });
    expect(paths).toEqual(expect.arrayContaining(['domain', 'readiness']));
  });

  it('ограничивает seo.title 60 и seo.description 160 символами', () => {
    const paths = issuePaths(productSchema, {
      ...validPlatformProduct,
      seo: { title: 'я'.repeat(61), description: 'я'.repeat(161) },
    });
    expect(paths).toEqual(expect.arrayContaining(['seo.title', 'seo.description']));
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
});
