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
// если у него появится refine, он станет фабрикой, как `pageSchema`. `mockupSchema` без
// `image()` и `reference()` — обычная схема, не фабрика.

import { z } from 'astro/zod';

/** `image()` из контекста схемы коллекции; в тестах — `() => z.string()`. */
export type ImageFn<I extends z.ZodType = z.ZodType> = () => I;

/** `reference()` из `astro:content`; в тестах — `() => z.string()`. */
export type ReferenceFn<R extends z.ZodType = z.ZodType> = (
  collection: 'pages' | 'blocks' | 'mockups' | 'products',
) => R;

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
export const BLOCK_VIEWS = ['text', 'cards', 'steps', 'list', 'platform-map', 'products', 'surfaces'] as const;

/** Виды с пунктами (`items`): хотя бы один пункт. У остальных пунктов нет. */
const VIEWS_WITH_ITEMS: readonly BlockView[] = ['cards', 'steps', 'list', 'surfaces'];
/** Виды, у которых каждый пункт — карточка с текстом. */
const VIEWS_WITH_ITEM_TEXT: readonly BlockView[] = ['cards', 'steps', 'surfaces'];
/** Поля пункта, которые бывают только у `view: surfaces` — и там обязательны. */
const SURFACE_ITEM_FIELDS = ['mockup', 'product'] as const;

/**
 * Вид мокапа — компонент кита, которым выводится экран (`src/content/mockups/{id}.yaml`).
 * Карта компонентов `MOCKUP_KINDS` живёт в ките; здесь — только список значений.
 */
export const MOCKUP_KIND_NAMES = ['console', 'terminal', 'pack', 'dashboard'] as const;

/** Тон статуса в мокапе: цвет пилюли, строки исключения, устройства. */
export const MOCK_TONES = ['ok', 'warn', 'risk', 'neutral'] as const;

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
  /** `alt` OG-картинки страницы, продукта и сайта. */
  altMax: 120,
  /** Русское пояснение имени продукта («система управления складом»). */
  descriptorMax: 60,
  /** Подпись фигуры мокапа; к ней кит добавляет `site.mockupNote`. */
  captionMax: 160,
  /** Любая подпись внутри мокапа: заголовок окна и экрана, KPI, строка, кнопка. */
  mockLabelMax: 28,
  /** Код внутри мокапа: волна, ячейка, заказ, артикул. */
  mockCodeMax: 16,
  /** Подпись о демо-данных у каждой фигуры (`site.mockupNote`). */
  mockupNoteMax: 60,
} as const;

// E.164: «+», код страны без ведущего нуля, всего до 15 цифр.
const PHONE_E164 = /^\+[1-9]\d{1,14}$/;
const TELEGRAM_URL = /^https:\/\/t\.me\//;
const INN = /^(\d{10}|\d{12})$/;
const OGRN = /^(\d{13}|\d{15})$/;
const COUNTER_ID = /^\d+$/;

export const productSchema = <I extends z.ZodType, R extends z.ZodType>(
  image: ImageFn<I>,
  reference: ReferenceFn<R>,
) =>
  z
    .object({
      name: z.string().startsWith(PRODUCT_NAME_PREFIX, {
        message: `имя продукта начинается с «${PRODUCT_NAME_PREFIX}»`,
      }),
      nameRu: z.string().optional(),
      // Русское пояснение латинского имени (Constitution 3): `h1` и `<title>` страницы продукта,
      // подпись пункта `surfaces`. Где оно обязательно — решает целостность, а не схема.
      descriptor: z.string().min(1).max(LIMITS.descriptorMax).optional(),
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
      // Страница продукта — герой и секции-блоки; тела у продукта со страницей нет (целостность).
      sections: z.array(reference('blocks')).default([]),
      ogImage: image().optional(),
      ogImageAlt: z.string().min(1).max(LIMITS.altMax).optional(),
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
    })
    .refine((p) => p.ogImage === undefined || p.ogImageAlt !== undefined, {
      message: 'у ogImage должен быть ogImageAlt',
      path: ['ogImageAlt'],
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
            // Только у `view: surfaces`: экран и продукт, под именем которого он показан.
            mockup: reference('mockups').optional(),
            product: reference('products').optional(),
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
      b.items.forEach((item, i) => {
        for (const field of SURFACE_ITEM_FIELDS) {
          if (b.view === 'surfaces' && item[field] === undefined) {
            ctx.addIssue({ code: 'custom', message: `у view: surfaces у каждого пункта есть ${field}`, path: ['items', i, field] });
          } else if (b.view !== 'surfaces' && item[field] !== undefined) {
            ctx.addIssue({ code: 'custom', message: `${field} в пункте бывает только у view: surfaces`, path: ['items', i, field] });
          }
        }
      });
    });

