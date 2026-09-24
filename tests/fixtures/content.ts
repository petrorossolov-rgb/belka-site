// Записи коллекций в форме после схемы (`{ id, data, body?, filePath? }`) для тестов ядра контента.

import type { CaseLike, PageLike, ProductLike } from '../../src/lib/content-core';

export function product(
  id: string,
  data: Partial<ProductLike['data']> = {},
  body = 'Текст страницы.',
): ProductLike {
  return {
    id,
    filePath: `src/content/products/${id}.md`,
    body,
    data: { kind: 'platform', mapOrder: 1, hasPage: false, draft: false, ...data },
  };
}

export function standalone(id: string, data: Partial<ProductLike['data']> = {}): ProductLike {
  const entry = product(id, { kind: 'standalone', ...data });
  delete entry.data.mapOrder;
  return entry;
}

export function page(id: string, data: Partial<PageLike['data']> = {}): PageLike {
  return {
    id,
    filePath: `src/content/pages/${id}.md`,
    body: '',
    data: { title: `Страница ${id}`, draft: false, ...data },
  };
}

export function caseEntry(id: string, productId: string, published: boolean): CaseLike {
  return {
    id,
    filePath: `src/content/cases/${id}.md`,
    data: { published, product: { id: productId } },
  };
}

/** Набор ep01: 8 продуктов платформы вперемешку и PackApp отдельно. */
export const ep01Products: ProductLike[] = [
  product('labor', { mapOrder: 8 }),
  product('wms', { mapOrder: 1, hasPage: true, draft: true }),
  standalone('packapp'),
  product('portal', { mapOrder: 2 }),
  product('billing', { mapOrder: 7 }),
  product('yms', { mapOrder: 3 }),
  product('analytics', { mapOrder: 6 }),
  product('tms', { mapOrder: 4 }),
  product('oms', { mapOrder: 5 }),
];
