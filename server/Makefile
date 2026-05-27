.PHONY: setup up down logs test healthcheck clean

setup:
	./scripts/setup.sh

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=50

healthcheck:
	./scripts/healthcheck.sh

test:
	@if [ ! -d tests/.venv ]; then python3 -m venv tests/.venv && tests/.venv/bin/pip install -r tests/requirements.txt; fi
	@set -a; . ./.env; set +a; \
	HAILFREQ_TEST_HOMESERVER=http://localhost:8008 tests/.venv/bin/pytest tests/ -v

clean:
	docker compose down -v
	rm -f synapse/homeserver.yaml synapse/log.config.rendered Caddyfile livekit/livekit.yaml coturn/turnserver.conf
	rm -rf tests/.venv
