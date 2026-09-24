import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { lhciUrls } from '../scripts/lhci-urls.mjs';

// Каждый тест правит свою копию прод-фикстуры dist во временном каталоге.
const FIXTURE = fileURLToPath(new URL('./fixtures/dist-production/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/lhci-urls.mjs', import.meta.url));

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lhci-urls-'));
  temps.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const urlset = (...locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((loc) => `<url><loc>${loc}</loc></url>`)
    .join('')}</urlset>`;

const sitemapIndex = (...locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`)
    .join('')}</sitemapindex>`;

describe('lhciUrls', () => {
  it('прод-фикстура: главная и 404', () => {
    expect(lhciUrls(dist())).toEqual(['/', '/404.html']);
  });

  it('sitemap с тремя URL → три локальных пути и /404.html', () => {
    const dir = dist();
    writeFileSync(
      join(dir, 'sitemap-0.xml'),
      urlset('https://belkascm.ru/', 'https://belkascm.ru/products/wms/', 'https://belkascm.ru/contacts/'),
    );
    expect(lhciUrls(dir)).toEqual(['/', '/products/wms/', '/contacts/', '/404.html']);
  });

  it('индекс разворачивается во все свои sitemap, пути не дублируются', () => {
    const dir = dist();
    writeFileSync(
      join(dir, 'sitemap-index.xml'),
      sitemapIndex('https://belkascm.ru/sitemap-0.xml', 'https://belkascm.ru/sitemap-1.xml'),
    );
    writeFileSync(join(dir, 'sitemap-0.xml'), urlset('https://belkascm.ru/', 'https://belkascm.ru/x/'));
    writeFileSync(join(dir, 'sitemap-1.xml'), urlset('https://belkascm.ru/x/', 'https://belkascm.ru/y/'));
    expect(lhciUrls(dir)).toEqual(['/', '/x/', '/y/', '/404.html']);
  });

  it('индекс со ссылкой на отсутствующий sitemap — ошибка', () => {
    const dir = dist();
    writeFileSync(join(dir, 'sitemap-index.xml'), sitemapIndex('https://belkascm.ru/sitemap-9.xml'));
    expect(() => lhciUrls(dir)).toThrow('ссылается на отсутствующий sitemap-9.xml');
  });

  it('абсолютный URL прод-домена → путь со слэшем', () => {
    const dir = dist();
    writeFileSync(join(dir, 'sitemap-0.xml'), urlset('https://belkascm.ru/x/'));
    expect(lhciUrls(dir)).toEqual(['/x/', '/404.html']);
  });

  it('пустой sitemap — ошибка', () => {
    const dir = dist();
    writeFileSync(join(dir, 'sitemap-0.xml'), urlset());
    expect(() => lhciUrls(dir)).toThrow('sitemap пуст');
  });

  it('URL чужого хоста — ошибка', () => {
    const dir = dist();
    writeFileSync(join(dir, 'sitemap-0.xml'), urlset('https://belkascm.ru/', 'https://evil.example/x/'));
    expect(() => lhciUrls(dir)).toThrow('https://evil.example/x/ — не https://belkascm.ru');
  });

  it('http вместо https — чужой origin, ошибка', () => {
    const dir = dist();
    writeFileSync(join(dir, 'sitemap-0.xml'), urlset('http://belkascm.ru/'));
    expect(() => lhciUrls(dir)).toThrow('не https://belkascm.ru');
  });

  it('невалидный URL — ошибка', () => {
    const dir = dist();
    writeFileSync(join(dir, 'sitemap-0.xml'), urlset('/relative/'));
    expect(() => lhciUrls(dir)).toThrow('невалидный URL «/relative/»');
  });

  it('без sitemap (staging-сборка) — ошибка', () => {
    const dir = dist();
    unlinkSync(join(dir, 'sitemap-index.xml'));
    unlinkSync(join(dir, 'sitemap-0.xml'));
    expect(() => lhciUrls(dir)).toThrow('нет sitemap-*.xml');
  });

  it('без 404.html — ошибка', () => {
    const dir = dist();
    unlinkSync(join(dir, '404.html'));
    expect(() => lhciUrls(dir)).toThrow('нет 404.html');
  });

  it('CLI: пути по строке и код 0; без sitemap — код 1', () => {
    const dir = dist();
    const ok = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim().split('\n')).toEqual(['/', '/404.html']);

    unlinkSync(join(dir, 'sitemap-index.xml'));
    unlinkSync(join(dir, 'sitemap-0.xml'));
    const fail = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
    expect(fail.status).toBe(1);
    expect(fail.stderr).toContain('lhci-urls: ');
  });
});
