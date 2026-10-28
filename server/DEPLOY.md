# Развёртывание dwarfgym.live (сайт + API в одном контейнере)

Один процесс Node.js отдаёт игру (`dist/`) и API (`/api/...`) с одного адреса, поэтому CORS не нужен.
Данные (SQLite) лежат в `server/data/` на сервере. Видео и IP-адреса не хранятся.

## DNS

| Имя | Тип | Значение |
| --- | --- | --- |
| `@` (`dwarfgym.live`) | A | `212.95.35.181` |
| `www` | CNAME | `dwarfgym.live` |

## Запуск (под отдельным пользователем, не под root, если есть возможность)

```bash
git clone https://github.com/Sekach57/kamnelom.git /opt/dwarfgym
cd /opt/dwarfgym && git checkout claude/serene-darwin-zg2ha6
cd server && mkdir -p data && chown 1000:1000 data
docker compose up -d --build
curl http://127.0.0.1:4310/health
```

## HTTPS на этом VPS (общий nginx из budget-app)

Порты 80/443 занимает контейнер `budget-app-nginx-1`; конфиги лежат в `/opt/budget-app/nginx/conf.d/`, сертификаты
выпускает `budget-app-certbot-1` (webroot `/var/www/certbot`, продление автоматическое). Конфиги других проектов не меняются:
добавляется один новый файл `dwarfgym.conf`.

1. Подключить контейнер игры к сети nginx и перезапустить:
   `cd /opt/dwarfgym/server && docker compose -f docker-compose.yml -f docker-compose.budget-proxy.yml up -d --build`
2. Положить блок для порта 80 и перезагрузить nginx:
   `cp /opt/dwarfgym/server/deploy/budget-nginx/dwarfgym.http.conf /opt/budget-app/nginx/conf.d/dwarfgym.conf`
   `docker exec budget-app-nginx-1 nginx -t && docker exec budget-app-nginx-1 nginx -s reload`
3. Выпустить сертификат (DNS уже должен указывать на сервер: `nslookup dwarfgym.live`):
   `docker exec budget-app-certbot-1 certbot certonly --webroot -w /var/www/certbot -d dwarfgym.live -d www.dwarfgym.live --email ВАШ_EMAIL --agree-tos --no-eff-email`
4. Заменить файл на полный (с HTTPS) и перезагрузить:
   `cp /opt/dwarfgym/server/deploy/budget-nginx/dwarfgym.conf /opt/budget-app/nginx/conf.d/dwarfgym.conf`
   `docker exec budget-app-nginx-1 nginx -t && docker exec budget-app-nginx-1 nginx -s reload`
5. Откат: `rm /opt/budget-app/nginx/conf.d/dwarfgym.conf && docker exec budget-app-nginx-1 nginx -s reload`.

Для других серверов без общего nginx: `deploy/nginx-dwarfgym.conf` или `deploy/Caddyfile`.

## Обновление

```bash
cd /opt/dwarfgym && git pull && cd server && docker compose -f docker-compose.yml -f docker-compose.budget-proxy.yml up -d --build
```

## Резервная копия

```bash
cp /opt/dwarfgym/server/data/kamnelom.db /root/backup/kamnelom-$(date +%F).db
```
(во время работы лучше `sqlite3 kamnelom.db ".backup 'копия.db'"`).

## Переменные окружения

`PORT` (4310), `HOST`, `DB_PATH`, `STATIC_DIR`, `TRUST_PROXY=1` за прокси (иначе лимиты считаются по адресу
прокси), `ALLOWED_ORIGINS` (через запятую, если сайт открывается с другого домена), `ALLOW_ANY_ORIGIN=1` (только для разработки).
