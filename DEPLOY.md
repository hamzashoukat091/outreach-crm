# Deployment

Live at **https://outreach.openval.ai** on the `openvalscraperapi` EC2 host
(`13.218.72.168`, us-east-1), alongside the pre-existing `api.openval.ai`
Flask service. Both are served by the same nginx.

## Shape

```
internet ──► nginx :443 (TLS, Let's Encrypt)
               ├── /api/*  ──► 127.0.0.1:8100  api container (FastAPI)
               ├── /health ──► 127.0.0.1:8100
               └── /*      ──► 127.0.0.1:3100  web container (Next.js)

             worker container ──► database (no HTTP surface)
             db container     ──► not published at all
```

Nothing but nginx listens on a public interface. The containers bind to
`127.0.0.1`, so port scanning the box finds only 22, 80 and 443.

## Files

| Path | What |
|---|---|
| `/home/ubuntu/outreach-crm` | the repo |
| `/home/ubuntu/outreach-crm/.env` | secrets, `0600`, never committed |
| `/etc/nginx/conf.d/outreach.conf` | the vhost |
| `/etc/nginx/conf.d/00-outreach-limits.conf` | login rate-limit zone |
| `/etc/nginx/snippets/outreach-proxy.conf` | shared proxy headers |
| `/etc/letsencrypt/live/outreach.openval.ai/` | certificate |

## Everyday use

```bash
cd /home/ubuntu/outreach-crm
make            # list the commands
make update     # pull, rebuild, restart -- the normal deploy
make logs S=api # follow one service
make backup     # timestamped database dump into ./backups
```

## Notes

- **Migrations run automatically** when the API container starts.
- **`make down` does not delete data.** The Postgres volume survives; only
  `docker compose down -v` would remove it.
- **The certificate renews itself** via certbot's systemd timer.
- **Mail is `console` by default** -- the app logs emails instead of sending
  them. Configure SMTP in Settings, then set `MAIL_DRIVER=smtp` in `.env`
  and `make restart`.
- **Dry-run defaults on.** Nothing reaches a real inbox until you turn it off
  in Settings.
