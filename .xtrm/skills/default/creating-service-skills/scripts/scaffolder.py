#!/usr/bin/env python3
"""
Scaffolder for creating-service-skills.

Phase 1 of the two-phase workflow: generates a structural skeleton for a new
service skill by parsing docker-compose.yml, Dockerfiles, and dependency files.
The skeleton contains [PENDING RESEARCH] markers for the agent to fill in Phase 2.

Output location: .xtrm/skills/user/packs/<pack>/<service-id>/
"""

import re
import shutil
import sys
from pathlib import Path

script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

from bootstrap import RootResolutionError, get_pack_path, get_project_root, register_service  # noqa: E402

SERVICE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-_]{0,63}$")

OFFICIAL_DOCS: dict[str, tuple[str, str]] = {
    "postgres": ("PostgreSQL", "https://www.postgresql.org/docs/"),
    "timescale": ("TimescaleDB", "https://docs.timescale.com/"),
    "timescaledb": ("TimescaleDB", "https://docs.timescale.com/"),
    "redis": ("Redis", "https://redis.io/docs/"),
    "mysql": ("MySQL", "https://dev.mysql.com/doc/"),
    "mongodb": ("MongoDB", "https://www.mongodb.com/docs/"),
    "mongo": ("MongoDB", "https://www.mongodb.com/docs/"),
    "elasticsearch": ("Elasticsearch", "https://www.elastic.co/guide/"),
    "rabbitmq": ("RabbitMQ", "https://www.rabbitmq.com/documentation.html"),
    "kafka": ("Apache Kafka", "https://kafka.apache.org/documentation/"),
    "clickhouse": ("ClickHouse", "https://clickhouse.com/docs/"),
    "fastapi": ("FastAPI", "https://fastapi.tiangolo.com/"),
    "flask": ("Flask", "https://flask.palletsprojects.com/"),
    "django": ("Django", "https://docs.djangoproject.com/"),
    "sqlalchemy": ("SQLAlchemy", "https://docs.sqlalchemy.org/"),
    "alembic": ("Alembic", "https://alembic.sqlalchemy.org/en/latest/"),
    "prisma": ("Prisma", "https://www.prisma.io/docs/"),
    "celery": ("Celery", "https://docs.celeryq.dev/"),
    "pydantic": ("Pydantic", "https://docs.pydantic.dev/"),
    "asyncpg": ("asyncpg", "https://magicstack.github.io/asyncpg/"),
    "psycopg2": ("psycopg2", "https://www.psycopg.org/docs/"),
    "psycopg": ("psycopg3", "https://www.psycopg.org/psycopg3/docs/"),
    "aiohttp": ("aiohttp", "https://docs.aiohttp.org/"),
    "httpx": ("HTTPX", "https://www.python-httpx.org/"),
}


def validate_service_id(service_id: str) -> None:
    if not SERVICE_ID_PATTERN.fullmatch(service_id):
        raise ValueError("service_id must match ^[a-z0-9][a-z0-9-_]{0,63}$")


def ensure_legacy_symlink(target_dir: Path, legacy_dir: Path, pack_root: Path) -> None:
    resolved_target = target_dir.resolve(strict=False)
    resolved_pack_root = pack_root.resolve(strict=False)

    if resolved_pack_root not in resolved_target.parents and resolved_target != resolved_pack_root:
        raise ValueError(f"legacy symlink target must stay within {resolved_pack_root}")

    if legacy_dir.is_symlink():
        legacy_dir.unlink()
    elif legacy_dir.exists():
        if legacy_dir.is_dir() and not any(legacy_dir.iterdir()):
            legacy_dir.rmdir()
        else:
            raise ValueError("legacy path exists and is not an empty symlink-safe directory")

    legacy_dir.parent.mkdir(parents=True, exist_ok=True)
    legacy_dir.symlink_to(target_dir, target_is_directory=True)


def scaffold_service_skill(service_id: str, compose_data: dict) -> Path:
    validate_service_id(service_id)
    try:
        project_root = get_project_root()
    except RootResolutionError as e:
        print(f"Error: {e}")
        sys.exit(1)

    pack_path = get_pack_path(project_root)
    if pack_path is None:
        print("Error: unable to resolve pack path. Set XTRM_PACK or leave only one pack under .xtrm/skills/user/packs.")
        sys.exit(1)

    skill_dir = pack_path / service_id
    legacy_dir = Path(project_root) / ".claude" / "skills" / service_id
    if skill_dir.exists() or legacy_dir.exists():
        existing = skill_dir if skill_dir.exists() else legacy_dir
        print(f"Skill directory already exists: {existing}")
        print("Aborting to prevent overwriting. Delete it manually if you want to re-scaffold.")
        sys.exit(1)

    print(f"Scaffolding new service skill: {service_id}")
    print(f"Target directory: {skill_dir}")

    skill_dir.mkdir(parents=True)
    (skill_dir / "scripts").mkdir()
    (skill_dir / "references").mkdir()
    (skill_dir / "assets").mkdir()

    service_config = compose_data.get("services", {}).get(service_id, {})
    write_skill_md(service_id, service_config, skill_dir)
    write_script_stubs(service_id, skill_dir)
    write_reference_stubs(service_id, skill_dir)

    register_service(service_id, service_id, [], str((skill_dir / "SKILL.md").relative_to(project_root)), project_root=project_root)
    ensure_legacy_symlink(skill_dir, legacy_dir, pack_path)

    print(f"\n✅ Phase 1 Complete for {service_id}")
    print("Next step: Run Phase 2 deep dive for this service.")
    return skill_dir


