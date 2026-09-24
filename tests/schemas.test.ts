import { describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import { caseSchema, pageSchema, productSchema, siteSchema } from '../src/lib/schemas';
import {
  validCase,
  validPage,
  validPlatformProduct,
  validSite,
  validSiteWithMetrika,
  validStandaloneProduct,
} from './fixtures/schemas';

// `image()` и `reference()` есть только у Astro — в тестах их заменяют строки.
const image = () => z.string();
const page = pageSchema(image);
const site = siteSchema(image);
const caseWithProduct = caseSchema.extend({ product: z.string() });

/** Пути полей, на которые указывают ошибки валидации. */
function issuePaths(schema: z.ZodType, data: unknown): string[] {
  const result = schema.safeParse(data);
  expect(result.success, 'ожидалась ошибка валидации').toBe(false);
  return result.error!.issues.map((issue) => issue.path.join('.'));
}

describe('product', () => {
  it('принимает продукт платформы и отдельный продукт', () => {
    expect(productSchema.parse(validPlatformProduct)).toMatchObject({ kind: 'platform', mapOrder: 1 });
    expect(productSchema.parse(validStandaloneProduct)).toMatchObject({ kind: 'standalone' });
  });

  it('подставляет значения по умолчанию: hasPage и draft — false', () => {
    const parsed = productSchema.parse(validStandaloneProduct);
    expect(parsed.hasPage).toBe(false);
    expect(parsed.draft).toBe(false);
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

  it('требует https в url', () => {
    expect(issuePaths(site, { ...validSite, url: 'http://belkascm.ru' })).toEqual(['url']);
  });
});
