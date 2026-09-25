#!/usr/bin/env bash
# Выкладка и откат из CI (T17, T18): клиентская сторона контракта belka-deploy.
#   ci-deploy.sh release <sha> <каталог сборки>   tar.gz каталога → «release <sha>»
#   ci-deploy.sh activate <sha>                   «activate <sha>» — откат, повторная активация
# Окружение (секреты окружения GitHub): DEPLOY_HOST, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS.
# Какое окружение сервера (prod или staging) — решает ключ: forced command в authorized_keys.
#
# Ключ и known_hosts пишутся во временный каталог с правами 600 и удаляются при выходе.
# Хост проверяется строго (StrictHostKeyChecking=yes) по DEPLOY_KNOWN_HOSTS.
# Код выхода — код belka-deploy (0, 2 unknown release, 64, 65, 1); 2 — и при неверном
# вызове этого скрипта до соединения; 1 — если ответ не «activated <sha>».
set -euo pipefail
export LC_ALL=C

readonly USER_AT=deploy-belka
readonly SHA_RE='^[0-9a-f]{40}$'

usage() {
  echo "usage: $0 release <sha> <каталог сборки> | $0 activate <sha>" >&2
  exit 2
}

action=${1:-}
sha=${2:-}
case $action in
  release) [[ $# -eq 3 && -f ${3}/index.html ]] || usage ;;
  activate) [[ $# -eq 2 ]] || usage ;;
  *) usage ;;
esac
[[ $sha =~ $SHA_RE ]] || usage
for var in DEPLOY_HOST DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS; do
  if [[ -z ${!var:-} ]]; then
    echo "ci-deploy: не задана переменная $var" >&2
    exit 2
  fi
done

tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
(
  umask 077
  printf '%s\n' "$DEPLOY_SSH_KEY" >"$tmp/key"
  printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >"$tmp/known_hosts"
)

remote() {
  ssh -i "$tmp/key" \
    -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$tmp/known_hosts" \
    "$USER_AT@$DEPLOY_HOST" "$@"
}

status=0
if [[ $action == release ]]; then
  out=$(tar -C "$3" -cz . | remote "release $sha") || status=$?
else
  out=$(remote "activate $sha" </dev/null) || status=$?
fi
[[ -z $out ]] || printf '%s\n' "$out"
if ((status != 0)); then
  echo "ci-deploy: $action $sha — код $status" >&2
  exit "$status"
fi
if [[ $out != "activated $sha" ]]; then
  echo "ci-deploy: ожидался ответ «activated $sha»" >&2
  exit 1
fi
