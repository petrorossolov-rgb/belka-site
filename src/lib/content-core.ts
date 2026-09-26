// Чистое ядро контента: видимость, навигация, карта платформы, целостность набора.
// Без импорта `astro:*` — работает на любых объектах вида `{ id, data, body? }`,
// поэтому тесты не поднимают Astro. Доступ к коллекциям — только `src/lib/content.ts`.

import type { BlockView, MockupKind } from './schemas';
import type { SiteEnv } from './site-env';

/** Формат id записи (и каждого сегмента вложенного id страницы). */
export const ENTRY_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Id страниц со своими шаблонами: `index` → `index.astro` (`/`), `404` → `404.astro`
 * (`dist/404.html`). `[...slug].astro` их не строит.
 */
export const RESERVED_PAGE_IDS: readonly string[] = ['index', '404'];

/** Страницы с этим префиксом id столкнулись бы с маршрутами `products/[id].astro`. */
const PRODUCT_ROUTE_PREFIX = 'products/';

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

/** Ссылка на запись другой коллекции — как её отдаёт `reference()`. */
interface RefLike {
  id: string;
}

/** Метаданные картинки, которые даёт `image()` схемы (`ImageMetadata` Astro). */
export interface ImageMetaLike {
  format: string;
  width: number;
  height: number;
}

export type ProductLike = EntryLike<{
  kind: 'platform' | 'standalone';
  mapOrder?: number | undefined;
  hasPage: boolean;
  pageDraft?: boolean | undefined;
  featured?: boolean | undefined;
  descriptor?: string | undefined;
  lead?: string | undefined;
  sections?: readonly RefLike[] | undefined;
  ogImage?: ImageMetaLike | undefined;
  draft: boolean;
}>;

export type PageLike = EntryLike<{
  title: string;
  nav?: { label?: string | undefined; order: number; placement: NavPlacement } | undefined;
  sections?: readonly RefLike[] | undefined;
  ogImage?: ImageMetaLike | undefined;
  draft: boolean;
}>;

export type BlockLike = EntryLike<{
  view: BlockView;
  items?: readonly { mockup?: RefLike | undefined; product?: RefLike | undefined }[] | undefined;
  link?: { page: RefLike; label: string } | undefined;
  draft: boolean;
}>;

export type MockupLike = EntryLike<{ kind: MockupKind }>;

/** OG-карточка любой записи: PNG 1200×630 (шаблон, `check-dist-seo` и превью мессенджеров). */
export const OG_IMAGE = { format: 'png', width: 1200, height: 630 } as const;

export type CaseLike = EntryLike<{ published: boolean; product: RefLike }>;

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

/**
 * Карточки главной (`featured`): сначала продукты платформы по `mapOrder`, затем отдельные по id.
 * Продукты должны прийти уже отфильтрованными `filterVisible`.
 */
export function getFeaturedProducts<P extends ProductLike>(products: readonly P[]): P[] {
  const featured = products.filter((p) => p.data.featured === true);
  return [...getPlatformMap(featured), ...getStandaloneProducts(featured)];
}

/**
 * Продукты со своей страницей `/products/{id}/` в окружении `env`: видимый продукт с `hasPage`,
 * у которого страница не черновая (`pageDraft`) или окружение показывает черновики.
 */
export function getProductPages<P extends ProductLike>(products: readonly P[], env: SiteEnv): P[] {
  return filterVisible(products, env).filter(
    (p) => p.data.hasPage && (p.data.pageDraft !== true || showsDrafts(env)),
  );
}

/** Пункт карты или карточка ведёт на страницу продукта, только если она собрана. */
export function isLinkable(product: RefLike, productPages: readonly RefLike[]): boolean {
  return productPages.some((p) => p.id === product.id);
}

/**
 * Секции страницы или продукта в порядке `sections`; в production черновые блоки исключены.
 * Отсутствующий блок — ошибка (целостность ловит её раньше, здесь — страховка рендера).
 */
export function resolveSections<B extends BlockLike>(
  entry: PageLike | ProductLike,
  blocks: readonly B[],
  env: SiteEnv,
): B[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return (entry.data.sections ?? []).flatMap((ref) => {
    const block = byId.get(ref.id);
    if (block === undefined) {
      throw new Error(`${source(entry)}: секция «${ref.id}» не найдена в src/content/blocks`);
    }
    return filterVisible([block], env);
  });
}

