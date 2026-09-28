// @ts-check
// Оверлей пробы «флаг вкл.» (ep05): включает Метрику в настоящем `site.yaml` рабочей копии, чтобы
// задание CI `metrika-probe` собрало staging-сборку с плашкой и скриптом согласия.
//
// ТОЛЬКО рабочая копия CI или локальная проверка. После локального запуска —
// `git checkout src/content/site.yaml`. Результат не коммитится (Constitution 10).
//
//   node scripts/metrika-probe-site.mjs [--site src/content/site.yaml]
//
// Ставит `flags.legalEntityReady` и `flags.metrikaEnabled`, тестовый `metrika.counterId` и
// заведомо тестовые реквизиты: ИНН и ОГРН из нулей проходят формат схемы, но не принадлежат
// никакой организации (кода региона 00 нет, такие номера не выдаются), название и адрес помечены
// «проба». Строки
// плашки (`site.consent`) и подписи реквизитов (`site.legalLabels`) оверлей не создаёт — они живут
// в контенте; без `site.consent` — код 1. Комментарии и прочие поля файла сохраняются; повторный
// запуск даёт тот же файл. Код 2 — ошибка вызова или нет файла.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMap, parseDocument } from 'yaml';
import { DEFAULT_SITE_YAML } from './lib/site-flags.mjs';

/** Значения пробы. Счётчик и реквизиты — заведомо не настоящие: нули (репозиторий публичный). */
export const PROBE_VALUES = /** @type {const} */ ({
  counterId: '00000000',
  legal: {
    entityName: 'ООО «Проба»',
    inn: '0000000000',
    ogrn: '0000000000000',
    address: 'Адрес пробы',
    piiOperator: 'ООО «Проба»',
  },
});

/**
 * Накладывает оверлей на текст `site.yaml`.
 * @param {string} source
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function applyProbeOverlay(source) {
  const doc = parseDocument(source);
  if (doc.errors.length > 0) return { ok: false, error: `YAML не разобран: ${doc.errors[0]?.message}` };
  if (!isMap(doc.getIn(['site', 'consent']))) {
    return {
      ok: false,
      error: 'нет site.consent — строки плашки живут в контенте (src/content/site.yaml), оверлей их не создаёт',
    };
  }
  doc.setIn(['site', 'flags', 'legalEntityReady'], true);
  doc.setIn(['site', 'flags', 'metrikaEnabled'], true);
  doc.setIn(['site', 'metrika', 'counterId'], PROBE_VALUES.counterId);
  for (const [field, value] of Object.entries(PROBE_VALUES.legal)) {
    doc.setIn(['site', 'legal', field], value);
  }
  // `legal: {}` и `metrika: {}` в файле — flow-стиль; в блочном оверлей читается глазами.
  for (const group of ['legal', 'metrika']) {
    const node = doc.getIn(['site', group]);
    if (isMap(node)) node.flow = false;
  }
  return { ok: true, text: doc.toString() };
}

/**
 * @param {string[]} args
 * @returns {{ code: number, message: string }}
 */
export function runCli(args) {
  const usage = 'вызов: node scripts/metrika-probe-site.mjs [--site <путь>]';
  let site = DEFAULT_SITE_YAML;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--site' && args[i + 1] !== undefined) site = /** @type {string} */ (args[++i]);
    else return { code: 2, message: usage };
  }
  if (!existsSync(site)) return { code: 2, message: `нет файла ${site}` };
  const result = applyProbeOverlay(readFileSync(site, 'utf8'));
  if (!result.ok) return { code: 1, message: `${site}: ${result.error}` };
  writeFileSync(site, result.text);
  return { code: 0, message: `${site}: Метрика включена для пробы (не коммитить; git checkout ${site})` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, message } = runCli(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(`metrika-probe-site: ${message}`);
  process.exit(code);
}
