// Чистое ядро контента: видимость, навигация, карта платформы, целостность набора.
// Без импорта `astro:*` — работает на любых объектах вида `{ id, data, body? }`,
// поэтому тесты не поднимают Astro. Доступ к коллекциям — только `src/lib/content.ts`.

import type { SiteEnv } from './site-env';

/** Формат id записи (и каждого сегмента вложенного id страницы). */
export const ENTRY_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type NavPlacement = 'header' | 'footer';

export interface NavItem {
  href: string;
  label: string;
  order: number;
}

interface EntryLike<D> {
  id: string;
  data: D;
  body?: string | undefined;
  filePath?: string | undefined;
}

export type VisibilityEntry = EntryLike<{ draft?: boolean | undefined; published?: boolean | undefined }>;

export type ProductLike = EntryLike<{
  kind: 'platform' | 'standalone';
  mapOrder?: number | undefined;
  hasPage: boolean;
  draft: boolean;
}>;

export type PageLike = EntryLike<{
  title: string;
  nav?: { label?: string | undefined; order: number; placement: NavPlacement } | undefined;
  draft: boolean;
}>;

export type CaseLike = EntryLike<{ published: boolean; product: { id: string } }>;

/** Стейджинг и локальная разработка показывают черновики; прод — нет. */
export function showsDrafts(env: SiteEnv): boolean {
  return env !== 'production';
}

/**
 * `draft: true` скрыт в `production`; запись с `published: false` (кейс) скрыта везде —
 * кейс виден только опубликованным (Constitution 1).
 */
export function filterVisible<E extends VisibilityEntry>(entries: readonly E[], env: SiteEnv): E[] {
  return entries.filter((entry) => {
    if (entry.data.published === false) return false;
    if (entry.data.draft === true && !showsDrafts(env)) return false;
    return true;
  });
}

/** `index` → `/`, остальные — `/{id}/` (вложенные id — вложенные пути). */
export function pageHref(id: string): string {
  return id === 'index' ? '/' : `/${id}/`;
}

export function productHref(id: string): string {
  return `/products/${id}/`;
}

/**
 * Пункты меню из страниц с `nav` нужного `placement`, по `order`, затем по id.
 * Страницы должны прийти уже отфильтрованными `filterVisible`.
 */
export function buildNav(pages: readonly PageLike[], placement: NavPlacement): NavItem[] {
  return pages
    .flatMap((page) => {
      const nav = page.data.nav;
      if (nav === undefined || nav.placement !== placement) return [];
      return [{ id: page.id, item: { href: pageHref(page.id), label: nav.label ?? page.data.title, order: nav.order } }];
    })
    .sort((a, b) => a.item.order - b.item.order || a.id.localeCompare(b.id))
    .map(({ item }) => item);
}

/** Продукты платформы по `mapOrder`. */
export function getPlatformMap<P extends ProductLike>(products: readonly P[]): P[] {
  return products
    .filter((p) => p.data.kind === 'platform')
    .sort((a, b) => (a.data.mapOrder ?? 0) - (b.data.mapOrder ?? 0));
}

/** Отдельные продукты (вне карты платформы), по id. */
export function getStandaloneProducts<P extends ProductLike>(products: readonly P[]): P[] {
  return products.filter((p) => p.data.kind === 'standalone').sort((a, b) => a.id.localeCompare(b.id));
}

/** Поля `site`, из которых собирается подвал; группы могут отсутствовать. */
export interface FooterSiteLike {
  contacts?:
    | { email?: string | undefined; phone?: string | undefined; telegram?: string | undefined }
    | undefined;
  legal?:
    | {
        entityName?: string | undefined;
        inn?: string | undefined;
        ogrn?: string | undefined;
        address?: string | undefined;
      }
    | undefined;
}

export interface ContactItem {
  key: 'email' | 'phone' | 'telegram';
  href: string;
  text: string;
}

export interface LegalItem {
  key: 'entityName' | 'inn' | 'ogrn' | 'address';
  text: string;
}

/** Значение поля без пробелов по краям; пустая строка — поле не заполнено. */
function filled(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** Контакты подвала — только заполненные поля, в порядке почта, телефон, Telegram. */
export function visibleContacts(site: FooterSiteLike): ContactItem[] {
  const items: ContactItem[] = [];
  const email = filled(site.contacts?.email);
  const phone = filled(site.contacts?.phone);
  const telegram = filled(site.contacts?.telegram);
  if (email) items.push({ key: 'email', href: `mailto:${email}`, text: email });
  if (phone) items.push({ key: 'phone', href: `tel:${phone}`, text: phone });
  if (telegram) items.push({ key: 'telegram', href: telegram, text: telegram.replace(/^https:\/\//, '') });
  return items;
}

/** Реквизиты подвала — только заполненные поля. Оператор ПДн — в политике (ep05), не здесь. */
export function visibleLegal(site: FooterSiteLike): LegalItem[] {
  const items: LegalItem[] = [];
  const entityName = filled(site.legal?.entityName);
  const inn = filled(site.legal?.inn);
  const ogrn = filled(site.legal?.ogrn);
  const address = filled(site.legal?.address);
  if (entityName) items.push({ key: 'entityName', text: entityName });
  if (inn) items.push({ key: 'inn', text: `ИНН ${inn}` });
  if (ogrn) items.push({ key: 'ogrn', text: `ОГРН ${ogrn}` });
  if (address) items.push({ key: 'address', text: address });
  return items;
}

function source(entry: EntryLike<unknown>): string {
  return entry.filePath ?? entry.id;
}

/**
 * Межфайловые правила, которые не проверить схемой одной записи.
 * Собирает все нарушения и бросает одно исключение — сборка падает.
 */
export function assertContentIntegrity({
  products,
  pages,
  cases,
}: {
  products: readonly ProductLike[];
  pages: readonly PageLike[];
  cases: readonly CaseLike[];
}): void {
  const errors: string[] = [];

  const checkId = (entry: EntryLike<unknown>, nested: boolean) => {
    const segments = nested ? entry.id.split('/') : [entry.id];
    if (!segments.every((segment) => ENTRY_ID.test(segment))) {
      errors.push(
        `${source(entry)}: id «${entry.id}» не соответствует формату ${ENTRY_ID.source}` +
          (nested ? ' (по сегментам)' : ''),
      );
    }
  };
  products.forEach((p) => checkId(p, false));
  cases.forEach((c) => checkId(c, false));
  pages.forEach((p) => checkId(p, true));

  const byMapOrder = new Map<number, ProductLike>();
  for (const product of getPlatformMap(products)) {
    const order = product.data.mapOrder;
    if (order === undefined) continue;
    const taken = byMapOrder.get(order);
    if (taken) {
      errors.push(`mapOrder ${order} повторяется: ${source(taken)} и ${source(product)}`);
    } else {
      byMapOrder.set(order, product);
    }
  }

  for (const product of products) {
    if (product.data.hasPage && (product.body ?? '').trim() === '') {
      errors.push(`${source(product)}: hasPage: true, но у продукта нет текста страницы`);
    }
  }

  const productsById = new Map(products.map((p) => [p.id, p]));
  for (const entry of cases) {
    const product = productsById.get(entry.data.product.id);
    if (product === undefined) {
      errors.push(`${source(entry)}: продукт «${entry.data.product.id}» не найден`);
    } else if (entry.data.published && product.data.draft) {
      errors.push(`${source(entry)}: опубликованный кейс ссылается на черновик ${source(product)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Нарушена целостность контента:\n- ${errors.join('\n- ')}`);
  }
}
