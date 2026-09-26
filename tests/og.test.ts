// OG-карточки (npm run build:og) закоммичены в src/assets/og/: каждая — PNG 1200×630 и вес под
// WhatsApp. Вес после перекодирования getImage в сборке держит check-dist-seo. Слоган на
// default.png сверяется только литералом ниже: прочитать текст с растра тест не может (граница охвата).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { OG_IMAGE_MAX_BYTES } from '../scripts/check-dist-seo.mjs';
import { OG_DIR, OG_SIZE, UsageError, checkOgDir, parseArgs, readProduct, readSlogan } from '../scripts/build-og.mjs';

const DEFAULT_OG = join(OG_DIR, 'default.png');
const SITE = fileURLToPath(new URL('../src/content/site.yaml', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/build-og.mjs', import.meta.url));

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'og-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** PNG с заголовком IHDR нужного размера — достаточно для `pngSize`. */
function pngHeader(width: number, height: number, bytes = 64): Buffer {
  const buf = Buffer.alloc(bytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe('OG-карточки в src/assets/og/', () => {
  it('каждая — PNG 1200×630 не тяжелее 300 КБ', () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
    expect(checkOgDir(OG_DIR)).toEqual([]);
  });

  it('site.yaml ссылается на карточку сайта и даёт ей alt', () => {
    const yaml = readFileSync(SITE, 'utf8');
    expect(yaml).toMatch(/^\s+defaultOgImage: \.\.\/assets\/og\/default\.png$/m);
    expect(yaml).toMatch(/^\s+defaultOgImageAlt: \S/m);
  });

  describe('checkOgDir — пограничная проба', () => {
    it('правильная карточка проходит', () => {
      const dir = tempDir();
      copyFileSync(DEFAULT_OG, join(dir, 'default.png'));
      writeFileSync(join(dir, 'wms.png'), pngHeader(1200, 630));
      expect(checkOgDir(dir)).toEqual([]);
    });

    it('PNG 1200×600 падает', () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'wms.png'), pngHeader(1200, 600));
      expect(checkOgDir(dir)).toEqual(['wms.png: 1200×600, нужно 1200×630']);
    });

    it('файл на 1 байт тяжелее 300 КБ падает, ровно 300 КБ — проходит', () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'limit.png'), pngHeader(1200, 630, OG_IMAGE_MAX_BYTES));
      writeFileSync(join(dir, 'heavy.png'), pngHeader(1200, 630, OG_IMAGE_MAX_BYTES + 1));
      expect(checkOgDir(dir)).toEqual([`heavy.png: ${OG_IMAGE_MAX_BYTES + 1} байт, предел ${OG_IMAGE_MAX_BYTES}`]);
    });

    it('JPG и файл без заголовка PNG падают; пустой каталог — тоже', () => {
      const dir = tempDir();
      expect(checkOgDir(dir)).toEqual([`${dir}: нет ни одной карточки`]);
      writeFileSync(join(dir, 'wms.jpg'), 'x');
      writeFileSync(join(dir, 'broken.png'), 'не картинка');
      expect(checkOgDir(dir)).toEqual(['broken.png: не PNG, нужно 1200×630', 'wms.jpg: OG-карточка — только PNG']);
    });
  });
});

describe('readSlogan', () => {
  it('слоган из site.yaml — строка записи site', () => {
    expect(readSlogan(readFileSync(SITE, 'utf8'))).toBe('Знает, где что лежит.');
  });

  it('кавычки снимаются; нет строки slogan → ошибка', () => {
    expect(readSlogan('site:\n  slogan: "Слоган: с двоеточием."\n')).toBe('Слоган: с двоеточием.');
    expect(() => readSlogan('site:\n  name: Belka SCM\n')).toThrow(/нет строки slogan/);
  });
});

describe('readProduct', () => {
  const md = (lines: string) => `---\n${lines}\n---\n`;

  it('name и descriptor из frontmatter; кавычки снимаются, двоеточие в значении остаётся', () => {
    expect(readProduct(md('name: Belka WMS\nshort: WMS\ndescriptor: "система: управления складом"'))).toEqual({
      name: 'Belka WMS',
      descriptor: 'система: управления складом',
    });
    expect(readProduct(md("descriptor: 'пояснение'\nname: 'Belka WMS'"))).toEqual({
      name: 'Belka WMS',
      descriptor: 'пояснение',
    });
  });

  it('берёт только frontmatter и только ключи верхнего уровня', () => {
    const text = md('name: Belka WMS\nseo:\n  descriptor: вложенное\ndescriptor: верхнее') + '\ndescriptor: из тела\n';
    expect(readProduct(text).descriptor).toBe('верхнее');
    expect(() => readProduct(md('name: Belka WMS\nseo:\n  descriptor: вложенное') + 'descriptor: из тела\n')).toThrow(
      /нет строки descriptor/,
    );
  });

  it('нет descriptor, пустой descriptor, нет name или frontmatter — ошибка входа', () => {
    expect(() => readProduct(md('name: Belka WMS'))).toThrow(UsageError);
    expect(() => readProduct(md('name: Belka WMS\ndescriptor: ""'))).toThrow(/нет строки descriptor/);
    expect(() => readProduct(md('descriptor: пояснение'))).toThrow(/нет строки name/);
    expect(() => readProduct('name: Belka WMS\ndescriptor: пояснение\n')).toThrow(/нет frontmatter/);
  });

  it('комментарий-строка и CRLF не мешают', () => {
    expect(readProduct('---\r\n# служебный комментарий\r\nname: Belka WMS\r\ndescriptor: пояснение\r\n---\r\n')).toEqual({
      name: 'Belka WMS',
      descriptor: 'пояснение',
    });
  });
});

describe('build:og: аргументы и CLI без Chrome', () => {
  it('parseArgs: без аргументов — карточка сайта, --product <id> — продукта', () => {
    expect(parseArgs([])).toEqual({ product: undefined });
    expect(parseArgs(['--product', 'wms'])).toEqual({ product: 'wms' });
    for (const argv of [['--product'], ['--product', 'Wms'], ['--product', '../site'], ['--bogus'], ['--product', 'wms', 'x']]) {
      expect(() => parseArgs(argv), argv.join(' ')).toThrow(UsageError);
    }
  });

  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000 });

  it.each([
    [['--product', 'nope'], 'нет файла продукта src/content/products/nope.md'],
    [['--product'], '--product: нужен id продукта'],
    [['--bogus'], 'использование: npm run build:og'],
  ])('%j → код 2 до запуска Chrome', (args, message) => {
    const result = run(...args);
    expect(result.stderr).toContain(message);
    expect(result.status).toBe(2);
  });
});