def write_skill_md(service_id: str, config: dict, skill_dir: Path) -> None:
    name = service_id.replace("-", " ").replace("_", " ").title()
    persona = f"{name} Expert"
    docs_section = ""

    content = f"""---
name: {service_id}
description: >-
  [PENDING RESEARCH] Specialized knowledge for the {name} service.
  Use when debugging, analyzing performance, or understanding this service.
allowed-tools: Bash(python3 *), Read, Grep, Glob
---

# {name}

## Service Overview

[PENDING RESEARCH] Describe what this service does, its role in the system,
and whether it runs continuously, as a one-shot job, or on a schedule.

**Persona**: {persona}

## Architecture

[PENDING RESEARCH]

**Entry Point**: [Verify in Dockerfile CMD and docker-compose `command:` field]
**Container Name**: {service_id}
**Restart Policy**: [PENDING RESEARCH]

**Primary Modules**:
- [PENDING RESEARCH] List key modules after reading the source tree

**Dependencies**: [PENDING RESEARCH] PostgreSQL? Redis? External APIs?

## ⚠️ CRITICAL REQUIREMENTS

[PENDING RESEARCH] Add any mandatory patterns, initialization calls, or
invariants that must not be violated when modifying this service.

## Data Flows

[PENDING RESEARCH] Trace the primary data paths through the service.

## Database Interactions

[PENDING RESEARCH]

| Table | Operation | Timestamp Column | Stale Threshold |
|-------|-----------|-----------------|-----------------|
| [table] | INSERT/SELECT | [col] | [N min] |

## Common Operations

### Service Management

```bash
# Start the service
docker compose up -d {service_id}

# Check logs
docker logs {service_id} --tail 50

# Restart
docker compose restart {service_id}
```

### Data Inspection

- **Health check**: `python3 .claude/skills/{service_id}/scripts/health_probe.py`
- **Log analysis**: `python3 .claude/skills/{service_id}/scripts/log_hunter.py`
- **Data explorer**: `python3 .claude/skills/{service_id}/scripts/data_explorer.py`

## Troubleshooting Guide

[PENDING RESEARCH] Fill from exception handlers and code comments.

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| [what you see] | [root cause] | [exact command to fix] |

Minimum 5 rows required.

<!-- SEMANTIC_START -->
## Semantic Deep Dive (Human/Agent Refined)

[PENDING RESEARCH] Add deep operational knowledge after Phase 2 deep dive.

<!-- SEMANTIC_END -->

## Scripts

- `scripts/health_probe.py` — Container status + table freshness check
- `scripts/log_hunter.py` — Service-specific log pattern analysis
- `scripts/data_explorer.py` — Safe database inspection (read-only)

## References
{docs_section}
- `references/deep_dive.md` — Detailed Phase 2 research notes
- `references/architecture_ssot.md` — Architecture SSOT (link from project SSOT if available)

---

*Generated by creating-service-skills Phase 1. Run Phase 2 to fill [PENDING RESEARCH] markers.*
"""  # nosec B608
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")


