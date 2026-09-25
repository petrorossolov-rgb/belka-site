#!/usr/bin/env bash
# Смоук окружения после выкладки или отката (T17, T18). Запускается из deploy.yml и rollback.yml.
#   smoke.sh staging|production [--dist <каталог сборки>] [--draft-routes <draft-routes.json>]
# Смоук не знает контента сайта: только инварианты окружения. Черновые маршруты — из
# draft-routes.json staging-сборки того же SHA (check-dist-seo.mjs), поэтому снятие draft
# с записи не требует правок смоука. С --dist тело «/» и 404 сверяется побайтно с
# index.html и 404.html выложенной сборки — это доказывает, что отвечает новый релиз.
#
# staging (https://staging.belkascm.ru, пароль — STAGING_BASIC_AUTH «user:pass»):
#   без пароля 401 с X-Robots-Tag; с паролем «/» 200 с X-Robots-Tag; robots.txt с «Disallow: /»;
#   случайный путь 404; каждый черновой маршрут 200 с плашкой «черновик».
# production (https://belkascm.ru):
#   «/» 200 с HSTS, CSP, nosniff и без X-Robots-Tag; robots.txt без «Disallow: /»;
#   случайный путь и каждый черновой маршрут staging — 404; www и http — 301 на https://belkascm.ru.
# Код 0 — всё в порядке, 1 — хотя бы одна проверка не прошла, 2 — неверный вызов.
# Пароль не печатается: curl получает его из файла конфигурации, в выводе — только коды.
set -euo pipefail
export LC_ALL=C

readonly APEX=belkascm.ru
readonly ROUTES_RE='^\[("/[^"\\]*"(,"/[^"\\]*")*)?\]$'

usage() {
  echo "usage: $0 staging|production [--dist <каталог>] [--draft-routes <draft-routes.json>]" >&2
  exit 2
}

