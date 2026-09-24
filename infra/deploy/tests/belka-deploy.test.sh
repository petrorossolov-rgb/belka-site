#!/usr/bin/env bash
# Тест belka-deploy (T11): без root и сети, на временном BELKA_DEPLOY_ROOT и настоящих tar.gz.
#   bash infra/deploy/tests/belka-deploy.test.sh
# Под Git Bash (Windows) симлинки эмулируются MSYS (winsymlinks:sys): нативные требуют прав
# администратора, а копия вместо ссылки сломала бы проверку current. На Linux переменная не нужна.
set -euo pipefail
export LC_ALL=C

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
wrapper="$here/../belka-deploy"
case $(uname -s) in
  MINGW* | MSYS*) export MSYS="${MSYS:+$MSYS }winsymlinks:sys" ;;
esac

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
export BELKA_DEPLOY_ROOT="$work/srv"
env_dir="$BELKA_DEPLOY_ROOT/staging"
releases="$env_dir/releases"

tests=0
failures=0
status=0
out=''
err=''

# SHA из числа: 40 hex-символов в нижнем регистре.
sha() { printf '%040x' "$1"; }

reset() {
  rm -rf -- "$BELKA_DEPLOY_ROOT"
  mkdir -p "$releases"
}

# Каталог сборки с index.html (метка $1) и файлом в подкаталоге.
make_src() {
  local src
  src=$(mktemp -d "$work/src-XXXXXX")
  printf '<!doctype html><p>%s</p>\n' "$1" >"$src/index.html"
  mkdir -p "$src/_astro"
  printf 'body{}\n' >"$src/_astro/site.css"
  printf '%s\n' "$src"
}

# tar.gz сборки с меткой $1 — как в CI: tar -C dist -cz .
archive() {
  local src file="$work/$1.tar.gz"
  src=$(make_src "$1")
  tar -C "$src" -czf "$file" .
  printf '%s\n' "$file"
}

# run <команда> [файл для stdin] → status, out, err
run() {
  local stdin=${2:-/dev/null}
  set +e
  out=$(SSH_ORIGINAL_COMMAND="$1" bash "$wrapper" staging <"$stdin" 2>"$work/stderr")
  status=$?
  set -e
  err=$(<"$work/stderr")
}

