---
name: security-pipeline
description: Bootstrap a complete security pipeline (Dependabot + OSV + Semgrep + gitleaks + pre-commit hooks + Codex review) on any GitHub repo. Designed for free user-private repos where GitHub Advanced Security is unavailable. Reusable across Python/TypeScript/Go/Rust stacks.
---

# Security Pipeline

Wires a 4-layer security baseline onto any GitHub repo. Originally proven on
the Mercury infra stack but the templates and bootstrap script are
project-agnostic — adapt the allowlists and dependabot ecosystems per repo.

## When to use

- Setting up security on a new repo (any language)
- Existing repo has zero/partial security checks
- User says "set up security pipeline" / "wire dependabot + sast + secret scan"

Do NOT use this skill if the repo already has a working `dependabot.yml` AND
all three workflows (`osv-scanner.yml`, `semgrep.yml`, `gitleaks.yml`).

## Architecture (4 layers)

```
git commit  ──► pre-commit  (gitleaks staged, ruff, hygiene)        ~1s
git push    ──► pre-push    (semgrep diff-only, osv, anti-main)     ~30s
PR opened   ──► CI          (osv-scanner, semgrep, gitleaks)        ~1m
PR review   ──► Codex       (semantic AI review, optional)          ~2m
PR merged   ──► Dependabot  (continuous vuln + version PRs)         async
```

Pre-existing debt is NEVER blocked by the push gate — only NEW findings vs
`origin/main`. CI does the full-repo authoritative scan.

## Why this stack on free user-private repos

GitHub Advanced Security (CodeQL, Dependency Review) needs Org/Enterprise
+ ~$49/user/month. Free substitutes:

| GHAS | Free substitute |
|---|---|
| CodeQL | Semgrep `p/security-audit` + `p/secrets` + ecosystem packs |
| Dependency Review | `osv-scanner` action |
| Secret scanning | Native (free for all repos since 2025) |
| Push protection | Native (free for all repos since 2025) |
| Branch protection enforcement | Pre-push hook + `gh pr merge --auto` |

## Quickstart

The skill ships with a bootstrap script that detects ecosystems and copies
templates. From the source repo (where this skill is installed):

```bash
./scripts/security-bootstrap.sh /path/to/target/repo
```

The script:
1. Detects ecosystems (`pip`, `pip-pyproject`, `npm`, `docker`, `gomod`,
   `cargo`, `github-actions`)
2. Generates a tailored `.github/dependabot.yml`
3. Copies the 11 baseline files from `templates/`
4. Opens a `feat(security)` PR
5. Calls `gh api` to enable Dependabot/secret scanning/push protection

## Manual follow-up after bootstrap

The script CAN'T do these — operator walks them per target repo:

1. **Codex Connector** (optional) — install at https://chatgpt.com/codex/cloud/settings/general
2. **Branch protection rule** — Settings → Branches → classic rule for `main`
   - Required checks: `OSV scan`, `Semgrep scan`, `Gitleaks scan`
   - On free private repos rules don't enforce server-side; the pre-push hook fills the gap
3. **`make install-hooks`** in the target clone (or run `git config core.hooksPath .githooks`)

## Files in `templates/`

| Template | Lands at | Purpose |
|---|---|---|
| `.github/workflows/osv-scanner.yml` | same path | Vuln scan via OSV.dev |
| `.github/workflows/semgrep.yml` | same path | SAST (replaces CodeQL) |
| `.github/workflows/gitleaks.yml` | same path | Secret scan |
| `.gitleaks.toml` | same path | **Allowlist — adapt per project** (see below) |
| `.semgrepignore` | same path | **Excludes — adapt per project** (see below) |
| `.pre-commit-config.yaml` | same path | Two-stage local gate |
| `.githooks/pre-push.template` | merge into existing `.githooks/pre-push` | Anti-main-push + pre-commit chain |
| `scripts/semgrep-diff.sh` | same path | Diff-only semgrep for push |
| `scripts/security-scan.sh` | same path | Local audit (informational) |

