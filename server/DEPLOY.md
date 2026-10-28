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

## HTTPS

На VPS уже может быть прокси для других проектов, порты 80/443 заняты. Не трогай чужие конфиги.
Добавь отдельный блок для `dwarfgym.live`:
- nginx: `deploy/nginx-dwarfgym.conf` в `conf.d`, затем `certbot --nginx -d dwarfgym.live -d www.dwarfgym.live`;
- Caddy: `deploy/Caddyfile`;
- прокси в Docker (как у budget-app): добавь `server_name dwarfgym.live` с `proxy_pass http://host.docker.internal:4310`
  или подключи контейнер `dwarfgym` к его сети и проксируй на `dwarfgym:4310`.
Для живых обновлений групп нужен выключенный буфер ответа (`proxy_buffering off`).

## Обновление

```bash
cd /opt/dwarfgym && git pull && cd server && docker compose up -d --build
```

## Резервная копия

```bash
cp /opt/dwarfgym/server/data/kamnelom.db /root/backup/kamnelom-$(date +%F).db
```
(во время работы лучше `sqlite3 kamnelom.db ".backup 'копия.db'"`).

## Переменные окружения

`PORT` (4310), `HOST`, `DB_PATH`, `STATIC_DIR`, `TRUST_PROXY=1` за прокси (иначе лимиты считаются по адресу
прокси), `ALLOWED_ORIGINS` (через запятую, если сайт открывается с другого домена), `ALLOW_ANY_ORIGIN=1` (только для разработки).
