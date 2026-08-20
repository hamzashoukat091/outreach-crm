# Managing the deployment. Run these from the repo root on the server.
#
# The production stack is two compose files -- the base plus an overlay that
# pins ports to localhost and turns on restart policies. Typing both every
# time is how you eventually forget the overlay and publish Postgres to the
# internet, so every target here includes it.

COMPOSE := docker compose -f docker-compose.yml -f docker-compose.prod.yml

.DEFAULT_GOAL := help
.PHONY: help up down restart logs ps update build backup shell-api shell-db migrate

help:  ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk -F':.*?## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up:  ## Start everything (detached)
	$(COMPOSE) up -d
	@$(COMPOSE) ps

down:  ## Stop everything. Data survives -- the volume is untouched.
	$(COMPOSE) down

restart:  ## Restart all services
	$(COMPOSE) restart
	@$(COMPOSE) ps

ps:  ## What is running
	@$(COMPOSE) ps

logs:  ## Follow logs (make logs S=api for one service)
	$(COMPOSE) logs -f --tail=100 $(S)

build:  ## Rebuild images without starting
	$(COMPOSE) build

update:  ## Pull latest code, rebuild, restart. The normal deploy.
	git fetch origin && git reset --hard origin/main
	$(COMPOSE) build
	$(COMPOSE) up -d
	@echo "--- now at $$(git rev-parse --short HEAD) ---"
	@$(COMPOSE) ps

migrate:  ## Apply database migrations (the API does this on start too)
	$(COMPOSE) exec api alembic upgrade head

backup:  ## Dump the database to ./backups/ with a timestamped name
	@mkdir -p backups
	@f=backups/outreach-$$(date +%Y%m%d-%H%M%S).sql.gz; \
	$(COMPOSE) exec -T db pg_dump -U outreach outreach | gzip > $$f; \
	echo "wrote $$f ($$(du -h $$f | cut -f1))"

shell-api:  ## Shell inside the API container
	$(COMPOSE) exec api bash

shell-db:  ## psql inside the database
	$(COMPOSE) exec db psql -U outreach -d outreach
