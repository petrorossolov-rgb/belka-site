#!/usr/bin/env bash
# Промоушн SHA, отличного от HEAD main (deploy.yml → verify; /my-verify ep01, F01 Codex).
# При workflow_dispatch reusable gates.yml и скрипты infra/deploy берутся из HEAD main, а
# сборка — из промоутимого SHA. Если между ними менялись .github/ или infra/deploy/, прод
# прошёл бы не те гейты и не тот деплой-контур, что стейджинг этого SHA (Constitution 9).
# Такой промоушн запрещён: выкладывать HEAD main или откатываться через rollback.yml.
#
# stdin — ответ compare API (<sha>...<HEAD main>), сжатый gh --jq до строк:
#   1   status: identical | ahead | behind | diverged
#   2   число файлов в ответе (API отдаёт не больше 300, остальное обрезает)
#   3+  пути изменённых файлов, для переименованных — и прежний путь
# Код выхода 0 — промоушн разрешён, 1 — запрещён или ответ негоден.
set -euo pipefail
export LC_ALL=C

readonly MAX_FILES=300

deny() {
  echo "promote-guard: $1" >&2
  exit 1
}

status=''
count=''
IFS= read -r status || true
IFS= read -r count || true

case $status in
  identical) exit 0 ;;
  ahead) ;;
  '') deny 'пустой ответ compare API' ;;
  *) deny "SHA не предок HEAD main (status «$status»)" ;;
esac
[[ $count =~ ^[0-9]+$ ]] || deny "негодное число файлов «$count»"
((count < MAX_FILES)) || deny "список файлов обрезан API ($count), состав изменений не проверить — выкладывайте HEAD main"

changed=()
while IFS= read -r path; do
  case $path in
    .github/* | infra/deploy/*) changed+=("$path") ;;
  esac
done

if ((${#changed[@]})); then
  echo "promote-guard: между SHA и HEAD main менялись гейты или деплой-контур:" >&2
  printf '  %s\n' "${changed[@]}" >&2
  deny 'прод прошёл бы не те гейты, что стейджинг, — выкладывайте HEAD main или откатывайтесь через rollback.yml'
fi
