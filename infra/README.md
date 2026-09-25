# infra — конфигурация сервера belkascm.ru

Сервер — VPS в РФ (Ubuntu 24.04, nginx 1.24). Всё, что на нём относится к
belkascm.ru, берётся из этого каталога (Constitution 9). Ручные шаги ниже —
единственный способ менять сервер; правки мимо git запрещены.

**На сервере живёт соседний сайт.** Его vhost, пользователь `deploy`, сервис и
файлы не трогаются. Мы только добавляем новые файлы и нового пользователя.
Перед изменением nginx записываются `ls -l` и `sha256sum` чужих конфигов, после —
сверяются. `nginx -t` — перед каждым `reload`. После `reload` проверяется
соседний сайт по своему домену и его backend. Если у соседа сбой, наше
изменение сразу откатывается.

IP сервера, имя соседнего сайта и ключи в репозиторий не пишутся.

## Состав

| Путь | Куда на сервере |
|---|---|
| `deploy/belka-deploy` | `/usr/local/bin/belka-deploy` (`root:root 0755`) |
| `deploy/authorized_keys.example` | образец `/home/deploy-belka/.ssh/authorized_keys` |
| `deploy/stub/` | первичный технический релиз `0000…0000` (40 нулей) в обоих окружениях |
| `nginx/00-default.conf` | `/etc/nginx/sites-available/` + симлинк в `sites-enabled/` |
| `nginx/belkascm.ru.conf` | то же |
| `nginx/staging.belkascm.ru.conf` | то же |
| `nginx/belkascm-maps.conf` | то же (контекст `http`: `map` для `Cache-Control`) |
| `nginx/snippets/*.conf` | `/etc/nginx/snippets/belkascm/` |
| `certbot/renewal-hooks/deploy/belkascm-reload-nginx` | `/etc/letsencrypt/renewal-hooks/deploy/` (`root:root 0755`) |
| `monitor/check-site.sh` | на сервер не ставится: его запускает `.github/workflows/monitor.yml` |
| `deploy/ci-deploy.sh`, `deploy/smoke.sh` | на сервер не ставятся: выкладка и смоук из `.github/workflows/deploy.yml` (и отката) |

## Пользователь и деплой (T12)

CI выкладывает сайт через SSH под пользователем `deploy-belka`. Shell он не
получает: каждый ключ в `authorized_keys` привязан к forced command
`belka-deploy <env>`, окружение задаёт строка ключа, а не клиент. Контракт команд —
`plan.md → «Контракт деплоя»` и заголовок `deploy/belka-deploy`.

Раскладка на сервере:

```text
/srv/belkascm/            root:root 0755
├── acme/                 root:root 0755 — webroot certbot, nginx читает
├── prod/                 deploy-belka 0755
│   ├── releases/<sha>/   последние 5 релизов + текущий
│   └── current -> releases/<sha>
└── staging/              deploy-belka 0755, то же
```

Установка (под root; файлы из репозитория копируются во временный каталог,
например `/root/belka-infra/`):

```sh
# 1. Пользователь: без пароля (в shadow «!»), без sudo, shell /bin/bash — нужен для forced command.
useradd --create-home --user-group --shell /bin/bash deploy-belka
chmod 0700 /home/deploy-belka

# Проверка обёртки на сервере до установки: под deploy-belka, во временном каталоге.
install -d -m 0755 /tmp/belka-test /tmp/belka-test/tests
install -m 0755 belka-deploy /tmp/belka-test/belka-deploy
install -m 0755 belka-deploy.test.sh /tmp/belka-test/tests/belka-deploy.test.sh
runuser -u deploy-belka -- bash /tmp/belka-test/tests/belka-deploy.test.sh   # «провалено 0»
rm -rf /tmp/belka-test

# 2. Каталоги.
install -d -o root -g root -m 0755 /srv/belkascm /srv/belkascm/acme
install -d -o deploy-belka -g deploy-belka -m 0755 \
  /srv/belkascm/prod /srv/belkascm/prod/releases \
  /srv/belkascm/staging /srv/belkascm/staging/releases

# 3. Обёртка — совпадает с deploy/belka-deploy побайтно.
install -o root -g root -m 0755 belka-deploy /usr/local/bin/belka-deploy
sha256sum /usr/local/bin/belka-deploy   # = sha256sum infra/deploy/belka-deploy

# 4. Ключи CI (по образцу deploy/authorized_keys.example, публичные части).
install -d -o deploy-belka -g deploy-belka -m 0700 /home/deploy-belka/.ssh
install -o deploy-belka -g deploy-belka -m 0600 authorized_keys /home/deploy-belka/.ssh/authorized_keys
```

