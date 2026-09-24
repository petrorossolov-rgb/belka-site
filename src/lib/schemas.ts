// Схемы коллекций контента — источник истины «продукт — это файл» (Constitution 2).
// Модуль не импортирует `astro:*`, поэтому тесты читают его напрямую.
// `reference('products')` для кейса добавляет `content.config.ts` через `.extend`;
// поля-картинки строятся из `image()` коллекции: схемы с ними — фабрики.

import { z } from 'astro/zod';

/** `image()` из контекста схемы коллекции; в тестах — `() => z.string()`. */
export type ImageFn<I extends z.ZodType = z.ZodType> = () => I;

export const PRODUCT_DOMAINS = [
  'warehouse',
  'yard',
  'transport',
  'orders',
  'portal',
  'analytics',
  'billing',
  'labor',
  'packing',
] as const;

export const PRODUCT_KINDS = ['platform', 'standalone'] as const;

export const PRODUCT_READINESS = ['planned', 'in-development', 'pilot', 'available'] as const;

export const NAV_PLACEMENTS = ['header', 'footer'] as const;

export const PRODUCT_NAME_PREFIX = 'Belka ';

export const LIMITS = {
  summaryMax: 140,
  titleMax: 60,
  descriptionMin: 50,
  descriptionMax: 160,
} as const;

// E.164: «+», код страны без ведущего нуля, всего до 15 цифр.
const PHONE_E164 = /^\+[1-9]\d{1,14}$/;
const TELEGRAM_URL = /^https:\/\/t\.me\//;
const INN = /^(\d{10}|\d{12})$/;
const OGRN = /^(\d{13}|\d{15})$/;
const COUNTER_ID = /^\d+$/;

export const productSchema = z
  .object({
    name: z.string().startsWith(PRODUCT_NAME_PREFIX, {
      message: `имя продукта начинается с «${PRODUCT_NAME_PREFIX}»`,
    }),
    nameRu: z.string().optional(),
    short: z.string().min(1),
    domain: z.enum(PRODUCT_DOMAINS),
    kind: z.enum(PRODUCT_KINDS),
    summary: z.string().min(1).max(LIMITS.summaryMax),
    mapOrder: z.int().positive().optional(),
    hasPage: z.boolean().default(false),
    // Скрытое поле: выводится только при `site.flags.showReadiness` (Constitution 1).
    readiness: z.enum(PRODUCT_READINESS),
    draft: z.boolean().default(false),
    seo: z
      .object({
        title: z.string().max(LIMITS.titleMax).optional(),
        description: z.string().max(LIMITS.descriptionMax).optional(),
      })
      .optional(),
    mockup: z.string().optional(),
  })
  .refine((p) => p.kind !== 'platform' || p.mapOrder !== undefined, {
    message: 'продукт платформы (kind: platform) должен иметь место на карте',
    path: ['mapOrder'],
  })
  .refine((p) => p.kind !== 'standalone' || p.mapOrder === undefined, {
    message: 'отдельный продукт (kind: standalone) не стоит на карте платформы',
    path: ['mapOrder'],
  });

/** Без поля `product`: его добавляет `content.config.ts` (`reference('products')`). */
export const caseSchema = z.object({
  title: z.string().min(1),
  clientLabel: z.string().min(1),
  published: z.boolean().default(false),
});

export const pageSchema = <I extends z.ZodType>(image: ImageFn<I>) =>
  z.object({
    title: z.string().min(1).max(LIMITS.titleMax),
    description: z.string().min(LIMITS.descriptionMin).max(LIMITS.descriptionMax),
    nav: z
      .object({
        label: z.string().min(1).optional(),
        order: z.int(),
        placement: z.enum(NAV_PLACEMENTS),
      })
      .optional(),
    ogImage: image().optional(),
    hero: z
      .object({
        eyebrow: z.string().optional(),
        lead: z.string().optional(),
        accent: z.string().optional(),
        note: z.string().optional(),
      })
      .optional(),
    draft: z.boolean().default(false),
  });

export const siteSchema = <I extends z.ZodType>(image: ImageFn<I>) =>
  z
    .object({
      name: z.string().min(1),
      nameRu: z.string().optional(),
      slogan: z.string().min(1),
      url: z.url({ protocol: /^https$/ }),
      contacts: z
        .object({
          email: z.email().optional(),
          phone: z.string().regex(PHONE_E164, 'формат E.164, например +79990000000').optional(),
          telegram: z.url().regex(TELEGRAM_URL, 'ссылка вида https://t.me/…').optional(),
        })
        .default({}),
      legal: z
        .object({
          entityName: z.string().min(1).optional(),
          inn: z.string().regex(INN, '10 или 12 цифр').optional(),
          ogrn: z.string().regex(OGRN, '13 или 15 цифр').optional(),
          address: z.string().min(1).optional(),
          piiOperator: z.string().min(1).optional(),
        })
        .default({}),
      flags: z.object({
        legalEntityReady: z.boolean(),
        metrikaEnabled: z.boolean(),
        showReadiness: z.boolean(),
      }),
      metrika: z
        .object({
          counterId: z.string().regex(COUNTER_ID, 'только цифры').optional(),
        })
        .default({}),
      seo: z
        .object({
          defaultOgImage: image().optional(),
        })
        .default({}),
    })
    // Constitution 4: Метрика — только при включённом флаге юрлица и заданном счётчике.
    .refine(
      (s) => !s.flags.metrikaEnabled || (s.flags.legalEntityReady && s.metrika.counterId !== undefined),
      {
        message: 'Метрика требует legalEntityReady и metrika.counterId',
        path: ['flags', 'metrikaEnabled'],
      },
    )
    .refine(
      (s) => !s.flags.legalEntityReady || (s.legal.entityName !== undefined && s.legal.inn !== undefined),
      {
        message: 'нужны legal.entityName и legal.inn',
        path: ['flags', 'legalEntityReady'],
      },
    );

export type ProductData = z.output<typeof productSchema>;
export type CaseData = z.output<typeof caseSchema>;
export type PageData = z.output<ReturnType<typeof pageSchema<z.ZodType>>>;
export type SiteData = z.output<ReturnType<typeof siteSchema<z.ZodType>>>;
