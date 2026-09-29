/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// Тесты, которые запускают системный Chrome (гейты адаптива и согласия), идут отдельной группой
// после остальных (ep05 T10): одновременно с ними тесты с дочерними процессами (CLI, Stylelint)
// под нагрузкой упирались в таймаут 5 с. Проекты наследуют корневой конфиг (плагины Astro),
// массивы сливаются — поэтому include задан только в проектах.
const CHROME = ['tests/check-layout.test.ts', 'tests/check-consent.test.ts'];

export default getViteConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: CHROME, sequence: { groupOrder: 0 } } },
      { test: { name: 'chrome', include: CHROME, sequence: { groupOrder: 1 } } },
    ],
  },
});