Первичный релиз выкладывается уже через SSH, как это делает CI: у nginx
появляется `current`, а прод-домен до первой гейтованной выкладки (T20) не
показывает ничего неутверждённого (пустая страница с `noindex`, без текста):

```sh
tar -czf stub.tar.gz -C infra/deploy/stub index.html 404.html
ssh -i <ключ окружения> deploy-belka@<сервер> "release 0000000000000000000000000000000000000000" < stub.tar.gz
# → activated 0000000000000000000000000000000000000000
```

### Ключи и секреты GitHub

- Две пары ed25519 — своя на окружение, комментарии `belka-ci-staging` и
  `belka-ci-prod` (без имён людей). Генерируются вне репозитория:
  `ssh-keygen -t ed25519 -N '' -C belka-ci-staging -f <временный каталог>/belka-ci-staging`.
- Приватные ключи живут только в секретах окружений GitHub; локальные копии
  удаляются после проверки.
- Секреты окружений `staging` и `production` (`gh secret set <имя> --env <окружение>`):

  | Секрет | Значение |
  |---|---|
  | `DEPLOY_HOST` | IP сервера |
  | `DEPLOY_SSH_KEY` | приватный ключ окружения |
  | `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 <сервер> \| grep -v '^#'` — одна строка, отпечаток (`ssh-keygen -lf`) сверен с известным |
  | `STAGING_BASIC_AUTH` | только `staging`: строка `user:pass` basic auth стейджинга (T15) |

- Ротация ключа: новая пара → строка в `authorized_keys` → секрет → проверка
  выкладки → удаление старой строки.

Проверки после установки: `release` стаба отвечает `activated`; любая другая
команда (`ls`) — код 64; запрос PTY отклоняется (`PTY allocation request
failed`), `scp`, `sftp` и проброс портов не проходят (`restrict`, forced command
получает их как неверную команду); staging-ключ пишет только в
`/srv/belkascm/staging`, prod-ключ не видит его релизы (`activate` → код 2).

`restrict` + forced command держатся на настройках sshd по умолчанию в Ubuntu
24.04: `PermitUserEnvironment no`, `AcceptEnv LANG LC_*`, `UsePAM yes` (вход по
ключу при заблокированном пароле). `AllowUsers` не задан.

## nginx, этап HTTP (T13)

Этот шаг обязан предшествовать DNS: в nginx соседнего сайта нет
`default_server`, и без наших блоков belkascm.ru открыл бы соседний сайт.

```sh
# До: состояние чужих конфигов.
ls -l /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/conf.d
sha256sum /etc/nginx/nginx.conf /etc/nginx/sites-available/*

# Установка: только новые файлы и симлинки на них.
for f in 00-default.conf belkascm.ru.conf staging.belkascm.ru.conf; do
  install -o root -g root -m 0644 "$f" "/etc/nginx/sites-available/$f"
  ln -s "/etc/nginx/sites-available/$f" "/etc/nginx/sites-enabled/$f"
done
nginx -t && systemctl reload nginx

# После: те же ls и sha256sum — чужие файлы без изменений; сосед и его backend работают.
```

Проверки:

```sh
curl -si -H 'Host: belkascm.ru' http://127.0.0.1/           # 200, пустая заглушка
curl -si -H 'Host: www.belkascm.ru' http://127.0.0.1/       # 200
curl -si -H 'Host: staging.belkascm.ru' http://127.0.0.1/   # 200, X-Robots-Tag: noindex, nofollow
curl -si http://127.0.0.1/                                  # пустой ответ: соединение закрыто (444)
curl -si -H 'Host: unknown.example' http://127.0.0.1/       # то же
echo | openssl s_client -connect 127.0.0.1:443 -servername unknown.example
                                                            # alert 112 unrecognized name, сертификата нет
```

Catch-all меняет поведение только для голого IP и неизвестных доменов: раньше
там отвечал соседний сайт, теперь соединение закрывается. Блок на 443
(`ssl_reject_handshake on`) поставлен **до DNS** belkascm.ru: пока у нас нет
своих сертификатов, HTTPS к belkascm.ru отклоняется на рукопожатии, а не
получает сертификат соседа. HTTPS-блоки belkascm — в T15.

Логи — `/var/log/nginx/belkascm*.log`; системный logrotate nginx хранит их 14 дней.

Откат шага: удалить три симлинка из `sites-enabled`, `nginx -t`, `reload`.

## TLS, HTTPS и стейджинг за паролем (T15)

