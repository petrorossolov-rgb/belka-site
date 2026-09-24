// @ts-check
// Локальный гейт приватного репозитория документов (docs/): ссылки в документах (lychee,
// офлайн, с якорями) и совпадение снимка ДС с исходниками. В публичном CI docs/ нет,
// поэтому гейт живёт здесь и запускается pre-commit-хуком репозитория документов.
//   npm run check:docs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('docs')) {
  console.error('check:docs: нет каталога docs/ — клонируйте репозиторий документов в docs/');
  process.exit(1);
}

/** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: false });
  if (result.error) {
    console.error(`check:docs: не запускается ${command}: ${result.error.message}`);
    if (command === 'lychee') console.error('  установка: winget install --id lycheeverse.lychee -e');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('lychee', ['--offline', '--include-fragments', '--no-progress', 'docs/**/*.md', 'CLAUDE.md', 'progress.md']);
run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/ds-sources.test.ts'], {
  ...process.env,
  REQUIRE_DOCS: '1',
});
