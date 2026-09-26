// Шесть коллекций контента. Схемы — в `src/lib/schemas.ts`; здесь только лоадеры
// и то, что доступно лишь из `astro:content`: `reference()` и `image()`.

import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { blockSchema, caseSchema, mockupSchema, pageSchema, productSchema, siteSchema } from './lib/schemas';

// Id записи = путь файла без расширения (`legal/privacy.md` → `legal/privacy`,
// `wms-console.yaml` → `wms-console`). Стандартный slugify молча понижает регистр и
// учитывает `slug` из frontmatter — тогда проверка формата id в `assertContentIntegrity`
// не увидела бы нарушение.
const entries = (base: string, extension: 'md' | 'yaml') =>
  glob({
    pattern: `**/*.${extension}`,
    base,
    generateId: ({ entry }) => entry.slice(0, -`.${extension}`.length),
  });
const markdown = (base: string) => entries(base, 'md');

const products = defineCollection({
  loader: markdown('./src/content/products'),
  schema: ({ image }) => productSchema(image, reference),
});

const cases = defineCollection({
  loader: markdown('./src/content/cases'),
  schema: caseSchema.extend({ product: reference('products') }),
});

const pages = defineCollection({
  loader: markdown('./src/content/pages'),
  schema: ({ image }) => pageSchema(image, reference),
});

// Секции страниц и продуктов: `sections` ссылается на них по id.
const blocks = defineCollection({
  loader: markdown('./src/content/blocks'),
  schema: blockSchema(reference),
});

// Экраны продуктов на демо-данных; на страницу их ставит пункт блока `view: surfaces`.
const mockups = defineCollection({
  loader: entries('./src/content/mockups', 'yaml'),
  schema: mockupSchema,
});

const site = defineCollection({
  loader: file('./src/content/site.yaml'),
  schema: ({ image }) => siteSchema(image),
});

export const collections = { products, cases, pages, blocks, mockups, site };
