# Пресет web-fullstack: FastAPI (uv, pytest, ruff) + React/Vite/TS (Vitest, Playwright).
# Демо-путь живёт с первого коммита: API на заглушке + страница + e2e сценария демо.
# Контракт целей — Makefile шаблона.
STACK := web-fullstack
UV := cd backend && uv run --frozen
PORT ?= 8000
DATA_DIR ?= data

.PHONY: precompute
precompute:
	$(UV) python -m precompute --data "$(abspath $(DATA_DIR))" --out ../web/public/data $(PRECOMPUTE_ARGS)

.PHONY: dsn-panel
dsn-panel:
	$(UV) python -m precompute.beta_dsn_links --data "$(abspath $(DATA_DIR))" --out ../web/public/data

.PHONY: stack-setup stack-lint stack-check stack-demo stack-eval stack-eval-final stack-e2e

stack-setup:
	cd backend && uv sync --frozen
	cd web && npm ci --no-audit --no-fund

stack-lint:
	bash scripts/check-case.sh
	bash scripts/check-case.test.sh
	$(UV) ruff check src tests
	$(UV) ruff format --check src tests
	cd web && npm run -s typecheck && npm run -s build

stack-check: stack-lint
	$(UV) pytest -n $(JOBS) --dist loadgroup
	cd web && npm run -s test -- --maxWorkers=$(JOBS)

stack-demo:
	cd web && npm run -s build
	@echo "демо: http://localhost:$(PORT)"
	$(UV) uvicorn api.main:app --port $(PORT)

stack-eval:
	$(UV) python ../scripts/eval_harness.py --checks src/api/checks.py \
	  --cases ../eval/cases.json --baseline ../eval/baseline.json

stack-eval-final:
	@[ -n "$(HOLDOUT_DIR)" ] || { echo "stack-eval-final запускает только make eval-final" >&2; exit 2; }
	$(UV) python ../scripts/eval_harness.py --checks src/api/checks.py \
	  --holdout-dir "$(HOLDOUT_DIR)" --baseline ../eval/baseline.json

stack-e2e:
	cd web && npm run -s build && npx playwright install chromium >/dev/null && npx playwright test --workers=$(JOBS)
