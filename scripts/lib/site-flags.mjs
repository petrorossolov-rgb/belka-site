// @ts-check
// Флаги сайта из источника правды — `src/content/site.yaml` (ep05). Режим гейтов берётся отсюда,
// а не из сборки: ошибочно выпущенный скрипт при выключенном флаге не объявит себя режимом «вкл.»
// (plan ep05 → Key Decision «Режим гейтов берётся из site.yaml»). Пользуются: шаги check-dist-seo
// в gates.yml, тест согласованности CSP, оверлей пробы.
//
//   node scripts/lib/site-flags.mjs <флаг> [--site src/content/site.yaml]   # печатает on|off
//
// Код 2 — неизвестный флаг, нет файла, нет `site.flags` или флаг не boolean.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const DEFAULT_SITE_YAML = 'src/content/site.yaml';

/** Флаги `site.flags` — как в `siteSchema`. */
export const SITE_FLAGS = /** @type {const} */ (['legalEntityReady', 'metrikaEnabled', 'showReadiness']);

/**
 * @typedef {(typeof SITE_FLAGS)[number]} SiteFlag
 * @typedef {Record<SiteFlag, boolean>} SiteFlags
 */

/**
 * Флаги `site.flags` из YAML. Ошибка — исключение с понятным сообщением.
 * @param {string} [path]
 * @returns {SiteFlags}
 */
export function readSiteFlags(path = DEFAULT_SITE_YAML) {
  if (!existsSync(path)) throw new Error(`нет файла ${path}`);
  const flags = parse(readFileSync(path, 'utf8'))?.site?.flags;
  if (flags === null || typeof flags !== 'object') throw new Error(`${path}: нет группы site.flags`);
  /** @type {Partial<SiteFlags>} */
  const result = {};
  for (const flag of SITE_FLAGS) {
    const value = flags[flag];
    if (typeof value !== 'boolean') throw new Error(`${path}: site.flags.${flag} — не true/false`);
    result[flag] = value;
  }
  return /** @type {SiteFlags} */ (result);
}

/**
 * @param {string[]} args
 * @returns {{ code: number, out?: string, error?: string }}
 */
export function runCli(args) {
  const usage = `вызов: node scripts/lib/site-flags.mjs <${SITE_FLAGS.join('|')}> [--site <путь>]`;
  let site = DEFAULT_SITE_YAML;
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--site') {
      const value = args[++i];
      if (value === undefined) return { code: 2, error: usage };
      site = value;
    } else {
      positional.push(/** @type {string} */ (args[i]));
    }
  }
  const [flag] = positional;
  if (positional.length !== 1 || !SITE_FLAGS.includes(/** @type {SiteFlag} */ (flag))) {
    return { code: 2, error: `неизвестный флаг «${positional.join(' ')}»; ${usage}` };
  }
  try {
    return { code: 0, out: readSiteFlags(site)[/** @type {SiteFlag} */ (flag)] ? 'on' : 'off' };
  } catch (error) {
    return { code: 2, error: /** @type {Error} */ (error).message };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, error } = runCli(process.argv.slice(2));
  if (out !== undefined) console.log(out);
  if (error !== undefined) console.error(`site-flags: ${error}`);
  process.exit(code);
}
