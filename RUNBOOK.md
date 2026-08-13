# outreach-crm — Operations Runbook

All commands are run from the project folder:

```
cd C:/Users/Proxi/Documents/Claude/outreach-crm
```

---

## Quick reference

| Task | Command |
| --- | --- |
| Start everything | `docker compose up -d` |
| Stop everything | `docker compose down` |
| Check health | `docker compose ps` |
| View API logs | `docker compose logs api --tail 50` |
| Rebuild backend | `docker compose up -d --build api worker` |
| Rebuild frontend | `docker compose up -d --build web` |
| Run tests | `docker compose exec api python -m pytest tests/ -q` |
| **Wipe the database** | `docker compose down -v` ⚠️ |

---

## Starting it up

```
docker compose up -d
```

Wait about 30 seconds, then open <http://localhost:3000>.

**Docker Desktop must be running first.** If `docker compose` errors with
`cannot find the file specified`, launch Docker Desktop from the Start menu,
give it a minute, and retry.

---

## Stopping it

```
docker compose down
```

Your data survives this. Prospects, drafts, strategies, and history live in a
Docker volume, not in the containers. The same is true after a reboot —
`docker compose up -d` brings everything back exactly as you left it.

> ⚠️ The one command that erases everything is `docker compose down -v`.
> The `-v` flag drops the volume. Only use it when you want a clean database.

---

## Checking it's healthy

```
docker compose ps
```

All five services should report `Up`. If the app looks wrong, check the API:

```
docker compose logs api --tail 50
```

---

## After you rotate the API key

Edit `.env` in the project folder, then rebuild:

```
docker compose up -d --build api worker
```

The key is only read at startup, so a restart is required for a new one to take
effect.

---

## If you edit code

**Backend changes (Python):**

```
docker compose up -d --build api worker
```

**Frontend changes (React / TypeScript):**

```
docker compose up -d --build web
```

---

## Running the tests

```
docker compose exec api python -m pytest tests/ -q
```
