import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import { parse } from 'yaml';
import { readSiteFlags } from '../scripts/lib/site-flags.mjs';
import { PROBE_VALUES, applyProbeOverlay } from '../scripts/metrika-probe-site.mjs';
import { siteSchema } from '../src/lib/schemas';
import { validConsent } from './fixtures/schemas';

// Флаги из источника правды и оверлей пробы «флаг вкл.» (ep05 T04). Тест правит копии
// настоящего site.yaml во временном каталоге; сам site.yaml не меняется.
const SITE_YAML = fileURLToPath(new URL('../src/content/site.yaml', import.meta.url));
const FLAGS_CLI = fileURLToPath(new URL('../scripts/lib/site-flags.mjs', import.meta.url));
const PROBE_CLI = fileURLToPath(new URL('../scripts/metrika-probe-site.mjs', import.meta.url));

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Копия site.yaml во временном каталоге; `edit` правит текст копии. */
function siteCopy(edit: (text: string) => string = (text) => text): string {
  const dir = mkdtempSync(join(tmpdir(), 'site-flags-'));
  temps.push(dir);
  const path = join(dir, 'site.yaml');
  copyFileSync(SITE_YAML, path);
  writeFileSync(path, edit(readFileSync(path, 'utf8')));
  return path;
}

/** Строки плашки в конце группы `site` — как их положит T07; значения — из фикстуры схем. */
const withConsent = (text: string) =>
  text.includes('\n  consent:')
    ? text
    : `${text.trimEnd()}\n  consent:\n${Object.entries(validConsent)
        .map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)
        .join('\n')}\n`;

