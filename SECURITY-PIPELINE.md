# Security Pipeline

This repo uses a four-layer free security baseline for private GitHub repos:

1. **Local hooks**: `.githooks/pre-commit` runs gitleaks, ruff, and hygiene checks; `.githooks/pre-push` blocks direct pushes to `main`/`master`, runs diff-only Semgrep directly, and reports OSV dependency findings without blocking pre-existing debt.
2. **CI**: OSV, Semgrep, and Gitleaks run on PRs and weekly schedules.
3. **Dependabot**: version and vulnerability PRs are configured for npm, pip, Docker, and GitHub Actions.
4. **GitHub native security**: secret scanning and push protection should be enabled in repository settings.

## Local setup

```bash
git config core.hooksPath .githooks
pip3 install --user --break-system-packages pre-commit semgrep
mkdir -p ~/.local/bin
curl -sL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz \
  | tar -xz -C ~/.local/bin gitleaks
curl -sL https://github.com/google/osv-scanner/releases/download/v2.0.2/osv-scanner_linux_amd64 \
  -o ~/.local/bin/osv-scanner && chmod +x ~/.local/bin/osv-scanner
```

Run a local audit any time:

```bash
./scripts/security-scan.sh        # full informational scan
./scripts/security-scan.sh --quick # gitleaks only
```

## Manual GitHub follow-up

Already enabled via `gh api` on 2026-05-15:

- Dependabot alerts and Dependabot security updates.
- Secret scanning and push protection.

Still manual:

- Add a classic branch protection rule for `main`/`master` with required checks:
  - `OSV scan`
  - `Semgrep scan`
  - `Gitleaks scan`
- Optional: install the Codex Connector for semantic AI PR review.