env_name=${1:-}
[[ $env_name == staging || $env_name == production ]] || usage
shift
dist=''
routes_file=''
while (($# > 0)); do
  case $1 in
    --dist) [[ $# -ge 2 && -f ${2}/index.html && -f ${2}/404.html ]] || usage; dist=$2; shift 2 ;;
    --draft-routes) [[ $# -ge 2 && -f $2 ]] || usage; routes_file=$2; shift 2 ;;
    *) usage ;;
  esac
done

tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT

auth_args=()
if [[ $env_name == staging ]]; then
  base="https://staging.$APEX"
  if [[ ${STAGING_BASIC_AUTH:-} != *:* ]]; then
    echo "smoke: STAGING_BASIC_AUTH не задан или не в виде user:pass" >&2
    exit 2
  fi
  auth=${STAGING_BASIC_AUTH//\\/\\\\}
  (
    umask 077
    printf 'user = "%s"\n' "${auth//\"/\\\"}" >"$tmp/auth"
  )
  auth_args=(--config "$tmp/auth")
else
  base="https://$APEX"
fi

draft_routes=()
if [[ -n $routes_file ]]; then
  routes_json=$(tr -d '\r\n' <"$routes_file")
  [[ $routes_json =~ $ROUTES_RE ]] || {
    echo "smoke: $routes_file — не JSON-массив путей: $routes_json" >&2
    exit 2
  }
  while IFS= read -r route; do
    [[ -z $route ]] || draft_routes+=("${route//\"/}")
  done < <(grep -o '"[^"]*"' <<<"$routes_json" || true)
fi

failed=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; failed=1; }

# GET без перехода по редиректам: код в stdout, заголовки — $tmp/h, тело — $tmp/b.
# Повторы — только от сетевых сбоев (без --fail HTTP-коды ошибкой не считаются).
fetch() {
  rm -f -- "$tmp/h" "$tmp/b"
  curl -sS --max-time 20 --retry 2 --retry-all-errors -D "$tmp/h" -o "$tmp/b" \
    -w '%{http_code}' "$@" || true
}
header() { grep -i "^$1:" "$tmp/h" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//' || true; }
body_is() { [[ -f $tmp/b ]] && cmp -s -- "$tmp/b" "$1"; }

random_path="/smoke-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')/"

# --- «/» ---
code=$(fetch "${auth_args[@]}" "$base/")
if [[ $code == 200 ]]; then ok "$base/ → 200"; else bad "$base/ → ${code:-нет ответа}, ожидался 200"; fi
echo "      ETag: $(header etag); Last-Modified: $(header last-modified)"
if [[ -n $dist ]]; then
  if body_is "$dist/index.html"; then
    ok "$base/ = $dist/index.html выложенной сборки"
  else
    bad "$base/ не совпадает с $dist/index.html — отвечает не этот релиз"
  fi
fi
robots_tag=$(header x-robots-tag)
if [[ $env_name == staging ]]; then
  if [[ $robots_tag == *noindex* ]]; then ok "X-Robots-Tag: $robots_tag"; else bad "нет X-Robots-Tag с noindex"; fi
else
  if [[ -z $robots_tag ]]; then ok "X-Robots-Tag нет"; else bad "на проде X-Robots-Tag: $robots_tag"; fi
  for name in strict-transport-security content-security-policy; do
    value=$(header "$name")
    if [[ -n $value ]]; then ok "$name: $value"; else bad "нет заголовка $name"; fi
  done
  value=$(header x-content-type-options)
  if [[ $value == nosniff ]]; then ok "x-content-type-options: nosniff"; else bad "x-content-type-options: «$value», ожидался nosniff"; fi
fi

# --- стейджинг без пароля ---
if [[ $env_name == staging ]]; then
  code=$(fetch "$base/")
  robots_tag=$(header x-robots-tag)
  if [[ $code == 401 && $robots_tag == *noindex* ]]; then
    ok "$base/ без пароля → 401 с X-Robots-Tag"
  else
    bad "$base/ без пароля → ${code:-нет ответа}, X-Robots-Tag «$robots_tag», ожидался 401 с noindex"
  fi
fi

# --- robots.txt ---
code=$(fetch "${auth_args[@]}" "$base/robots.txt")
disallow_all=false
if [[ -f $tmp/b ]] && tr -d '\r' <"$tmp/b" | grep -qx 'Disallow: /'; then disallow_all=true; fi
if [[ $code != 200 ]]; then
  bad "$base/robots.txt → ${code:-нет ответа}, ожидался 200"
elif [[ $env_name == staging && $disallow_all == true ]]; then
  ok "$base/robots.txt: Disallow: /"
elif [[ $env_name == production && $disallow_all == false ]]; then
  ok "$base/robots.txt: индексация не запрещена"
else
  bad "$base/robots.txt: «Disallow: /» — $disallow_all, окружение $env_name"
fi

# --- несуществующий путь ---
code=$(fetch "${auth_args[@]}" "$base$random_path")
if [[ $code == 404 ]]; then ok "$base$random_path → 404"; else bad "$base$random_path → ${code:-нет ответа}, ожидался 404"; fi
if [[ -n $dist ]]; then
  if body_is "$dist/404.html"; then ok "тело 404 = $dist/404.html"; else bad "тело 404 не совпадает с $dist/404.html"; fi
fi

# --- черновые маршруты ---
if [[ -z $routes_file ]]; then
  echo "skip  черновые маршруты: список сборки не передан"
elif ((${#draft_routes[@]} == 0)); then
  echo "skip  черновые маршруты: в сборке черновиков нет ($routes_file = [])"
fi
for route in ${draft_routes[@]+"${draft_routes[@]}"}; do
  code=$(fetch "${auth_args[@]}" "$base$route")
  if [[ $env_name == staging ]]; then
    if [[ $code == 200 ]] && grep -q 'data-draft' "$tmp/b" && grep -q 'draft-banner' "$tmp/b"; then
      ok "$base$route → 200, черновик с плашкой"
    else
      bad "$base$route → ${code:-нет ответа}, ожидался 200 с data-draft и плашкой draft-banner"
    fi
  elif [[ $code == 404 ]]; then
    ok "$base$route (черновик) → 404"
  else
    bad "$base$route (черновик) → ${code:-нет ответа}, ожидался 404"
  fi
done

# --- редиректы прода ---
if [[ $env_name == production ]]; then
  for url in "https://www.$APEX$random_path" "http://$APEX$random_path" "http://www.$APEX$random_path"; do
    code=$(fetch "$url")
    location=$(header location)
    if [[ $code == 301 && $location == "https://$APEX$random_path" ]]; then
      ok "$url → 301 $location"
    else
      bad "$url → ${code:-нет ответа} ${location:-}, ожидался 301 https://$APEX$random_path"
    fi
  done
fi

exit "$failed"
