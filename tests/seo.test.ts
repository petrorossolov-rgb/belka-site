import { describe, expect, it } from 'vitest';
import {
  assetUrl,
  buildTitle,
  canonicalUrl,
  organizationJsonLd,
  previewImage,
  productTitle,
  serializeJsonLd,
  socialMeta,
  type SeoSite,
} from '../src/lib/seo';

const SITE_URL = 'https://belkascm.ru';
const LOGO = 'https://belkascm.ru/_astro/mark-rust.abc123.png';

const bareSite: SeoSite = { name: 'Belka SCM', url: SITE_URL, contacts: {} };

/** Все поля заполнены. Данные вымышленные, только для тестов. */
const fullSite: SeoSite = {
  name: 'Belka SCM',
  nameRu: 'Белка СЦМ',
  url: SITE_URL,
  contacts: { email: 'hello@example.ru', phone: '+79990000000', telegram: 'https://t.me/example' },
};

/** Все ключи объекта на любом уровне вложенности. */
function allKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

/** Значение атрибута `content` тега по ключу. */
function metaContent(tags: ReturnType<typeof socialMeta>, key: string): string | undefined {
  return tags.find((t) => t.key === key)?.content;
}

describe('buildTitle', () => {
  it('страница — `{title} — Belka SCM`', () => {
    expect(buildTitle('Контакты', 'Belka SCM')).toBe('Контакты — Belka SCM');
  });

  it('граничный случай: title главной — как есть, без суффикса', () => {
    const home = 'Belka SCM — платформа и внедрение для логистики';
    expect(buildTitle(home, 'Belka SCM', { home: true })).toBe(home);
  });
});

describe('productTitle', () => {
  it('seo.title, если задан', () => {
    expect(productTitle({ name: 'Belka WMS', seo: { title: 'Система управления складом' } })).toBe(
      'Система управления складом',
    );
  });

  it('иначе имя продукта', () => {
    expect(productTitle({ name: 'Belka WMS' })).toBe('Belka WMS');
    expect(productTitle({ name: 'Belka WMS', seo: {} })).toBe('Belka WMS');
  });
});