`.github/dependabot.yml` is NOT in `templates/` — it's generated per-repo from
detected ecosystems.

## Adapting allowlists per project

The shipped `.gitleaks.toml` and `.semgrepignore` contain Mercury-specific
paths as **examples**. When applying to a non-Mercury repo, prune what
doesn't apply.

### `.gitleaks.toml` — common allowlist patterns

```toml
[allowlist]
paths = [
    '''^\.env$''',           # gitignored secrets (no-git scan walks fs)
    '''^\.env\..*''',
    # Project-specific machine-generated dirs (drop what doesn't apply):
    '''^\.beads/.*''',       # Mercury-only — issue tracker exports
    '''^\.specialists/.*''', # Mercury-only — specialist runtime state
    '''^\.dolt/.*''',        # Mercury-only — Dolt SQL storage
    # Add your own:
    '''^vendor/.*''',        # Go vendoring
    '''^node_modules/.*''',  # NPM (usually gitignored anyway)
]
```

### `.semgrepignore` — common patterns

```
.env
.env.*
node_modules/
vendor/
**/__pycache__/
**/test_fixtures/
package-lock.json
pnpm-lock.yaml
yarn.lock
poetry.lock
Pipfile.lock
go.sum
Cargo.lock
```

Don't blanket-allowlist findings without a tracked issue explaining why.
Acknowledged debt should be visible.

## Local install (per-clone, after bootstrap merges)

```bash
pip3 install --user --break-system-packages pre-commit semgrep
mkdir -p ~/.local/bin
curl -sL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz \
  | tar -xz -C ~/.local/bin gitleaks
curl -sL https://github.com/google/osv-scanner/releases/download/v2.0.2/osv-scanner_linux_amd64 \
  -o ~/.local/bin/osv-scanner && chmod +x ~/.local/bin/osv-scanner
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push 2>/dev/null
```

Verify: `./scripts/security-scan.sh`.

## Reading Codex feedback on a PR (if Codex is installed)

```bash
gh pr view <num> --json reviews,comments | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('reviews', []):
    if 'codex' in r.get('author',{}).get('login','').lower():
        body = r.get('body', '')
        print('👍 no suggestions' if 'automated review suggestions' in body and len(body) < 1500 else body[:1500])
"
```

## Known pitfalls (encoded in the templates)

- **Pre-commit can't install with `core.hooksPath` set** → templates chain
  pre-commit from `.githooks/pre-commit` and `.githooks/pre-push` instead of
  using `pre-commit install`.
- **Semgrep's pre-commit env breaks on Python 3.13** (`pkg_resources` missing)
  → templates use `language: system` pointing at globally installed semgrep.
- **`semgrep ci --error` is invalid** → use `semgrep scan --error`.
- **`actions/dependency-review-action` requires GHAS** → use `osv-scanner` instead.
- **Gitleaks action needs `pull-requests: write`** to post leak summary on PRs.
- **Full-repo semgrep at push stage flags pre-existing debt** → use
  `scripts/semgrep-diff.sh` with `--baseline-commit=$(git merge-base HEAD origin/main)`.
- **`.pre-commit-config.yaml` `default_stages: [pre-commit]`** → otherwise
  ruff/hygiene hooks fire at push too.
- **Squash-merging while iterating with `git commit --amend`** → verify
  `git log --stat <merge-sha>` after merge; missing files require a follow-up PR.
- **Auto-merge disabled** → fall back to `gh pr merge --squash --delete-branch`
  after `gh pr checks --watch`.

## Complementary tools (optional, second opinion)

- `trivy fs` / `trivy image` — container + IaC scanning
- `bandit` — Python-specific SAST (Semgrep `p/python` already covers most)
- `actionlint` — GitHub Actions linter (Semgrep `p/github-actions` covers basics)

## Reference doc

Full pipeline narrative + UI screenshots + per-feature rationale lives in
the Mercury reference at `mercury-infra/SECURITY-PIPELINE.md`, also mirrored
in `~/second-mind/3-resources/github/SECURITY-PIPELINE.md`.
