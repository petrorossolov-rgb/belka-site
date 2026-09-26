// Схемы коллекций контента — источник истины «продукт — это файл» (Constitution 2).
// Модуль не импортирует `astro:*`, поэтому тесты читают его напрямую.
//
// `image()` и `reference()` есть только в `astro:content`. Схемы с такими полями —
// фабрики: `content.config.ts` передаёт настоящие функции, тесты — `() => z.string()`.
// Refine навешивается внутри фабрики последним шагом. Zod 4 бросает ошибку на
// `.extend()` у схемы с refine; `.safeExtend()` refine наследует, но тогда поля и их
// значения по умолчанию (`sections: []`) жили бы в `content.config.ts`, вне тестов
// схем. Поэтому ссылки на коллекции — параметр фабрики, а не `.extend` снаружи.
// `caseSchema` без refine и по-прежнему расширяется `.extend` в `content.config.ts`;
// если у него появится refine, он станет фабрикой, как `pageSchema`.

import { z } from 'astro/zod';

/** `image()` из контекста схемы коллекции; в тестах — `() => z.string()`. */
export type ImageFn<I extends z.ZodType = z.ZodType> = () => I;

/** `reference()` из `astro:content`; в тестах — `() => z.string()`. */
export type ReferenceFn<R extends z.ZodType = z.ZodType> = (collection: 'pages' | 'blocks') => R;

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

/** Вид секции — компонент, которым она выводится на странице. */
export const BLOCK_VIEWS = ['text', 'cards', 'steps', 'list', 'platform-map', 'products'] as const;

/** Виды с пунктами (`items`): хотя бы один пункт. У остальных пунктов нет. */
const VIEWS_WITH_ITEMS: readonly BlockView[] = ['cards', 'steps', 'list'];
/** Виды, у которых каждый пункт — карточка с текстом. */
const VIEWS_WITH_ITEM_TEXT: readonly BlockView[] = ['cards', 'steps'];

export const PRODUCT_NAME_PREFIX = 'Belka ';

export const LIMITS = {
  summaryMax: 140,
  titleMax: 60,
  descriptionMin: 50,
  descriptionMax: 160,
  /** `h1` страницы (`hero.heading`), заголовок секции и её пункта. */
  headingMax: 80,
  eyebrowMax: 60,
  /** Лид секции и карточки продукта, текст пункта. */
  leadMax: 320,
  linkLabelMax: 40,
  /** `alt` OG-картинки страницы и сайта. */
  altMax: 120,
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
    // Черновая страница видимого продукта: продукт на карте и в карточке, страница — только
    // там, где черновики видны.
    pageDraft: z.boolean().default(false),
    // Карточка на главной (`view: products`); её текст — `lead`.
    featured: z.boolean().default(false),
    lead: z.string().min(1).max(LIMITS.leadMax).optional(),
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
  })
  .refine((p) => !p.featured || p.lead !== undefined, {
    message: 'карточка на главной (featured) требует lead',
    path: ['lead'],
  })
  .refine((p) => !p.pageDraft || p.hasPage, {
    message: 'черновая страница (pageDraft) бывает только у продукта со страницей (hasPage)',
    path: ['pageDraft'],
  });

/** Без поля `product`: его добавляет `content.config.ts` (`reference('products')`). */
export const caseSchema = z.object({
  title: z.string().min(1),
  clientLabel: z.string().min(1),
  published: z.boolean().default(false),
});

export const pageSchema = <I extends z.ZodType, R extends z.ZodType>(
  image: ImageFn<I>,
  reference: ReferenceFn<R>,
) =>
  z
    .object({
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
      ogImageAlt: z.string().min(1).max(LIMITS.altMax).optional(),
      hero: z
        .object({
          // `h1`, если он отличается от `title` (404: title «Страница не найдена»).
          heading: z.string().min(1).max(LIMITS.headingMax).optional(),
          eyebrow: z.string().optional(),
          lead: z.string().optional(),
          accent: z.string().optional(),
          note: z.string().optional(),
        })
        .optional(),
      // Секции — записи `blocks`; порядок в списке = порядок на странице.
      sections: z.array(reference('blocks')).default([]),
      draft: z.boolean().default(false),
    })
    .refine((p) => p.ogImage === undefined || p.ogImageAlt !== undefined, {
      message: 'у ogImage должен быть ogImageAlt',
      path: ['ogImageAlt'],
    });

/** Секция страницы (`src/content/blocks/{id}.md`); тело Markdown — только у `view: text`. */
export const blockSchema = <R extends z.ZodType>(reference: ReferenceFn<R>) =>
  z
    .object({
      view: z.enum(BLOCK_VIEWS),
      eyebrow: z.string().min(1).max(LIMITS.eyebrowMax).optional(),
      title: z.string().min(1).max(LIMITS.headingMax),
      lead: z.string().min(1).max(LIMITS.leadMax).optional(),
      items: z
        .array(
          z.object({
            title: z.string().min(1).max(LIMITS.headingMax),
            text: z.string().min(1).max(LIMITS.leadMax).optional(),
          }),
        )
        .default([]),
      // Выводится, только если целевая страница видима в текущем окружении.
      link: z
        .object({
          page: reference('pages'),
          label: z.string().min(1).max(LIMITS.linkLabelMax),
        })
        .optional(),
      draft: z.boolean().default(false),
    })
    .superRefine((b, ctx) => {
      if (VIEWS_WITH_ITEMS.includes(b.view)) {
        if (b.items.length === 0) {
          ctx.addIssue({ code: 'custom', message: `у view: ${b.view} нужен хотя бы один пункт`, path: ['items'] });
        }
      } else if (b.items.length > 0) {
        ctx.addIssue({ code: 'custom', message: `у view: ${b.view} пунктов нет — они не выводятся`, path: ['items'] });
      }
      if (VIEWS_WITH_ITEM_TEXT.includes(b.view)) {
        b.items.forEach((item, i) => {
          if (item.text === undefined) {
            ctx.addIssue({ code: 'custom', message: `у view: ${b.view} у каждого пункта есть text`, path: ['items', i, 'text'] });
          }
        });
      }
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
          defaultOgImageAlt: z.string().min(1).max(LIMITS.altMax).optional(),
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
    )
    .refine((s) => s.seo.defaultOgImage === undefined || s.seo.defaultOgImageAlt !== undefined, {
      message: 'у seo.defaultOgImage должен быть seo.defaultOgImageAlt',
      path: ['seo', 'defaultOgImageAlt'],
    });

export type ProductData = z.output<typeof productSchema>;
export type CaseData = z.output<typeof caseSchema>;
export type BlockView = (typeof BLOCK_VIEWS)[number];
export type PageData = z.output<ReturnType<typeof pageSchema<z.ZodType, z.ZodType>>>;
export type BlockData = z.output<ReturnType<typeof blockSchema<z.ZodType>>>;
export type SiteData = z.output<ReturnType<typeof siteSchema<z.ZodType>>>;
