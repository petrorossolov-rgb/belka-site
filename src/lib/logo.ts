// Геометрия знака Belka SCM. Растры — копии из docs/inputs/design-belka/design/assets/logo/
// без изменений; показываются не крупнее половины исходного разрешения, чтобы на 2x-экранах
// хватало пикселей. Пропорции lockup — guidelines/brand-logo.html: знак 64, словесный знак 30.

export type LogoVariant = 'mark' | 'wordmark' | 'lockup';

export interface Box {
  width: number;
  height: number;
}

export interface LogoLayout {
  /** Итоговая высота логотипа в CSS px после ограничения. */
  height: number;
  mark?: Box;
  wordmark?: Box;
}

/** Исходные размеры mark-rust.png. */
export const MARK_SOURCE: Box = { width: 450, height: 537 };
/** Исходные размеры wordmark-latin-*.png. */
export const WORDMARK_SOURCE: Box = { width: 707, height: 137 };
/** Высота словесного знака относительно высоты знака в lockup. */
export const LOCKUP_WORDMARK_RATIO = 30 / 64;

/** Самая большая высота показа: половина исходного разрешения. */
export function maxLogoHeight(variant: LogoVariant): number {
  const markMax = Math.floor(MARK_SOURCE.height / 2);
  const wordmarkMax = Math.floor(WORDMARK_SOURCE.height / 2);
  switch (variant) {
    case 'mark':
      return markMax;
    case 'wordmark':
      return wordmarkMax;
    case 'lockup':
      return Math.min(markMax, Math.floor(wordmarkMax / LOCKUP_WORDMARK_RATIO));
  }
}

function scale(source: Box, height: number): Box {
  return { width: Math.round((source.width * height) / source.height), height };
}

/**
 * Размеры картинок логотипа по высоте `size` (CSS px). Высота больше предела
 * обрезается до предела; нецелое значение округляется.
 */
export function logoLayout(variant: LogoVariant, size: number): LogoLayout {
  if (!Number.isFinite(size) || size < 1) {
    throw new Error(`Logo: size должен быть числом ≥ 1, получено ${size}`);
  }
  const height = Math.min(Math.round(size), maxLogoHeight(variant));
  switch (variant) {
    case 'mark':
      return { height, mark: scale(MARK_SOURCE, height) };
    case 'wordmark':
      return { height, wordmark: scale(WORDMARK_SOURCE, height) };
    case 'lockup':
      return {
        height,
        mark: scale(MARK_SOURCE, height),
        wordmark: scale(WORDMARK_SOURCE, Math.round(height * LOCKUP_WORDMARK_RATIO)),
      };
  }
}