current() { readlink "$env_dir/current" 2>/dev/null || printf 'нет\n'; }
listing() { (cd "$env_dir" && find . | sort); }
release_count() { find "$releases" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '; }

check() {
  local name=$1
  shift
  tests=$((tests + 1))
  if "$@"; then
    printf 'ok    %s\n' "$name"
  else
    failures=$((failures + 1))
    printf 'FAIL  %s\n' "$name"
    printf '      код %s; stdout: %s; stderr: %s\n' "$status" "$out" "$err"
  fi
}

eq() {
  [[ $1 == "$2" ]] || {
    printf '      ожидалось «%s», получено «%s»\n' "$2" "$1"
    return 1
  }
}
contains() { [[ $1 == *"$2"* ]]; }
exists() { [[ -e $1 ]]; }
absent() { [[ ! -e $1 && ! -L $1 ]]; }

# Отказ без изменения current и без временных файлов в каталоге окружения.
check_rejected() {
  local name=$1 code=$2 before=$3
  check "$name: код $code" eq "$status" "$code"
  check "$name: каталог окружения не изменился" eq "$(listing)" "$before"
}

A=$(sha 1)
B=$(sha 2)

# --- release, переключение, откат -------------------------------------------------------------
reset
run "release $A" "$(archive a)"
check 'release A: код 0' eq "$status" 0
check 'release A: ответ «activated <sha>»' eq "$out" "activated $A"
check 'release A: current → releases/A' eq "$(current)" "releases/$A"
check 'release A: содержимое распаковано' contains "$(<"$env_dir/current/index.html")" '<p>a</p>'
check 'release A: подкаталоги на месте' exists "$env_dir/current/_astro/site.css"

run "release $B" "$(archive b)"
check 'release B: код 0' eq "$status" 0
check 'release B: current → releases/B' eq "$(current)" "releases/$B"
check 'release B: A сохранён' exists "$releases/$A/index.html"

run "activate $A"
check 'activate A (откат): код 0' eq "$status" 0
check 'activate A: ответ' eq "$out" "activated $A"
check 'activate A: current → releases/A' eq "$(current)" "releases/$A"
check 'activate A: current отдаёт старую версию' contains "$(<"$env_dir/current/index.html")" '<p>a</p>'

before=$(listing)
run "activate $(sha 99)"
check_rejected 'activate неизвестного' 2 "$before"
check 'activate неизвестного: «unknown release»' contains "$err" 'unknown release'

# --- повторный release того же SHA --------------------------------------------------------------
run "release $B" "$(archive b-again)"
check 'повторный release B: код 0' eq "$status" 0
check 'повторный release B: current → releases/B' eq "$(current)" "releases/$B"
check 'повторный release B: выложенный каталог не перезаписан' contains "$(<"$env_dir/current/index.html")" '<p>b</p>'
run "release $B" "$(archive b-third)"
check 'третий release B: current валиден' eq "$(current)" "releases/$B"
check 'третий release B: index.html на месте' exists "$env_dir/current/index.html"

# --- мусорные команды: 64, без побочных эффектов ------------------------------------------------
before=$(listing)
for command in \
  '' \
  'rm -rf /' \
  'release' \
  "release $A extra" \
  " release $A" \
  "release  $A" \
  "activate $A;id" \
  "deploy $A" \
  "release ${A:0:39}" \
  "release ${A}0" \
  "release $(printf '%040X' 171)" \
  "activate ../../etc" \
  "release $A"$'\n'"activate $B"; do
  run "$command" "$(archive junk)"
  check_rejected "команда «${command//$'\n'/\\n}»" 64 "$before"
done

check 'SHA в верхнем регистре → 64' eq "$(run "activate $(printf '%040X' 171)"; printf '%s' "$status")" 64

set +e
SSH_ORIGINAL_COMMAND="activate $A" bash "$wrapper" production >/dev/null 2>&1
status=$?
set -e
check 'окружение не из списка → 64' eq "$status" 64
set +e
SSH_ORIGINAL_COMMAND="activate $A" bash "$wrapper" >/dev/null 2>&1
status=$?
set -e
check 'без окружения → 64' eq "$status" 64
set +e
SSH_ORIGINAL_COMMAND="activate $A" bash "$wrapper" staging extra >/dev/null 2>&1
status=$?
set -e
check 'лишний аргумент окружения → 64' eq "$status" 64

# --- негодные архивы: 65, current не меняется ---------------------------------------------------
C=$(sha 3)
before=$(listing)

: >"$work/empty"
run "release $C" "$work/empty"
check_rejected 'пустой stdin' 65 "$before"

printf 'это не архив\n' >"$work/garbage"
run "release $C" "$work/garbage"
check_rejected 'не tar.gz' 65 "$before"

src=$(make_src evil)
mkdir -p "$src/site"
mv "$src/index.html" "$src/site/index.html"
printf 'evil\n' >"$src/evil"
tar -C "$src/site" -czPf "$work/dotdot.tar.gz" ./index.html ../evil
run "release $C" "$work/dotdot.tar.gz"
check_rejected 'tar с ../evil' 65 "$before"
check 'tar с ../evil: отказ проверки до распаковки' contains "$err" 'путь с «..»: ../evil'
check 'tar с ../evil: снаружи ничего не записано' absent "$releases/evil"

tar -C "$src/site" -czPf "$work/absolute.tar.gz" ./index.html "$src/evil"
run "release $C" "$work/absolute.tar.gz"
check_rejected 'tar с абсолютным путём' 65 "$before"
check 'tar с абсолютным путём: отказ проверки до распаковки' contains "$err" 'абсолютный путь: /'

src=$(make_src link)
ln -s /etc/passwd "$src/passwd"
tar -C "$src" -czf "$work/symlink.tar.gz" .
run "release $C" "$work/symlink.tar.gz"
check_rejected 'tar с симлинком наружу' 65 "$before"
check 'tar с симлинком: отказ проверки до распаковки' contains "$err" 'запрещённый тип записи «l»: ./passwd'

src=$(make_src noindex)
rm "$src/index.html"
tar -C "$src" -czf "$work/noindex.tar.gz" .
run "release $C" "$work/noindex.tar.gz"
check_rejected 'tar без index.html' 65 "$before"

check 'после отказов нет временных файлов' eq "$(find "$env_dir" -name '.*' | wc -l | tr -d ' ')" 0

# --- хранение: 5 последних, текущий не удаляется -------------------------------------------------
reset
for n in 1 2 3 4 5 6 7; do
  run "release $(sha "$n")" "$(archive "r$n")"
done
check '7 релизов → осталось 5' eq "$(release_count)" 5
check '7 релизов: current — седьмой' eq "$(current)" "releases/$(sha 7)"
check '7 релизов: седьмой на месте' exists "$releases/$(sha 7)"
check '7 релизов: удалены два старейших' absent "$releases/$(sha 1)"
check '7 релизов: второй удалён' absent "$releases/$(sha 2)"
check '7 релизов: третий сохранён' exists "$releases/$(sha 3)"

reset
for n in 1 2 3 4 5; do
  run "release $(sha "$n")" "$(archive "r$n")"
done
run "activate $(sha 1)"
# Шестой релиз новее всех, current — самый старый.
mkdir "$releases/$(sha 6)"
touch "$releases/$(sha 6)"
run "activate $(sha 1)"
check 'текущий старше пяти: activate — код 0' eq "$status" 0
check 'текущий старше пяти: не удалён' exists "$releases/$(sha 1)/index.html"
check 'текущий старше пяти: 5 свежих + текущий' eq "$(release_count)" 6
run "release $(sha 7)" "$(archive r7)"
check 'после нового релиза прежний текущий удалён' absent "$releases/$(sha 1)"
check 'после нового релиза осталось 5' eq "$(release_count)" 5

printf '\n%s: %d проверок, провалено %d\n' "$(basename "$0")" "$tests" "$failures"
((failures == 0))