const run = (cli: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

describe('readSiteFlags', () => {
  it('копия настоящего site.yaml — Метрика выключена', () => {
    expect(readSiteFlags(siteCopy()).metrikaEnabled).toBe(false);
  });

  it('копия с metrikaEnabled: true — включена', () => {
    const path = siteCopy((text) => text.replace('metrikaEnabled: false', 'metrikaEnabled: true'));
    expect(readSiteFlags(path)).toMatchObject({ metrikaEnabled: true, legalEntityReady: false });
  });

  it('YAML без flags — ошибка', () => {
    const path = siteCopy(() => 'site:\n  name: Belka SCM\n');
    expect(() => readSiteFlags(path)).toThrow(/нет группы site\.flags/);
  });

  it('флаг не boolean — ошибка', () => {
    const path = siteCopy((text) => text.replace('metrikaEnabled: false', 'metrikaEnabled: "нет"'));
    expect(() => readSiteFlags(path)).toThrow(/site\.flags\.metrikaEnabled — не true\/false/);
  });

  it('нет файла — ошибка', () => {
    expect(() => readSiteFlags(join(tmpdir(), 'нет-такого', 'site.yaml'))).toThrow(/нет файла/);
  });
});

describe('site-flags CLI', () => {
  it('печатает off для настоящего site.yaml и on для копии с флагом, код 0', () => {
    const off = run(FLAGS_CLI, 'metrikaEnabled', '--site', siteCopy());
    expect([off.status, off.stdout.trim()]).toEqual([0, 'off']);
    const onPath = siteCopy((text) => text.replace('metrikaEnabled: false', 'metrikaEnabled: true'));
    const on = run(FLAGS_CLI, 'metrikaEnabled', '--site', onPath);
    expect([on.status, on.stdout.trim()]).toEqual([0, 'on']);
  });

  it('по умолчанию читает src/content/site.yaml', () => {
    const result = spawnSync(process.execPath, [FLAGS_CLI, 'metrikaEnabled'], {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('..', import.meta.url)),
    });
    expect([result.status, result.stdout.trim()]).toEqual([0, 'off']);
  });

  it.each([
    ['неизвестный флаг', ['metrika']],
    ['без флага', []],
    ['два флага', ['metrikaEnabled', 'showReadiness']],
    ['--site без пути', ['metrikaEnabled', '--site']],
  ])('%s — код 2', (_name, args) => {
    const result = run(FLAGS_CLI, ...args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });

  it('нет файла и нет site.flags — код 2 с сообщением', () => {
    const missing = run(FLAGS_CLI, 'metrikaEnabled', '--site', join(tmpdir(), 'нет-такого.yaml'));
    expect([missing.status, missing.stderr]).toEqual([2, expect.stringMatching(/нет файла/)]);
    const bare = run(FLAGS_CLI, 'metrikaEnabled', '--site', siteCopy(() => 'site:\n  name: Belka SCM\n'));
    expect([bare.status, bare.stderr]).toEqual([2, expect.stringMatching(/нет группы site\.flags/)]);
  });
});

describe('metrika-probe-site: оверлей', () => {
  const site = siteSchema(() => z.string());

  it('результат проходит схему сайта вместе с refine (юрлицо, счётчик, consent)', () => {
    const result = applyProbeOverlay(withConsent(readFileSync(SITE_YAML, 'utf8')));
    expect(result.ok).toBe(true);
    const parsed = site.safeParse(parse(result.ok ? result.text : '').site);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.data).toMatchObject({
      flags: { legalEntityReady: true, metrikaEnabled: true },
      metrika: { counterId: PROBE_VALUES.counterId },
      legal: PROBE_VALUES.legal,
    });
  });

  it('прочие поля и комментарии не меняются', () => {
    const source = withConsent(readFileSync(SITE_YAML, 'utf8'));
    const result = applyProbeOverlay(source);
    if (!result.ok) throw new Error(result.error);
    const comments = (text: string) => text.split('\n').filter((line) => line.trimStart().startsWith('#'));
    expect(comments(result.text)).toEqual(comments(source));
    const { flags: _f, metrika: _m, legal: _l, ...before } = parse(source).site;
    const { flags: _f2, metrika: _m2, legal: _l2, ...after } = parse(result.text).site;
    expect(after).toEqual(before);
    expect(parse(result.text).site.flags.showReadiness).toBe(parse(source).site.flags.showReadiness);
  });

  it('двукратный запуск даёт тот же файл', () => {
    const once = applyProbeOverlay(withConsent(readFileSync(SITE_YAML, 'utf8')));
    if (!once.ok) throw new Error(once.error);
    expect(applyProbeOverlay(once.text)).toEqual(once);
  });

  it('реквизиты пробы — нули и пометка «проба» (репозиторий публичный)', () => {
    expect(PROBE_VALUES.legal.inn).toMatch(/^0+$/);
    expect(PROBE_VALUES.legal.ogrn).toMatch(/^0+$/);
    expect(PROBE_VALUES.counterId).toMatch(/^0+$/);
    expect(PROBE_VALUES.legal.entityName).toMatch(/[Пп]роба/);
    expect(PROBE_VALUES.legal.address).toMatch(/[Пп]роб/);
  });

  it('копия без consent — ошибка с подсказкой', () => {
    const result = applyProbeOverlay('site:\n  name: Belka SCM\n  flags:\n    metrikaEnabled: false\n');
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/нет site\.consent/) });
  });
});

describe('metrika-probe-site CLI', () => {
  it('правит файл на месте, код 0; второй запуск не меняет файл', () => {
    const path = siteCopy(withConsent);
    expect(run(PROBE_CLI, '--site', path).status).toBe(0);
    const first = readFileSync(path, 'utf8');
    expect(readSiteFlags(path).metrikaEnabled).toBe(true);
    expect(run(PROBE_CLI, '--site', path).status).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(first);
  });

  it('без consent — код 1, файл не тронут', () => {
    const path = siteCopy((text) => text.replace(/\n {2}consent:[\s\S]*$/, '\n'));
    const before = readFileSync(path, 'utf8');
    const result = run(PROBE_CLI, '--site', path);
    expect([result.status, result.stderr]).toEqual([1, expect.stringMatching(/нет site\.consent/)]);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('неверный вызов и нет файла — код 2', () => {
    expect(run(PROBE_CLI, '--site').status).toBe(2);
    expect(run(PROBE_CLI, '--dist', 'x').status).toBe(2);
    expect(run(PROBE_CLI, '--site', join(tmpdir(), 'нет-такого.yaml')).status).toBe(2);
  });
});
