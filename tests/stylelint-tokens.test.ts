import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

// Охват гейта токенов (Constitution 3): литерал размера, отступа, радиуса или движения
// вне tokens/** и theme.css роняет `npm run lint:css`. Список свойств расширен по
// /my-verify ep01 (F03 Codex): height, min-*, border/outline-шорткаты, transform,
// кастомные свойства в компонентах проходили гейт незамеченными.

const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function lint(css: string, file: string): Promise<string[]> {
  const { results } = await stylelint.lint({
    code: css,
    codeFilename: `${ROOT}${file}`,
    cwd: ROOT,
  });
  return results.flatMap((r) => r.warnings.map((w) => w.rule));
}

const COMPONENT = 'src/components/Probe.css';

describe('stylelint: литералы размеров только в слое темы', () => {
  it.each([
    'height: 16px',
    'min-height: 2rem',
    'min-width: 320px',
    'max-height: 10em',
    'width: 12px',
    'block-size: 4px',
    'inline-size: 4px',
    'flex-basis: 8px',
    'flex: 1 1 8px',
    'grid-template-columns: 1fr 200px',
    'border: 1px solid var(--color-line)',
    'border-top: 1px solid var(--color-line)',
    'border-radius: 4px',
    'outline: 2px solid var(--color-accent)',
    'outline-offset: 2px',
    'transform: translateX(4px)',
    'translate: 4px 0',
    'font: 16px/1.5 var(--font-sans)',
    'text-underline-offset: 3px',
    'scroll-margin-top: 8px',
    'margin: 16px',
    'gap: 1rem',
    'transition: color 200ms',
    'line-height: 24px',
    '--probe-gap: 12px',
    '--probe-duration: 300ms',
  ])('%s в компоненте — ошибка', async (decl) => {
    const rules = await lint(`.probe { ${decl}; }\n`, COMPONENT);
    expect(rules).toContain('declaration-property-unit-disallowed-list');
  });

  it.each([
    'height: 100%',
    'min-height: 100vh',
    'width: var(--size-content)',
    'border: var(--border-width-thin) solid var(--color-line)',
    'transform: translateX(var(--space-1))',
    'flex: 1 1 0%',
    '--probe-ratio: 1.5',
  ])('%s в компоненте — без ошибки', async (decl) => {
    const rules = await lint(`.probe { ${decl}; }\n`, COMPONENT);
    expect(rules).not.toContain('declaration-property-unit-disallowed-list');
  });

  it('в слое темы литералы разрешены', async () => {
    const rules = await lint(':root {\n  --probe-gap: 12px;\n}\n', 'src/styles/tokens/spacing.css');
    expect(rules).not.toContain('declaration-property-unit-disallowed-list');
  });
});
