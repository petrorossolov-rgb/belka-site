#!/usr/bin/env bash
# Мониторинг belkascm.ru (T19): запускается из .github/workflows/monitor.yml.
#   1. https://belkascm.ru/ отвечает 200;
#   2. https://www.belkascm.ru/ отвечает 301 на https://belkascm.ru/;
#   3. сертификаты belkascm.ru и staging.belkascm.ru действуют ещё дольше
#      MIN_DAYS дней (по умолчанию 20).
# Код 0 — всё в порядке, 1 — хотя бы одна проверка не прошла, 2 — неверный вызов.
# Сторонних сервисов нет: только curl и openssl раннера.
set -euo pipefail
export LC_ALL=C

readonly APEX=belkascm.ru
readonly MIN_DAYS="${MIN_DAYS:-20}"

if [[ $# -ne 0 || ! "$MIN_DAYS" =~ ^[0-9]+$ ]]; then
  echo "usage: [MIN_DAYS=<дней>] $0" >&2
  exit 2
fi

failed=0

ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; failed=1; }

# Код ответа и адрес редиректа без перехода по нему. Повторы — от сетевых сбоев.
probe() {
  curl -sS -o /dev/null --max-time 20 --retry 2 --retry-all-errors \
    -w '%{http_code} %{redirect_url}' "$1" || true
}

read -r code _ <<<"$(probe "https://$APEX/")"
if [[ "$code" == 200 ]]; then
  ok "https://$APEX/ → 200"
else
  bad "https://$APEX/ → ${code:-нет ответа}, ожидался 200"
fi

read -r code location <<<"$(probe "https://www.$APEX/")"
if [[ "$code" == 301 && "$location" == "https://$APEX/" ]]; then
  ok "https://www.$APEX/ → 301 $location"
else
  bad "https://www.$APEX/ → ${code:-нет ответа} ${location:-}, ожидался 301 https://$APEX/"
fi

for host in "$APEX" "staging.$APEX"; do
  cert="$(openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null |
    openssl x509 2>/dev/null || true)"
  if [[ -z "$cert" ]]; then
    bad "$host: сертификат не получен"
    continue
  fi
  end="$(openssl x509 -noout -enddate <<<"$cert")"
  end="${end#notAfter=}"
  if openssl x509 -noout -checkend $((MIN_DAYS * 86400)) >/dev/null <<<"$cert"; then
    ok "$host: сертификат до $end (порог $MIN_DAYS дн.)"
  else
    bad "$host: сертификат до $end — меньше $MIN_DAYS дн."
  fi
done

exit "$failed"
