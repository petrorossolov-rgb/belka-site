// Единственная точка доступа к коллекциям контента (Constitution 2): страницы и компоненты
// не вызывают `getCollection` / `getEntry` сами. Логика — в `content-core.ts`,
// здесь только чтение коллекций, `SITE_ENV` и проверка целостности один раз за сборку.

import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { SITE_ENV } from 'astro:env/server';
import * as core from './content-core';
import type { NavItem, NavPlacement } from './content-core';

export type { NavItem, NavPlacement };
export { RESERVED_PAGE_IDS } from './content-core';

type VisibleCollection = 'products' | 'pages' | 'cases';

export type Entry<C extends VisibleCollection> = CollectionEntry<C>;
export type Product = CollectionEntry<'products'>;
export type Page = CollectionEntry<'pages'>;
export type Block = CollectionEntry<'blocks'>;
export type Case = CollectionEntry<'cases'>;
export type Site = CollectionEntry<'site'>['data'];

let integrity: Promise<void> | undefined;

/** Запись `site` без проверки целостности: её читают и `getSite`, и сама проверка. */
async function readSite(): Promise<Site> {
  const site = await getEntry('site', 'site');
  if (site === undefined) {
    throw new Error('src/content/site.yaml: нет записи «site»');
  }
  return site.data;
}

/**
 * Проверка набора на всех записях, включая черновики: ошибка валит любую сборку.
 * `site` читается напрямую, а не через `getSite()`: тот сам ждёт эту проверку.
 */
function ensureIntegrity(): Promise<void> {
  integrity ??= Promise.all([
    getCollection('products'),
    getCollection('pages'),
    getCollection('cases'),
    getCollection('blocks'),
    readSite(),
  ]).then(([products, pages, cases, blocks, site]) =>
    core.assertContentIntegrity({ products, pages, cases, blocks, site }),
  );
  return integrity;
}

export async function getSite(): Promise<Site> {
  await ensureIntegrity();
  return readSite();
}

/** Записи коллекции, видимые в текущем `SITE_ENV`. */
export async function getVisible<C extends VisibleCollection>(collection: C): Promise<Entry<C>[]> {
  await ensureIntegrity();
  return core.filterVisible(await getCollection(collection), SITE_ENV);
}

/** Видимая страница по id; нет такой — ошибка сборки. */
export async function getPage(id: string): Promise<Page> {
  const page = (await getVisible('pages')).find((entry) => entry.id === id);
  if (page === undefined) {
    throw new Error(`src/content/pages/${id}.md: нет видимой записи страницы`);
  }
  return page;
}

/** Секции страницы в порядке `sections`; в production черновые блоки исключены. */
export async function getSections(page: Page): Promise<Block[]> {
  await ensureIntegrity();
  return core.resolveSections(page, await getCollection('blocks'), SITE_ENV);
}

export async function getNav(placement: NavPlacement): Promise<NavItem[]> {
  return core.buildNav(await getVisible('pages'), placement);
}

export async function getPlatformMap(): Promise<Product[]> {
  return core.getPlatformMap(await getVisible('products'));
}

export async function getStandaloneProducts(): Promise<Product[]> {
  return core.getStandaloneProducts(await getVisible('products'));
}

/** Карточки главной: видимые `featured`, сначала платформа по `mapOrder`, затем отдельные. */
export async function getFeaturedProducts(): Promise<Product[]> {
  return core.getFeaturedProducts(await getVisible('products'));
}

/**
 * Продукты со своей страницей `/products/{id}/` в текущем окружении: видимые с `hasPage`,
 * черновая страница (`pageDraft`) — только там, где черновики видны.
 */
export async function getProductPages(): Promise<Product[]> {
  await ensureIntegrity();
  return core.getProductPages(await getCollection('products'), SITE_ENV);
}

/** Стейджинг и локальная разработка: черновики видны, плашка «черновик», noindex. */
export function isStaging(): boolean {
  return core.showsDrafts(SITE_ENV);
}