// Мокап — экран продукта на демо-данных (`src/content/mockups/{id}.yaml`). Объекты строгие:
// опечатка в имени необязательного поля (`units` вместо `unit`) — ошибка, а не молча
// выброшенное значение. Числа — числами: форму (разряды, проценты, запятую) даёт кит
// (`src/lib/mock-format.ts`), коды — строками. Лимиты длин держат вёрстку на 360px без
// многоточий и прокрутки внутри фигуры.
const mockLabel = z.string().min(1).max(LIMITS.mockLabelMax);
const mockCode = z.string().min(1).max(LIMITS.mockCodeMax);
const mockPercent = z.number().min(0).max(100);
const mockCount = z.int().nonnegative();
const mockTone = z.enum(MOCK_TONES);
const mockStatus = z.strictObject({ label: mockLabel, tone: mockTone });

const mockupBase = {
  caption: z.string().min(1).max(LIMITS.captionMax),
  app: mockLabel,
  screen: mockLabel,
};

export const mockupSchema = z.discriminatedUnion('kind', [
  // Веб-консоль WMS: «Монитор склада».
  z.strictObject({
    kind: z.literal('console'),
    ...mockupBase,
    nav: z.array(mockLabel).min(4).max(7),
    kpis: z
      .array(z.strictObject({ label: mockLabel, value: z.number(), unit: mockLabel.optional() }))
      .min(2)
      .max(4),
    zones: z.array(z.strictObject({ label: mockLabel, load: mockPercent })).min(3).max(6),
    waves: z
      .array(z.strictObject({ code: mockCode, status: mockStatus, progress: mockPercent }))
      .min(2)
      .max(4),
    exceptions: z.array(z.strictObject({ text: mockLabel, tone: mockTone })).max(3).default([]),
  }),
  // ТСД: шаг отбора.
  z.strictObject({
    kind: z.literal('terminal'),
    ...mockupBase,
    step: z.strictObject({ code: mockCode, label: mockLabel }),
    cell: mockCode,
    item: z.strictObject({ label: mockLabel, code: mockCode }),
    take: z.strictObject({ label: mockLabel, qty: mockCount, unit: mockLabel }),
    progress: z.strictObject({ done: mockCount, total: mockCount }),
    scan: mockLabel,
    actions: z.array(mockLabel).min(1).max(3),
  }),
  // Упаковочный стол WMS.
  z.strictObject({
    kind: z.literal('pack'),
    ...mockupBase,
    order: z.strictObject({ label: mockLabel, code: mockCode }),
    scan: z.strictObject({ label: mockLabel, last: mockCode }),
    place: z.strictObject({ label: mockLabel, code: mockCode, weight: z.number().nonnegative(), unit: mockLabel }),
    lines: z
      .array(z.strictObject({ label: mockLabel, code: mockCode, qty: mockCount, packed: mockCount }))
      .min(3)
      .max(6),
    devices: z.array(z.strictObject({ label: mockLabel, tone: mockTone })).min(1).max(4),
  }),
  // Дашборд Belka Analytics: «Операции».
  z.strictObject({
    kind: z.literal('dashboard'),
    ...mockupBase,
    period: mockLabel,
    kpis: z
      .array(
        z.strictObject({
          label: mockLabel,
          value: z.number(),
          unit: mockLabel.optional(),
          trend: z.array(z.number()).min(6).max(12),
        }),
      )
      .min(2)
      .max(4),
    hourly: z.strictObject({
      label: mockLabel,
      points: z
        .array(z.strictObject({ hour: mockLabel, value: z.number().nonnegative() }))
        .min(6)
        .max(12),
    }),
    processes: z.array(z.strictObject({ label: mockLabel, load: mockPercent })).min(3).max(6),
  }),
]);

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
      // Подпись о демо-данных: кит выводит её у каждой фигуры. Обязательна, если на сайте
      // есть мокап (правило целостности).
      mockupNote: z.string().min(1).max(LIMITS.mockupNoteMax).optional(),
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

export type ProductData = z.output<ReturnType<typeof productSchema<z.ZodType, z.ZodType>>>;
export type CaseData = z.output<typeof caseSchema>;
export type BlockView = (typeof BLOCK_VIEWS)[number];
export type PageData = z.output<ReturnType<typeof pageSchema<z.ZodType, z.ZodType>>>;
export type BlockData = z.output<ReturnType<typeof blockSchema<z.ZodType>>>;
export type SiteData = z.output<ReturnType<typeof siteSchema<z.ZodType>>>;
export type MockupData = z.output<typeof mockupSchema>;
export type MockupKind = (typeof MOCKUP_KIND_NAMES)[number];
export type MockTone = (typeof MOCK_TONES)[number];
