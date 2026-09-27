// Карта видов мокапа (Constitution 2): вид выбирается только через неё. Тип — по всем значениям
// `MOCKUP_KIND_NAMES` схемы: новый вид без компонента не пройдёт `astro check`. Новый вид —
// осознанная правка каркаса: значение в схеме, компонент, пункт карты, фикстура, mock-токены и
// пары контраста (runbook «как добавить продукт»).

import type { Mockup } from '../../lib/content';
import type { MockupKind } from '../../lib/schemas';
import Console from './kinds/Console.astro';
import Dashboard from './kinds/Dashboard.astro';
import Pack from './kinds/Pack.astro';
import Terminal from './kinds/Terminal.astro';

/** Данные мокапа одного вида. */
export type MockupOf<K extends MockupKind> = Extract<Mockup['data'], { kind: K }>;

/** Компонент вида: принимает данные своего вида. */
type KindView<K extends MockupKind> = (props: { mockup: MockupOf<K> }) => unknown;

export const MOCKUP_KINDS: { [K in MockupKind]: KindView<K> } = {
  console: Console,
  terminal: Terminal,
  pack: Pack,
  dashboard: Dashboard,
};
