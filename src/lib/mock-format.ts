// Форма чисел в мокапах (ep03): числа в данных (`src/content/mockups/*.yaml`) — числами, кит
// выводит их только через эти функции. Правила совпадают с V4 `check-voice`: разряды — тонким
// пробелом от пяти цифр, процент — через узкий неразрывный пробел, дробь — через запятую.
// `Intl.NumberFormat('ru')` не подходит: он группирует неразрывным пробелом U+00A0, который V4
// роняет. Особые символы — через `String.fromCharCode`: инструмент записи файлов превращает
// escape-последовательности в невидимые символы (progress.md → «\uXXXX»).

/** Тонкий пробел U+2009 — разделитель разрядов. */
const THIN_SPACE = String.fromCharCode(0x2009);
/** Узкий неразрывный пробел U+202F — между числом и знаком процента. */
const NARROW_NBSP = String.fromCharCode(0x202f);
/** Знак минуса U+2212. */
const MINUS = String.fromCharCode(0x2212);

/** Разряды нужны от пяти цифр: «1284», но «12 500». */
const GROUP_FROM = 10_000;

function assertFinite(n: number): void {
  if (!Number.isFinite(n)) throw new Error(`mock-format: ожидается конечное число, получено ${n}`);
}

/** Целая часть: от пяти цифр — группы по три через тонкий пробел. */
function groupInteger(digits: string): string {
  if (digits.length < String(GROUP_FROM).length) return digits;
  return digits.replace(/\B(?=(\d{3})+$)/g, THIN_SPACE);
}

/** Целое число: 1284 → «1284», 12500 → «12 500» (U+2009); отрицательное — со знаком минуса. */
export function groupDigits(n: number): string {
  assertFinite(n);
  if (!Number.isInteger(n)) throw new Error(`mock-format: groupDigits ждёт целое число, получено ${n}; дробь — decimal`);
  return `${n < 0 ? MINUS : ''}${groupInteger(String(Math.abs(n)))}`;
}

/** Дробь с запятой: decimal(24.5) → «24,5», decimal(24) → «24,0»; целая часть — с разрядами. */
export function decimal(n: number, digits = 1): string {
  assertFinite(n);
  const [integer = '0', fraction] = Math.abs(n).toFixed(digits).split('.');
  const sign = n < 0 && Number(Math.abs(n).toFixed(digits)) !== 0 ? MINUS : '';
  return `${sign}${groupInteger(integer)}${fraction === undefined ? '' : `,${fraction}`}`;
}

/** Процент: 82 → «82 %», 98.5 → «98,5 %» (U+202F перед знаком). */
export function percent(n: number): string {
  assertFinite(n);
  return `${Number.isInteger(n) ? groupDigits(n) : decimal(n, 1)}${NARROW_NBSP}%`;
}

/** Неразрывный пробел U+00A0 — между числом и единицей измерения («4 уп.», «24,5 кг»). */
const NBSP = String.fromCharCode(0xa0);

/** Форма числа в мокапе: целое с разрядами, процент или дробь с одним знаком. */
export type NumberForm = 'count' | 'percent' | 'decimal';

/** Формы по имени: кит передаёт форму константой, а не строковым литералом в шаблоне. */
export const NUMBER_FORMS = { count: 'count', percent: 'percent', decimal: 'decimal' } as const satisfies Record<NumberForm, NumberForm>;

/** Число в своей форме и единица из данных через неразрывный пробел; у процента единица — знак. */
export function withUnit(n: number, unit?: string, form: NumberForm = 'count'): string {
  if (form === 'percent') return percent(n);
  const value = form === 'decimal' ? decimal(n) : groupDigits(n);
  return unit === undefined || unit === '' ? value : `${value}${NBSP}${unit}`;
}
