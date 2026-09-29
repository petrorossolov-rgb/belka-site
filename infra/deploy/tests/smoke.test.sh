#!/usr/bin/env bash
# Тест smoke.sh production (ep05 T06): без сети, на заглушке curl в PATH. Заглушка отвечает
# как прод: «/» — index.html сборки, случайный путь — 404.html, www и http — 301. CSP берётся
# из настоящих сниппетов infra/nginx/snippets/. Проверяется сверка CSP со сборкой в одну
# сторону: js/consent.js в сборке и строгий CSP — провал; CSP «Метрика» без файла (окно между
# установкой nginx и промоушном) — не провал.
#   bash infra/deploy/tests/smoke.test.sh
set -euo pipefail
export LC_ALL=C

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
smoke="$here/../smoke.sh"
snippets="$here/../../nginx/snippets"

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

# Значение заголовка из сниппета: строка add_header Content-Security-Policy "…" always;
csp_of() { sed -n 's/^add_header Content-Security-Policy "\(.*\)" always;$/\1/p' "$snippets/$1"; }
csp_strict=$(csp_of csp-strict.conf)
csp_metrika=$(csp_of csp-metrika.conf)
[[ -n $csp_strict && -n $csp_metrika ]] || {
  echo "smoke.test: не прочитан CSP из сниппетов" >&2
  exit 1
}

# Пограничные политики: Метрика разрешена не во всех нужных директивах.
csp_script_only=${csp_strict/"script-src 'self'"/"script-src 'self' https://mc.yandex.ru"}
csp_img_only=${csp_strict/"img-src 'self' data:"/"img-src 'self' data: https://mc.yandex.ru"}
[[ $csp_script_only != "$csp_strict" && $csp_img_only != "$csp_strict" ]] || {
  echo "smoke.test: пограничные политики не собраны" >&2
  exit 1
}

mkdir -p "$work/bin"
cat >"$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Заглушка curl для smoke.test.sh: STUB_DIST — сборка, STUB_CSP — CSP ответов «/»,
# STUB_CSP_404 — CSP ответа 404 (пусто — заголовка нет).
set -euo pipefail
h='' b='' url=''
while (($# > 0)); do
  case $1 in
    -D) h=$2; shift 2 ;;
    -o) b=$2; shift 2 ;;
    -w | --max-time | --retry | --config) shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
headers=() code=200 body=''
case $url in
  https://belkascm.ru/)
    headers=("Strict-Transport-Security: max-age=300" "X-Content-Type-Options: nosniff")
    [[ -z $STUB_CSP ]] || headers+=("Content-Security-Policy: $STUB_CSP")
    body=$STUB_DIST/index.html ;;
  https://belkascm.ru/robots.txt)
    printf 'User-agent: *\nAllow: /\n' >"$b" ;;
  https://belkascm.ru/*)
    code=404
    [[ -z $STUB_CSP_404 ]] || headers+=("Content-Security-Policy: $STUB_CSP_404")
    body=$STUB_DIST/404.html ;;
  *)
    code=301
    headers=("Location: https://belkascm.ru/${url#*://*/}") ;;
esac
{
  printf 'HTTP/1.1 %s\r\n' "$code"
  for line in ${headers[@]+"${headers[@]}"}; do printf '%s\r\n' "$line"; done
  printf '\r\n'
} >"$h"
[[ -z $body ]] || cp -- "$body" "$b"
printf '%s' "$code"
STUB
chmod +x "$work/bin/curl"

# Сборка: index.html, 404.html и, по аргументу, js/consent.js.
make_dist() {
  local dist
  dist=$(mktemp -d "$work/dist-XXXXXX")
  printf '<!doctype html><p>index</p>\n' >"$dist/index.html"
  printf '<!doctype html><p>404</p>\n' >"$dist/404.html"
  if [[ $1 == with-consent ]]; then
    mkdir -p "$dist/js"
    printf '(function(){})();\n' >"$dist/js/consent.js"
  fi
  printf '%s\n' "$dist"
}

tests=0
failures=0

# check <ожидаемый код> <название> <сборка: with-consent|without> <CSP «/»> <CSP 404>
check() {
  local expected=$1 name=$2 dist status
  dist=$(make_dist "$3")
  tests=$((tests + 1))
  set +e
  PATH="$work/bin:$PATH" STUB_DIST=$dist STUB_CSP=$4 STUB_CSP_404=$5 \
    bash "$smoke" production --dist "$dist" >"$work/out" 2>&1
  status=$?
  set -e
  if [[ $status -ne $expected ]]; then
    failures=$((failures + 1))
    echo "FAIL: $name — код $status, ожидался $expected"
    sed 's/^/      /' "$work/out"
  fi
}

check 0 'без consent.js, строгий CSP (сейчас)' without "$csp_strict" "$csp_strict"
check 1 'consent.js в сборке, строгий CSP — Метрику заблокирует браузер' with-consent "$csp_strict" "$csp_strict"
check 0 'без consent.js, CSP «Метрика» — окно между nginx и промоушном' without "$csp_metrika" "$csp_metrika"
check 0 'consent.js в сборке, CSP «Метрика»' with-consent "$csp_metrika" "$csp_metrika"
check 1 'consent.js, mc.yandex.ru только в script-src' with-consent "$csp_script_only" "$csp_strict"
check 1 'consent.js, mc.yandex.ru только в img-src' with-consent "$csp_img_only" "$csp_strict"
check 1 '404 без CSP' without "$csp_strict" ''
check 1 '«/» без CSP' without '' "$csp_strict"

echo "smoke: тестов $tests, провалено $failures"
((failures == 0))
