// SEO-слой (T21): заголовок, canonical, Open Graph и JSON-LD `Organization`.
// Чистые функции без импорта `astro:*` — их выводит `Seo.astro` и читают тесты.
// Всё строится только из `site.yaml` и записей контента (Constitution 1); в JSON-LD —
// организация без персон (анонимность основателей).

/** Разделитель между заголовком страницы и именем сайта. */
export const TITLE_SEPARATOR = ' — ';

export interface SeoContacts {
  email?: string | undefined;
  phone?: string | undefined;
  telegram?: string | undefined;
}

/** Поля `site.yaml`, нужные SEO-слою. */
export interface SeoSite {
  name: string;
  nameRu?: string | undefined;
  url: string;
  contacts: SeoContacts;
}

/**
 * `<title>`: `{title} — {имя сайта}`; у главной (`home`) — заголовок страницы как есть,
 * он уже содержит имя.
 */
export function buildTitle(title: string, siteName: string, { home = false }: { home?: boolean } = {}): string {
  return home ? title : `${title}${TITLE_SEPARATOR}${siteName}`;
}

/** Заголовок страницы продукта до суффикса: `seo.title` или имя продукта. */
export function productTitle(product: { name: string; seo?: { title?: string | undefined } | undefined }): string {
  return product.seo?.title ?? product.name;
}

function origin(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '');
}

/**
 * Canonical: `site.url` + путь, всегда со слэшем на конце и без повторных слэшей.
 * Строится от `site.yaml → url`, а не от `Astro.site`: на стейджинге они различаются.
 * Запрос и якорь отбрасываются.
 */
export function canonicalUrl(siteUrl: string, path: string): string {
  const segments = (path.split(/[?#]/)[0] ?? '').split('/').filter(Boolean);
  return `${origin(siteUrl)}/${segments.map((s) => `${s}/`).join('')}`;
}

/** Абсолютный URL файла сборки (`/_astro/x.png` → `https://belkascm.ru/_astro/x.png`). */
export function assetUrl(siteUrl: string, src: string): string {
  return new URL(src, `${origin(siteUrl)}/`).href;
}

/** Картинка превью в выводе: абсолютный URL, размеры файла и текстовая альтернатива. */
export interface OgImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface OpenGraphInput {
  title: string;
  description: string;
  siteName: string;
  /** Canonical страницы; у страниц без адреса (404) — нет. */
  url?: string | undefined;
  /** Картинка; только если задана (`page.ogImage` или `site.seo.defaultOgImage`). */
  image?: OgImage | undefined;
}

/**
 * Картинка превью и её alt — всегда из одной записи: своя картинка страницы со своим
 * `ogImageAlt`, иначе картинка и alt сайта (`site.seo`). Схемы требуют alt у каждой
 * картинки; нет alt — ошибка сборки, а не чужой alt.
 */
export function previewImage<I>(
  page: { image?: I | undefined; alt?: string | undefined },
  site: { image?: I | undefined; alt?: string | undefined },
): { image: I; alt: string } | undefined {
  const source = page.image !== undefined ? page : site;
  if (source.image === undefined) return undefined;
  if (source.alt === undefined) {
    throw new Error(`у картинки превью ${source === page ? 'страницы' : 'сайта'} нет alt`);
  }
  return { image: source.image, alt: source.alt };
}

export interface MetaTag {
  /** `property` для `og:*`, `name` для `twitter:*`. */
  attr: 'property' | 'name';
  key: string;
  content: string;
}

/** Теги Open Graph и `twitter:card` в порядке вывода. */
export function socialMeta({ title, description, siteName, url, image }: OpenGraphInput): MetaTag[] {
  const og = (key: string, content: string): MetaTag => ({ attr: 'property', key: `og:${key}`, content });
  return [
    og('type', 'website'),
    og('site_name', siteName),
    og('locale', 'ru_RU'),
    og('title', title),
    og('description', description),
    ...(url === undefined ? [] : [og('url', url)]),
    ...(image === undefined
      ? []
      : [
          og('image', image.url),
          og('image:width', String(image.width)),
          og('image:height', String(image.height)),
          og('image:alt', image.alt),
        ]),
    { attr: 'name', key: 'twitter:card', content: image === undefined ? 'summary' : 'summary_large_image' },
  ];
}

// U+2028 и U+2029 — перевод строки для старых разборщиков JS; в исходнике только кодами.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

type JsonLd = { [key: string]: string | JsonLd };

/**
 * JSON-LD `Organization`: имя, `alternateName` — только при `nameRu`, адрес сайта, абсолютный
 * URL знака, `contactPoint` — только при непустых контактах. Персон нет и быть не должно.
 */
export function organizationJsonLd(site: SeoSite, logoUrl: string): JsonLd {
  const contactPoint: JsonLd = {};
  if (site.contacts.email) contactPoint['email'] = site.contacts.email;
  if (site.contacts.phone) contactPoint['telephone'] = site.contacts.phone;
  if (site.contacts.telegram) contactPoint['url'] = site.contacts.telegram;

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    ...(site.nameRu ? { alternateName: site.nameRu } : {}),
    url: canonicalUrl(site.url, '/'),
    logo: logoUrl,
    ...(Object.keys(contactPoint).length > 0 ? { contactPoint: { '@type': 'ContactPoint', ...contactPoint } } : {}),
  };
}

/**
 * JSON для `<script type="application/ld+json">`. `<`, `>`, `&` и разделители строк
 * экранируются: строка `</script>` из контента не закроет тег.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(LINE_SEPARATOR, '\\u2028')
    .replaceAll(PARAGRAPH_SEPARATOR, '\\u2029');
}
