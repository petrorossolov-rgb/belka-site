// Единственная точка доступа к коллекциям контента (Constitution 2): страницы и компоненты
// не вызывают `getCollection` / `getEntry` сами. Логика — в `content-core.ts`,
// здесь только чтение коллекций, `SITE_ENV` и проверка целостности один раз за сборку.

import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { SITE_ENV } from 'astro:env/server';
import * as core from './content-core';
import type { NavItem, NavPlacement } from './content-core';

export type { NavItem, NavPlacement };

type VisibleCollection = 'products' | 'pages' | 'cases';

export type Entry<C extends VisibleCollection> = CollectionEntry<C>;
export type Product = CollectionEntry<'products'>;
export type Page = CollectionEntry<'pages'>;
export type Case = CollectionEntry<'cases'>;
export type Site = CollectionEntry<'site'>['data'];

let integrity: Promise<void> | undefined;

/** Проверка набора на всех записях, включая черновики: ошибка валит любую сборку. */
function ensureIntegrity(): Promise<void> {
  integrity ??= Promise.all([getCollection('products'), getCollection('pages'), getCollection('cases')]).then(
    ([products, pages, cases]) => core.assertContentIntegrity({ products, pages, cases }),
  );
  return integrity;
}

export async function getSite(): Promise<Site> {
  await ensureIntegrity();
  const site = await getEntry('site', 'site');
  if (site === undefined) {
    throw new Error('src/content/site.yaml: нет записи «site»');
  }
  return site.data;
}

/** Записи коллекции, видимые в текущем `SITE_ENV`. */
export async function getVisible<C extends VisibleCollection>(collection: C): Promise<Entry<C>[]> {
  await ensureIntegrity();
  return core.filterVisible(await getCollection(collection), SITE_ENV);
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

/** Продукты со своей страницей `/products/{id}/`, видимые в текущем окружении. */
export async function getProductPages(): Promise<Product[]> {
  return (await getVisible('products')).filter((p) => p.data.hasPage);
}

/** Стейджинг и локальная разработка: черновики видны, плашка «черновик», noindex. */
export function isStaging(): boolean {
  return core.showsDrafts(SITE_ENV);
}