export interface BlockLinkItem {
  href: string;
  label: string;
}

/** Ссылка блока — только на видимую страницу; `visiblePages` — уже после `filterVisible`. */
export function blockLink(block: BlockLike, visiblePages: readonly RefLike[]): BlockLinkItem | undefined {
  const link = block.data.link;
  if (link === undefined || !visiblePages.some((p) => p.id === link.page.id)) return undefined;
  return { href: pageHref(link.page.id), label: link.label };
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

/** Поля `site`, которые читает проверка целостности. */
export interface IntegritySiteLike extends FooterSiteLike {
  mockupNote?: string | undefined;
  seo?: { defaultOgImage?: ImageMetaLike | undefined } | undefined;
}

/**
 * Межфайловые правила, которые не проверить схемой одной записи.
 * Собирает все нарушения и бросает одно исключение — сборка падает.
 */
export function assertContentIntegrity({
  products,
  pages,
  cases,
  blocks,
  mockups,
  site,
}: {
  products: readonly ProductLike[];
  pages: readonly PageLike[];
  cases: readonly CaseLike[];
  blocks: readonly BlockLike[];
  mockups: readonly MockupLike[];
  site: IntegritySiteLike;
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
  blocks.forEach((b) => checkId(b, false));
  mockups.forEach((m) => checkId(m, false));
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

  // Страница продукта — герой и секции: нужны пояснение имени, лид и хотя бы одна секция.
  // Тела нет: шаблон его не выводит, и текст в нём молча пропал бы (как у блоков, кроме text).
  // Правило действует и на черновые страницы: стейджинг их рендерит.
  for (const product of products) {
    if (!product.data.hasPage) continue;
    const missing = [
      product.data.descriptor === undefined && 'descriptor',
      product.data.lead === undefined && 'lead',
      (product.data.sections ?? []).length === 0 && 'sections',
    ].filter((field) => field !== false);
    if (missing.length > 0) {
      errors.push(`${source(product)}: у продукта со страницей (hasPage) нужны ${missing.join(', ')}`);
    }
    if ((product.body ?? '').trim() !== '') {
      errors.push(`${source(product)}: у продукта со страницей (hasPage) тела нет — страница собирается из sections`);
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

  // Секции страниц и продуктов: ссылки существуют (`reference()` этого не проверяет) и не
  // повторяются у одной записи. Правило действует и на черновики: стейджинг их рендерит.
  // Черновой блок у видимой записи допустим — production его исключает (`resolveSections`).
  // Один мокап не повторяется в секциях одной записи: одинаковые фигуры — ошибка автора.
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const pageIds = new Set(pages.map((p) => p.id));
  const sectionOwners: readonly (PageLike | ProductLike)[] = [...pages, ...products];
  const shownMockups = new Set<string>();
  for (const owner of sectionOwners) {
    const seen = new Set<string>();
    const ownerMockups = new Set<string>();
    for (const ref of owner.data.sections ?? []) {
      const block = blocksById.get(ref.id);
      if (block === undefined) {
        errors.push(`${source(owner)}: секция «${ref.id}» не найдена в src/content/blocks`);
      } else if (seen.has(ref.id)) {
        errors.push(`${source(owner)}: секция «${ref.id}» повторяется`);
      } else {
        for (const item of block.data.items ?? []) {
          if (item.mockup === undefined) continue;
          if (ownerMockups.has(item.mockup.id)) {
            errors.push(`${source(owner)}: мокап «${item.mockup.id}» повторяется в секциях`);
          }
          ownerMockups.add(item.mockup.id);
          shownMockups.add(item.mockup.id);
        }
      }
      seen.add(ref.id);
    }
  }

  // Видимая в production страница продукта не пустеет, когда production исключает черновые
  // блоки (Constitution 7). Проверка не зависит от окружения сборки: стейджинг тоже её держит.
  for (const product of products) {
    const sections = product.data.sections ?? [];
    if (!product.data.hasPage || product.data.draft || product.data.pageDraft || sections.length === 0) continue;
    if (!sections.some((ref) => blocksById.get(ref.id)?.data.draft === false)) {
      errors.push(`${source(product)}: страница продукта видима в production, но все её секции — черновики`);
    }
  }

  // Пункты поверхностей: мокап и продукт существуют; продукт назван с пояснением
  // (Constitution 3); нечерновой блок не называет черновой продукт — иначе production
  // показал бы имя скрытого продукта.
  const mockupIds = new Set(mockups.map((m) => m.id));
  for (const block of blocks) {
    (block.data.items ?? []).forEach((item, i) => {
      if (item.mockup !== undefined && !mockupIds.has(item.mockup.id)) {
        errors.push(`${source(block)}: пункт ${i + 1} — мокап «${item.mockup.id}» не найден в src/content/mockups`);
      }
      if (item.product === undefined) return;
      const product = productsById.get(item.product.id);
      if (product === undefined) {
        errors.push(`${source(block)}: пункт ${i + 1} — продукт «${item.product.id}» не найден`);
      } else {
        if (product.data.descriptor === undefined) {
          errors.push(`${source(block)}: пункт ${i + 1} — у продукта ${source(product)} нет descriptor`);
        }
        if (!block.data.draft && product.data.draft) {
          errors.push(`${source(block)}: пункт ${i + 1} — нечерновой блок называет черновой продукт ${source(product)}`);
        }
      }
    });
  }

  // Подпись о демо-данных у каждой фигуры (Constitution 1): мокап в секциях любой записи,
  // в том числе черновой, — стейджинг его рендерит.
  if (shownMockups.size > 0 && (site.mockupNote ?? '').trim() === '') {
    errors.push(`src/content/site.yaml: на сайте есть мокапы (${[...shownMockups].join(', ')}), но не задан mockupNote`);
  }

  // OG-карточка — PNG 1200×630: так её рисует build:og и принимает check-dist-seo.
  const checkOg = (where: string, image: ImageMetaLike | undefined) => {
    if (image === undefined) return;
    if (image.format !== OG_IMAGE.format || image.width !== OG_IMAGE.width || image.height !== OG_IMAGE.height) {
      errors.push(
        `${where}: OG-картинка ${image.format} ${image.width}×${image.height}, нужна ` +
          `${OG_IMAGE.format} ${OG_IMAGE.width}×${OG_IMAGE.height}`,
      );
    }
  };
  pages.forEach((p) => checkOg(`${source(p)}: ogImage`, p.data.ogImage));
  products.forEach((p) => checkOg(`${source(p)}: ogImage`, p.data.ogImage));
  checkOg('src/content/site.yaml: seo.defaultOgImage', site.seo?.defaultOgImage);

  for (const block of blocks) {
    const link = block.data.link;
    if (link !== undefined && !pageIds.has(link.page.id)) {
      errors.push(`${source(block)}: ссылка на страницу «${link.page.id}», которой нет в src/content/pages`);
    } else if (link?.page.id === '404') {
      errors.push(`${source(block)}: ссылка на страницу «404» — у неё нет маршрута /404/, сервер отдаёт её на любой неизвестный адрес`);
    }
    const hasBody = (block.body ?? '').trim() !== '';
    if (block.data.view === 'text' && !hasBody) {
      errors.push(`${source(block)}: у view: text нужен текст в теле`);
    } else if (block.data.view !== 'text' && hasBody) {
      errors.push(`${source(block)}: у view: ${block.data.view} тела нет — оно не выводится`);
    }
  }

  // Маршруты: страница не занимает адрес страницы продукта; у 404 нет меню, секций и черновика.
  for (const page of pages) {
    if (page.id.startsWith(PRODUCT_ROUTE_PREFIX)) {
      errors.push(`${source(page)}: id «${page.id}» занимает маршрут страниц продуктов /products/…`);
    }
  }
  const notFound = pages.find((p) => p.id === '404');
  if (notFound !== undefined) {
    if (notFound.data.nav !== undefined) errors.push(`${source(notFound)}: у страницы 404 нет nav`);
    if ((notFound.data.sections ?? []).length > 0) errors.push(`${source(notFound)}: у страницы 404 нет sections`);
    if (notFound.data.draft) errors.push(`${source(notFound)}: страница 404 не бывает черновиком`);
  }

  // Видимая страница контактов без канала — пустая страница (Constitution 7).
  const contacts = pages.find((p) => p.id === 'contacts');
  if (contacts !== undefined && !contacts.data.draft && visibleContacts(site).length === 0) {
    errors.push(`${source(contacts)}: страница контактов видима, но в site.contacts нет ни одного канала`);
  }

  if (errors.length > 0) {
    throw new Error(`Нарушена целостность контента:\n- ${errors.join('\n- ')}`);
  }
}
