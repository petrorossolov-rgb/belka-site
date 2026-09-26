// Форма чисел мокапов (ep03 T09): границы разрядов, процент, дробь и совместимость с V4
// `check-voice`. Особые символы в ожиданиях — через String.fromCharCode, как в модуле.
import { describe, expect, it } from 'vitest';
import { checkText } from '../scripts/check-voice.mjs';
import { decimal, groupDigits, percent } from '../src/lib/mock-format';

const THIN = String.fromCharCode(0x2009);
const NARROW = String.fromCharCode(0x202f);
const MINUS = String.fromCharCode(0x2212);

describe('groupDigits', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1000'],
    [9999, '9999'],
    [10000, `10${THIN}000`],
    [12500, `12${THIN}500`],
    [1284000, `1${THIN}284${THIN}000`],
  ])('%i → «%s»: разряды только от пяти цифр', (n, expected) => {
    expect(groupDigits(n)).toBe(expected);
  });

  it('отрицательное — со знаком минуса U+2212', () => {
    expect(groupDigits(-12500)).toBe(`${MINUS}12${THIN}500`);
  });

  it('дробь, NaN и бесконечность — ошибка', () => {
    for (const n of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => groupDigits(n), String(n)).toThrow(/mock-format/);
    }
  });
});

describe('percent', () => {
  it.each([
    [0, `0${NARROW}%`],
    [82, `82${NARROW}%`],
    [100, `100${NARROW}%`],
    [98.5, `98,5${NARROW}%`],
  ])('%d → «%s»', (n, expected) => {
    expect(percent(n)).toBe(expected);
  });

  it('NaN и бесконечность — ошибка', () => {
    expect(() => percent(Number.NaN)).toThrow(/конечное число/);
    expect(() => percent(Number.POSITIVE_INFINITY)).toThrow(/конечное число/);
  });
});

describe('decimal', () => {
  it.each([
    [24.5, 1, '24,5'],
    [24, 1, '24,0'],
    [0.25, 2, '0,25'],
    [12500.5, 1, `12${THIN}500,5`],
    [3, 0, '3'],
  ])('decimal(%d, %i) → «%s»', (n, digits, expected) => {
    expect(decimal(n, digits)).toBe(expected);
  });

  it('по умолчанию — один знак после запятой; отрицательное — с минусом, минус ноль — без', () => {
    expect(decimal(7)).toBe('7,0');
    expect(decimal(-2.5)).toBe(`${MINUS}2,5`);
    expect(decimal(-0.01)).toBe('0,0');
  });

  it('NaN и бесконечность — ошибка', () => {
    expect(() => decimal(Number.NaN)).toThrow(/конечное число/);
    expect(() => decimal(Number.NEGATIVE_INFINITY)).toThrow(/конечное число/);
  });
});

describe('совместимость с линтером голоса (V4)', () => {
  const samples = [
    groupDigits(999),
    groupDigits(9999),
    groupDigits(12500),
    groupDigits(1284000),
    percent(0),
    percent(82),
    percent(100),
    percent(98.5),
    decimal(24.5),
    decimal(12500.5),
  ];

  it.each(samples)('«%s» проходит checkText', (text) => {
    expect(checkText(`Значение ${text} на экране`)).toEqual([]);
  });

  it('проба: группировка неразрывным пробелом (как Intl ru) и число без разрядов V4 ловит', () => {
    const intl = new Intl.NumberFormat('ru').format(12500);
    expect(checkText(`Значение ${intl} на экране`).map((hit: { rule: string }) => hit.rule)).toContain('V4');
    expect(checkText('Значение 12500 на экране').map((hit: { rule: string }) => hit.rule)).toContain('V4');
  });
});