def write_script_stubs(service_id: str, skill_dir: Path) -> None:
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    health_probe_tpl = '''#!/usr/bin/env python3
"""Health probe for {{SERVICE_ID}}.

[PENDING RESEARCH] Replace all [FILL] markers during Phase 2 deep dive.
"""
import json
import subprocess
import sys

CONTAINER = "{{SERVICE_ID}}"
DB_PORT = 5433
STALE_CHECKS: list[dict] = []


def check_container() -> bool:
    result = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER], capture_output=True, text=True)
    running = result.stdout.strip() == "true"
    print(f"Container {CONTAINER}: {'RUNNING' if running else 'STOPPED'}")
    return running


def check_table_freshness() -> bool:
    if not STALE_CHECKS:
        print("Table freshness: NOT CONFIGURED (Phase 2 required)")
        return True
    return True


def main(as_json: bool = False) -> None:
    ok = check_container()
    ok &= check_table_freshness()
    if as_json:
        print(json.dumps({"healthy": ok, "service": CONTAINER}))
    else:
        print(f"\\nOverall: {'HEALTHY' if ok else 'UNHEALTHY'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    main(as_json=args.json)
'''
    (scripts_dir / "health_probe.py").write_text(health_probe_tpl.replace("{{SERVICE_ID}}", service_id), encoding="utf-8")
    log_hunter_tpl = '''#!/usr/bin/env python3
"""Log hunter for {{SERVICE_ID}}.

[PENDING RESEARCH] Replace generic patterns with actual error strings
found in the codebase exception handlers during Phase 2 deep dive.
"""
import subprocess
from collections import defaultdict

CONTAINER = "{{SERVICE_ID}}"
PATTERNS: list[tuple[str, str, str]] = [
    ("ConnectionError", "ERROR", "Database or Redis connectivity issue"),
    ("TimeoutError", "WARNING", "External service latency detected"),
]


def hunt_logs(tail: int = 200) -> dict:
    result = subprocess.run(["docker", "logs", "--tail", str(tail), CONTAINER], capture_output=True, text=True)
    logs = result.stdout + result.stderr
    matches = defaultdict(int)
    for line in logs.splitlines():
        for pattern, level, desc in PATTERNS:
            if pattern in line:
                matches[pattern] += 1
    return dict(matches)


def main() -> None:
    results = hunt_logs()
    print(f"Log anomalies for {CONTAINER}:")
    if not results:
        print("  ✓ No known error patterns detected in recent logs.")
    else:
        for p, count in results.items():
            print(f"  - {p}: {count} occurrences")


if __name__ == "__main__":
    main()
'''
    (scripts_dir / "log_hunter.py").write_text(log_hunter_tpl.replace("{{SERVICE_ID}}", service_id), encoding="utf-8")
    data_explorer_tpl = '''#!/usr/bin/env python3
"""Data explorer for {{SERVICE_ID}} — read-only DB inspection.

[PENDING RESEARCH] Fill in actual table names, columns, and host port
during Phase 2 deep dive. All queries must use parameterized %s placeholders.
"""
import sys

TABLE = "[PENDING RESEARCH]"
DB_HOST = "localhost"
DB_PORT = 5433
DB_NAME = "[PENDING RESEARCH]"
DB_USER = "postgres"


def recent_rows(limit: int = 20, as_json: bool = False) -> None:
    print(f"[PENDING RESEARCH] Implement: SELECT * FROM {TABLE} ORDER BY created_at DESC LIMIT %s")
    print("Use parameterized queries only — no f-strings in SQL.")


def main() -> None:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    recent_rows(args.limit, args.json)


if __name__ == "__main__":
    main()
'''
    (scripts_dir / "data_explorer.py").write_text(data_explorer_tpl.replace("{{SERVICE_ID}}", service_id), encoding="utf-8")
    makefile_tpl = """# Skill diagnostic scripts for {{SERVICE_ID}}
# Usage: make <target>   (from this directory)
# Override python: make health PYTHON=/path/to/python3

_VENV := $(wildcard ../../../../venv/bin/python3)
PYTHON ?= $(if $(_VENV),../../../../venv/bin/python3,python3)

.PHONY: health health-json data data-json logs errors db help

help:
	@echo "Available targets:"
	@echo "  health      - Run health probe (human readable)"
	@echo "  health-json - Run health probe (JSON output)"
	@echo "  data        - Show latest DB records"
	@echo "  data-json   - Show latest DB records (JSON, limit 5)"
	@echo "  logs        - Tail and analyze recent logs"
	@echo "  errors      - Show errors/criticals only"
	@echo "  db          - Run DB helper example queries"
	@echo ""
	@echo "Python: $(PYTHON)"

health:
	$(PYTHON) health_probe.py

health-json:
	$(PYTHON) health_probe.py --json

data:
	$(PYTHON) data_explorer.py

data-json:
	$(PYTHON) data_explorer.py --json --limit 5

logs:
	$(PYTHON) log_hunter.py --tail 50

errors:
	$(PYTHON) log_hunter.py --errors-only --tail 50

db:
	$(PYTHON) db_helper.py
"""
    (scripts_dir / "Makefile").write_text(makefile_tpl.replace("{{SERVICE_ID}}", service_id), encoding="utf-8")


def write_reference_stubs(service_id: str, skill_dir: Path) -> None:
    name = service_id.replace("-", " ").replace("_", " ").title()
    (skill_dir / "references" / "deep_dive.md").write_text(f"""# Phase 2 Research: {name}

## Source Analysis
- **Entry Point**: [FILL]
- **Main Loop**: [FILL]
- **Error Handlers**: [FILL]

## Logic Trace
1. [Step 1]
2. [Step 2]

## Invariants
- [Must always X]
- [Must never Y]
""", encoding="utf-8")
    (skill_dir / "references" / "architecture_ssot.md").write_text(f"""# {name} Architecture

[PENDING RESEARCH] Replace with link to project-level SSOT if exists,
otherwise document high-level components here.
""", encoding="utf-8")


if __name__ == "__main__":
    import yaml

    if len(sys.argv) < 2:
        print("Usage: scaffolder.py <docker-compose-path> [service-id]")
        sys.exit(1)
    compose_path = Path(sys.argv[1])
    if not compose_path.exists():
        print(f"Compose file not found: {compose_path}")
        sys.exit(1)
    with open(compose_path) as f:
        data = yaml.safe_load(f)
    if len(sys.argv) > 2:
        scaffold_service_skill(sys.argv[2], data)
    else:
        for sid in data.get("services", {}).keys():
            scaffold_service_skill(sid, data)
