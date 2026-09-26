// Записи коллекций в форме после схемы (`{ id, data, body?, filePath? }`) для тестов ядра контента.

import type { BlockLike, CaseLike, ImageMetaLike, MockupLike, PageLike, ProductLike } from '../../src/lib/content-core';

/** Продукт без тела: у продукта со страницей (`hasPage`) тела нет (ep03). */
export function product(id: string, data: Partial<ProductLike['data']> = {}, body = ''): ProductLike {
  return {
    id,
    filePath: `src/content/products/${id}.md`,
    body,
    data: { name: `Belka ${id}`, kind: 'platform', mapOrder: 1, hasPage: false, draft: false, ...data },
  };
}

export function standalone(id: string, data: Partial<ProductLike['data']> = {}): ProductLike {
  const entry = product(id, { kind: 'standalone', ...data });
  delete entry.data.mapOrder;
  return entry;
}

/** Продукт с видимой страницей: пояснение, лид и секция `wms-scope` (блок — в наборе теста). */
export function pageProduct(id: string, data: Partial<ProductLike['data']> = {}, body = ''): ProductLike {
  return product(
    id,
    { hasPage: true, descriptor: 'пояснение имени', lead: 'Лид страницы.', sections: refs('wms-scope'), ...data },
    body,
  );
}

export function page(id: string, data: Partial<PageLike['data']> = {}): PageLike {
  return {
    id,
    filePath: `src/content/pages/${id}.md`,
    body: '',
    data: { title: `Страница ${id}`, draft: false, ...data },
  };
}

/** Блок: по умолчанию `view: cards` без тела; у `view: text` тело передаётся явно. */
export function block(id: string, data: Partial<BlockLike['data']> = {}, body = ''): BlockLike {
  return {
    id,
    filePath: `src/content/blocks/${id}.md`,
    body,
    data: { view: 'cards', draft: false, ...data },
  };
}

export function mockup(id: string, kind: MockupLike['data']['kind'] = 'console'): MockupLike {
  return { id, filePath: `src/content/mockups/${id}.yaml`, data: { kind } };
}

/** Пункт `view: surfaces`: ссылки на мокап и продукт в форме `reference()`. */
export function surface(mockupId: string, productId: string) {
  return { mockup: { id: mockupId }, product: { id: productId } };
}

/** Метаданные `image()` в сборке; по умолчанию — правильная OG-карточка. */
export function og(format = 'png', width = 1200, height = 630): ImageMetaLike & { src: string } {
  return { src: `/_astro/og.${format}`, format, width, height };
}

/** Ссылки `sections` в форме `reference()`. */
export function refs(...ids: string[]): { id: string }[] {
  return ids.map((id) => ({ id }));
}

export function caseEntry(id: string, productId: string, published: boolean): CaseLike {
  return {
    id,
    filePath: `src/content/cases/${id}.md`,
    data: { published, product: { id: productId } },
  };
}

/** Блок `wms-scope`, на который ссылается `pageProduct`. */
export const wmsScope: BlockLike = block('wms-scope', { view: 'list' });

/** Набор ep01: 8 продуктов платформы вперемешку и PackApp отдельно. */
export const ep01Products: ProductLike[] = [
  product('labor', { mapOrder: 8 }),
  pageProduct('wms', { mapOrder: 1, draft: true }),
  standalone('packapp'),
  product('portal', { mapOrder: 2 }),
  product('billing', { mapOrder: 7 }),
  product('yms', { mapOrder: 3 }),
  product('analytics', { mapOrder: 6 }),
  product('tms', { mapOrder: 4 }),
  product('oms', { mapOrder: 5 }),
];
