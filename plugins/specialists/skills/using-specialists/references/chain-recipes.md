# Specialist role and gate recipes

Use `specialist_list` to discover the live role set and which roles are dispatchable
(`name` returns one full record). Pick by work shape rather than habit. Each stage is a
`specialist_dispatch` against the stage's ready Issue; read its outcome with
`specialist_result` before dispatching the next one.

Typical sequence:

```text
uncertainty about architecture/scope
  -> explorer/planner/critic role

unknown failure cause
  -> debugger

ready implementation contract
  -> executor

production diff
  -> independent test/review/security/obligation gates required by project scrutiny

valid finding
  -> fix with owning implementation role
  -> re-run the affected gate
```

The exact production-diff pipeline is runtime/project policy and can evolve. Do not encode
a permanent ordered list of every role in this reference. Resolve required gates from the
current XTRM/Specialists configuration and contract.

Use a fresh independent reviewer for a final publish decision when the workflow requires
one. Tests are evidence, not a substitute for review; review is not a substitute for
behavioral tests.

Parallelize only roles with genuinely independent mutable scope or read-only evidence
lanes. When one stage consumes the previous stage's changes, use the same verified base
and explicit ordering.

## Chain templates — read-only reference (option A)

Decision (operator, 2026-10-26): chains return to the coordinator surface as a
read-only reference only. No CLI verb, MCP tool, or instantiation path lists,
shows, or pours templates. Each stage remains one `specialist_dispatch` against
the stage's ready Issue, read back with `specialist_result` before dispatching
the next one, exactly as the sequences above. ChainRun semantics are unreleased
and owned by the XTRM runtime canon; this reference makes no claim about them
and omits any ChainRun behavior rather than citing it.

Template sources: `docs/design/roadmap/chain-templates/*.formula.json` (15 files)
are bd-era ChainSource compatibility assets; the `bd mol pour` / `bd dep`
materialization procedure in their README is legacy design history, not current
durable-work authority. Format is kept as `formula.json`; no Substrate-native
shape is introduced by this Issue. Per-template detail (mermaid step diagrams,
severity floors, resolved canonical chains) lives in the cross-repo canon
`xtrm-dev/xtrm docs/substrate/chain_templates.md` §3; the canonical pipeline in
§2; the pending DevOps-gates gap in §4. The canon file is not vendored in this
worktree; the section map follows the in-scope templates README, which is the
canonical-design pointer of record here.

Canonical pipeline (production-diff chains only; per canon §2 via the templates
README): seconder → test-engineer → test-runner → security-auditor (sensitive
surface only) → obligations-scanner → reviewer, with Release Checklist. The
pipeline is not opt-in for production diffs; scrutiny modulates which steps
fire. Meta and read-only chains (planning, premortem, triage, research-only,
release-prep, doc-sync, restitch) carry no pipeline.

### Validity against the live catalog (`config/specialists/`)

Checked each template's `role:` labels against the live specialist files in `config/specialists/`.
All roles named below are present unless marked otherwise.

| Template | Roles (in sequence) | Verdict |
|---|---|---|
| `code-quick` | reviewer | Valid. LOW-blast trivial change. |
| `code-standard` | executor → seconder → test-engineer → test-runner → obligations-scanner → reviewer | Valid. Production-diff default; canonical pipeline applies. |
| `code-with-advisors` | executor → seconder → test-engineer → test-runner → obligations-scanner → reviewer (executor `needs` explorer/researcher/overthinker) | Roles valid, topology broken: the three advisor steps are referenced in `needs` but not declared as steps. Hand-dispatch explorer/researcher/overthinker evidence lanes before executor; all three roles exist in the catalog. |
| `code-with-tests` | executor → seconder → test-engineer (secondary-writer) → test-runner → security-auditor (`optional:sensitive`) → obligations-scanner → reviewer | Valid. Dual-writer production+tests at high+ scrutiny. |
| `debug` | debugger (non-skippable) → seconder → test-engineer → test-runner → obligations-scanner → reviewer | Valid. Bug fix; regression test mandatory. |
| `doc-sync` | sync-docs | Valid. Single-doc drift update; pipeline N/A. |
| `memory-hygiene` | memory-processor | Invalid — role absent from the live catalog. Do not use until a `memory-processor` specialist ships. |
| `planning` | planner | Valid. Vague initiative → phased Issue board; pipeline N/A. |
| `premortem` | overthinker | Valid. Devil's-advocate before risky decisions; read-only, pipeline N/A. |
| `release-prep` | changelog-drafter → changelog-keeper | Valid. Reconcile `[Unreleased]` CHANGELOG.md; pipeline N/A. |
| `research-only` | `{{specialist}}` (default explorer) | Valid when resolved to explorer (local) or researcher (external); both exist in the catalog. Read-only; pipeline N/A. |
| `restitch` | debugger → seconder → test-engineer → test-runner → obligations-scanner → reviewer | Valid. Conflict recovery; inherits the original chain's pipeline state. |
| `security-deep` | security-auditor (advisor) → executor → seconder → test-engineer → test-runner → security-auditor (gate) → obligations-scanner → reviewer | Valid. Sensitive surface; SCRUTINY critical default; security-auditor runs twice. |
| `test-only` | test-engineer (primary writer) → seconder → test-runner → reviewer | Valid. Test-only change; pipeline N/A. |
| `triage` | explorer → overthinker | Valid. Board health; read-only, pipeline N/A. |

### Scrutiny-to-chain guidance

| Work shape | Template (manual `specialist_dispatch` sequence) |
|---|---|
| LOW-blast trivial change (one-line fix, typo) | `code-quick`: implement, then reviewer. |
| Medium production diff | `code-standard`: executor → seconder → test-engineer → test-runner → obligations-scanner → reviewer. |
| Medium bug, unknown cause | `debug`: debugger (non-skippable) → pipeline gates. |
| Medium tests-only change | `test-only`: test-engineer → seconder → test-runner → reviewer. |
| HIGH/CRITICAL blast or unknown approach | `code-with-advisors` (hand-dispatch explorer/researcher/overthinker first — the file omits those steps) or `code-with-tests` (executor production + test-engineer secondary-writer) → pipeline gates. |
| Sensitive surface (auth, secrets, crypto, migrations, agent/MCP config) | `security-deep` at critical scrutiny: security-auditor advisor → executor → pipeline → security-auditor gate → obligations-scanner → reviewer. |
| No-scrutiny meta work | `planning` (initiative → board), `premortem` (risk review), `triage` (board health), `research-only` (explorer/researcher findings memo), `release-prep` (changelog), `doc-sync` (one doc), `restitch` (conflict recovery). `memory-hygiene` is excluded — its role does not exist. |