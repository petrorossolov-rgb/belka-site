// Пять коллекций контента. Схемы — в `src/lib/schemas.ts`; здесь только лоадеры
// и то, что доступно лишь из `astro:content`: `reference()` и `image()`.

import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { blockSchema, caseSchema, pageSchema, productSchema, siteSchema } from './lib/schemas';

// Id записи = путь файла без расширения (`legal/privacy.md` → `legal/privacy`).
// Стандартный slugify молча понижает регистр и учитывает `slug` из frontmatter —
// тогда проверка формата id в `assertContentIntegrity` не увидела бы нарушение.
const markdown = (base: string) =>
  glob({ pattern: '**/*.md', base, generateId: ({ entry }) => entry.replace(/\.md$/, '') });

const products = defineCollection({
  loader: markdown('./src/content/products'),
  schema: productSchema,
});

const cases = defineCollection({
  loader: markdown('./src/content/cases'),
  schema: caseSchema.extend({ product: reference('products') }),
});

const pages = defineCollection({
  loader: markdown('./src/content/pages'),
  schema: ({ image }) => pageSchema(image, reference),
});

// Секции страниц: `page.sections` ссылается на них по id.
const blocks = defineCollection({
  loader: markdown('./src/content/blocks'),
  schema: blockSchema(reference),
});

const site = defineCollection({
  loader: file('./src/content/site.yaml'),
  schema: ({ image }) => siteSchema(image),
});

export const collections = { products, cases, pages, blocks, site };
