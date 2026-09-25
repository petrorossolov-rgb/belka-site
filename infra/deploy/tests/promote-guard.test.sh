#!/usr/bin/env bash
# Тест promote-guard: без сети, на строках в формате gh --jq из deploy.yml → verify.
#   bash infra/deploy/tests/promote-guard.test.sh
set -euo pipefail
export LC_ALL=C

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
guard="$here/../promote-guard.sh"

tests=0
failures=0

# check <ожидаемый код> <название> <stdin>
check() {
  local expected=$1 name=$2 input=$3 status
  tests=$((tests + 1))
  set +e
  printf '%s' "$input" | bash "$guard" 2>/dev/null
  status=$?
  set -e
  if [[ $status -ne $expected ]]; then
    failures=$((failures + 1))
    echo "FAIL: $name — код $status, ожидался $expected"
  fi
}

check 0 'identical' $'identical\n0\n'
check 0 'ahead, только контент и код сайта' $'ahead\n3\nsrc/content/products/wms.md\nsrc/pages/index.astro\nscripts/check-dist-seo.mjs\n'
check 0 'ahead без файлов' $'ahead\n0\n'
check 1 'менялся gates.yml' $'ahead\n2\nsrc/pages/index.astro\n.github/workflows/gates.yml\n'
check 1 'менялся deploy.yml' $'ahead\n1\n.github/workflows/deploy.yml\n'
check 1 'менялся скрипт деплоя' $'ahead\n1\ninfra/deploy/smoke.sh\n'
check 1 'переименование из .github' $'ahead\n1\ndocs-ci.yml\n.github/workflows/old.yml\n'
check 0 'infra вне deploy' $'ahead\n1\ninfra/nginx/belkascm.ru.conf\n'
check 1 'SHA позади HEAD' $'behind\n1\nsrc/pages/index.astro\n'
check 1 'история разошлась' $'diverged\n1\nsrc/pages/index.astro\n'
check 1 'пустой ответ (gh api упал)' ''
check 1 'негодное число файлов' $'ahead\nx\n'
check 1 'список обрезан API' $'ahead\n300\nsrc/pages/index.astro\n'
check 0 'префикс каталога, а не строки: .github-old/' $'ahead\n1\n.github-old/x\n'

echo "promote-guard: тестов $tests, провалено $failures"
((failures == 0))