Сертификаты — certbot `--webroot` через ACME-каталог HTTP-блоков, поэтому их
выпускают **до** установки HTTPS-версий конфигов: те ссылаются на файлы в
`/etc/letsencrypt/live/`, без них `nginx -t` не пройдёт. A-записи всех трёх имён
должны резолвиться на сервер, AAAA — не заводиться (у сервера нет IPv6, а
Let's Encrypt предпочитает IPv6).

```sh
# Сначала пробный выпуск, затем настоящий. --account — prod-учётка ACME сервера
# (ls /etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/).
for dry in --dry-run ""; do
  certbot certonly $dry --non-interactive --webroot -w /srv/belkascm/acme --account <id> \
    --cert-name belkascm.ru -d belkascm.ru -d www.belkascm.ru
  certbot certonly $dry --non-interactive --webroot -w /srv/belkascm/acme --account <id> \
    --cert-name staging.belkascm.ru -d staging.belkascm.ru
done
```

Пароль стейджинга генерируется вне репозитория, на сервер уходит только хеш
(`apache2-utils` не ставится):

```sh
PASS=$(openssl rand -base64 18 | tr '+/' '-_')
printf 'belka:%s\n' "$(openssl passwd -apr1 "$PASS")" > staging.htpasswd  # → сервер
printf 'belka:%s' "$PASS" | gh secret set STAGING_BASIC_AUTH --env staging  # для смоука
# Пароль — в менеджер паролей владельца; локальные файлы удалить.
```

Установка (под root, из временного каталога с копией `infra/`):

```sh
install -o root -g www-data -m 0640 staging.htpasswd /etc/nginx/belkascm-staging.htpasswd
install -d -o root -g root -m 0755 /etc/nginx/snippets/belkascm
install -o root -g root -m 0644 nginx/snippets/*.conf /etc/nginx/snippets/belkascm/
for f in belkascm-maps.conf belkascm.ru.conf staging.belkascm.ru.conf; do
  install -o root -g root -m 0644 "nginx/$f" "/etc/nginx/sites-available/$f"
done
ln -s /etc/nginx/sites-available/belkascm-maps.conf /etc/nginx/sites-enabled/belkascm-maps.conf
install -o root -g root -m 0755 certbot/renewal-hooks/deploy/belkascm-reload-nginx \
  /etc/letsencrypt/renewal-hooks/deploy/belkascm-reload-nginx
nginx -t && systemctl reload nginx
certbot renew --dry-run          # наши сертификаты — success
systemctl is-active certbot.timer
```

Как устроены блоки:

- HTTP (80) отвечает сам только на `/.well-known/acme-challenge/`, остальное —
  301 на `https://belkascm.ru` (или `https://staging.belkascm.ru`) с путём.
  `https://www.belkascm.ru/…` — 301 на apex с путём.
- `listen 443 ssl http2` — параметр `http2` общий для адреса:порта, у соседнего
  сайта он и так включён. Catch-all 443 (`00-default.conf`) отклоняет
  рукопожатие с неизвестным SNI.
- Все `add_header` — на уровне `server`, в наших `location` своих нет:
  `add_header` в `location` отменил бы унаследованные заголовки безопасности.
  `Cache-Control` выбирает `map` из `belkascm-maps.conf` (`/_astro/*` — год и
  `immutable`, остальное — `no-cache`).
- Стейджинг: `auth_basic` на весь server, `X-Robots-Tag: noindex, nofollow` с
  `always` — и в ответах 401.
- `error_page 404 /404.html` — страница из текущего релиза.
- Deploy-hook certbot `belkascm-reload-nginx` перечитывает nginx после
  продления любого сертификата. У соседнего сайта в том же каталоге свой hook —
  двойной `reload` безвреден.

Проверки:

```sh
curl -sI https://belkascm.ru/                        # 200, HSTS, CSP, nosniff, Referrer-Policy, Permissions-Policy
curl -sI http://belkascm.ru/a?b                      # 301 → https://belkascm.ru/a?b
curl -sI https://www.belkascm.ru/any/path/           # 301 → https://belkascm.ru/any/path/
curl -sI https://staging.belkascm.ru/                # 401, X-Robots-Tag
curl -sI -u "$STAGING_BASIC_AUTH" https://staging.belkascm.ru/   # 200, X-Robots-Tag
curl -s https://belkascm.ru/nope                     # 404, тело — 404.html релиза
```

Откат шага: вернуть HTTP-версии `belkascm.ru.conf` и `staging.belkascm.ru.conf`
из git (T13), удалить симлинк `belkascm-maps.conf`, `nginx -t`, `reload`.
Сертификаты и htpasswd откат не мешают.