describe('canonicalUrl', () => {
  it('`/` → корень со слэшем', () => {
    expect(canonicalUrl(SITE_URL, '/')).toBe('https://belkascm.ru/');
    expect(canonicalUrl(SITE_URL, '')).toBe('https://belkascm.ru/');
  });

  it('путь без слэша на конце → слэш добавлен', () => {
    expect(canonicalUrl(SITE_URL, '/products/wms')).toBe('https://belkascm.ru/products/wms/');
    expect(canonicalUrl(SITE_URL, 'contacts')).toBe('https://belkascm.ru/contacts/');
  });

  it('путь со слэшем не меняется', () => {
    expect(canonicalUrl(SITE_URL, '/products/wms/')).toBe('https://belkascm.ru/products/wms/');
  });

  it('двойных слэшей нет: ни от site.url со слэшем, ни от пути', () => {
    expect(canonicalUrl('https://belkascm.ru/', '/contacts/')).toBe('https://belkascm.ru/contacts/');
    expect(canonicalUrl(SITE_URL, '//legal//privacy/')).toBe('https://belkascm.ru/legal/privacy/');
    expect(canonicalUrl(SITE_URL, '//evil.example/')).toBe('https://belkascm.ru/evil.example/');
  });

  it('запрос и якорь отбрасываются', () => {
    expect(canonicalUrl(SITE_URL, '/contacts/?utm=1#top')).toBe('https://belkascm.ru/contacts/');
  });

  it('хост — всегда из site.url, какой бы ни была сборка', () => {
    expect(canonicalUrl(SITE_URL, '/products/wms/')).toMatch(/^https:\/\/belkascm\.ru\//);
  });
});

describe('assetUrl', () => {
  it('путь файла сборки → абсолютный URL от site.url', () => {
    expect(assetUrl(SITE_URL, '/_astro/mark.png')).toBe('https://belkascm.ru/_astro/mark.png');
    expect(assetUrl('https://belkascm.ru/', '/_astro/mark.png')).toBe('https://belkascm.ru/_astro/mark.png');
  });
});

describe('socialMeta', () => {
  const base = { title: 'Контакты — Belka SCM', description: 'Описание страницы.', siteName: 'Belka SCM' };

  it('обязательные теги OG и twitter:card', () => {
    const tags = socialMeta({ ...base, url: 'https://belkascm.ru/contacts/' });
    expect(metaContent(tags, 'og:type')).toBe('website');
    expect(metaContent(tags, 'og:site_name')).toBe('Belka SCM');
    expect(metaContent(tags, 'og:locale')).toBe('ru_RU');
    expect(metaContent(tags, 'og:title')).toBe(base.title);
    expect(metaContent(tags, 'og:description')).toBe(base.description);
    expect(metaContent(tags, 'og:url')).toBe('https://belkascm.ru/contacts/');
    expect(tags.filter((t) => t.key.startsWith('og:')).every((t) => t.attr === 'property')).toBe(true);
    expect(tags.find((t) => t.key === 'twitter:card')?.attr).toBe('name');
  });

  it('нет ogImage → нет og:image, карточка `summary`', () => {
    const tags = socialMeta(base);
    expect(tags.some((t) => t.key === 'og:image')).toBe(false);
    expect(metaContent(tags, 'twitter:card')).toBe('summary');
  });

  const image = { url: 'https://belkascm.ru/_astro/og.png', width: 1200, height: 630, alt: 'Belka SCM. Знает, где что лежит.' };

  it('есть картинка → og:image абсолютным URL, карточка `summary_large_image`', () => {
    const tags = socialMeta({ ...base, image });
    expect(metaContent(tags, 'og:image')).toBe('https://belkascm.ru/_astro/og.png');
    expect(metaContent(tags, 'twitter:card')).toBe('summary_large_image');
  });

  it('размеры и alt картинки — сразу после og:image, в этом порядке', () => {
    const keys = socialMeta({ ...base, image }).map((t) => t.key);
    const at = keys.indexOf('og:image');
    expect(keys.slice(at, at + 4)).toEqual(['og:image', 'og:image:width', 'og:image:height', 'og:image:alt']);
    const tags = socialMeta({ ...base, image });
    expect(metaContent(tags, 'og:image:width')).toBe('1200');
    expect(metaContent(tags, 'og:image:height')).toBe('630');
    expect(metaContent(tags, 'og:image:alt')).toBe(image.alt);
  });

  it('без картинки нет ни одного og:image:*', () => {
    expect(socialMeta(base).some((t) => t.key.startsWith('og:image'))).toBe(false);
  });

  it('страница без адреса (404) → без og:url', () => {
    expect(socialMeta(base).some((t) => t.key === 'og:url')).toBe(false);
  });
});

describe('previewImage', () => {
  const site = { image: 'site.png', alt: 'Alt сайта' };

  it('своя картинка страницы — со своим alt, не с alt сайта', () => {
    expect(previewImage({ image: 'page.png', alt: 'Alt страницы' }, site)).toEqual({
      image: 'page.png',
      alt: 'Alt страницы',
    });
  });

  it('у страницы нет картинки → картинка и alt сайта', () => {
    expect(previewImage({}, site)).toEqual({ image: 'site.png', alt: 'Alt сайта' });
    expect(previewImage({ alt: 'Alt без картинки' }, site)).toEqual({ image: 'site.png', alt: 'Alt сайта' });
  });

  it('нет ни одной картинки → без превью', () => {
    expect(previewImage({}, {})).toBeUndefined();
    expect(previewImage({}, { alt: 'Alt без картинки' })).toBeUndefined();
  });

  it('граничный случай: картинка страницы без alt → ошибка, alt сайта не подставляется', () => {
    expect(() => previewImage({ image: 'page.png' }, site)).toThrow(/страницы нет alt/);
    expect(() => previewImage({}, { image: 'site.png' })).toThrow(/сайта нет alt/);
  });
});

describe('organizationJsonLd', () => {
  it('минимальный набор из site.yaml ep01', () => {
    expect(organizationJsonLd(bareSite, LOGO)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Belka SCM',
      url: 'https://belkascm.ru/',
      logo: LOGO,
    });
  });

  it('пустые контакты → нет contactPoint; нет nameRu → нет alternateName', () => {
    const data = organizationJsonLd(bareSite, LOGO);
    expect(data).not.toHaveProperty('contactPoint');
    expect(data).not.toHaveProperty('alternateName');
  });

  it('nameRu → alternateName; непустые контакты → contactPoint только с заданными полями', () => {
    expect(organizationJsonLd(fullSite, LOGO)).toMatchObject({
      alternateName: 'Белка СЦМ',
      contactPoint: {
        '@type': 'ContactPoint',
        email: 'hello@example.ru',
        telephone: '+79990000000',
        url: 'https://t.me/example',
      },
    });
    const onlyEmail = organizationJsonLd({ ...bareSite, contacts: { email: 'hello@example.ru' } }, LOGO);
    expect(onlyEmail['contactPoint']).toEqual({ '@type': 'ContactPoint', email: 'hello@example.ru' });
  });

  it('анонимность: нет ключей founder, employee, member, person ни на каком уровне', () => {
    for (const site of [bareSite, fullSite]) {
      const keys = allKeys(organizationJsonLd(site, LOGO));
      expect(keys.filter((k) => /founder|employee|member|person/i.test(k))).toEqual([]);
      expect(serializeJsonLd(organizationJsonLd(site, LOGO))).not.toMatch(/"@type":"Person"/);
    }
  });

  it('проверка ключей видит вложенные уровни', () => {
    expect(allKeys({ a: { b: { founder: 'x' } } })).toContain('founder');
  });
});

describe('serializeJsonLd', () => {
  it('граничный случай: `</script>` в name экранируется и не закрывает тег', () => {
    const json = serializeJsonLd(organizationJsonLd({ ...bareSite, name: 'Belka</script><script>alert(1)' }, LOGO));
    expect(json).not.toContain('<');
    expect(json).not.toContain('>');
    expect(json).toContain('Belka\\u003c/script\\u003e');
    expect(JSON.parse(json).name).toBe('Belka</script><script>alert(1)');
  });

  it('`&` и разделители строк U+2028/U+2029 экранируются, JSON остаётся валидным', () => {
    const [ls, ps] = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
    const name = `A & B${ls}C${ps}D`;
    const json = serializeJsonLd(organizationJsonLd({ ...bareSite, name }, LOGO));
    for (const raw of ['&', ls, ps]) expect(json).not.toContain(raw);
    expect(JSON.parse(json).name).toBe(name);
  });
});
