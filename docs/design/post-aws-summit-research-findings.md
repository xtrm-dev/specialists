# Post-AWS-Summit Research Findings & Proposed Integration Paths

> Synthesis of research epic **`unitAI-544sf`** (post-AWS-summit 2026-05-28/29).
> All 7 research streams completed by the `researcher` specialist (READ_ONLY, ddgs + agent-browser + ctx7 + deepwiki + ghgrep), each citing primary sources.
> Status: **research complete; per-item operator decisions captured below.** Follow-up beads are filed from this document, not before it.
> Author context: produced 2026-05-29. Per-stream memos live on each child bead's notes; durable insights saved via `bd remember`.

---

## 0. Enabling work — researcher web-research capability (`unitAI-qgvld`)

The epic could not start until the `researcher` specialist could reach the open web. Its prior toolset (ctx7 = library docs, deepwiki = GitHub repos, ghgrep = GitHub code, last30days = social) had **no general web search and no arbitrary-URL read** — fatal for streams .1/.5/.7 (vendor docs, papers, proprietary products).

**Done (shipped, v1.3.0):**
- `ddgs` (DuckDuckGo search CLI, no API key — `uv tool install ddgs`) for URL **discovery**.
- `agent-browser` (Vercel; native Rust CLI + Chrome daemon — `npm i -g agent-browser`) for **reading** any URL incl. JS-rendered pages.
- New **Mode 4** in `prompt.system` + `research-tool-routing.md`; tags/description updated.
- **Key safety call:** `capabilities.external_commands` left **empty** — it is a *hard* pre-run gate (`runner.ts validateBeforeRun` throws if a listed command is missing on PATH), so declaring these heavy tools would break the shipped package-tier researcher in any project lacking them. They are documented as available-on-demand instead, with install hints.
- Limitation: agent-browser is **not a search engine** (search engines CAPTCHA headless Chrome) — `ddgs` searches, `agent-browser` reads.

**Discovered during the epic and fixed (`unitAI-sx5qk`, reviewer PASS 99):** per-turn handoff notes were *replacing* rather than *appending* (`appendBeadNote` called `bd update --notes`; switched to `--append-notes`). Also: `formatBeadNotes` exported + 70-char divider between turns + `### 🔬 <specialist> · <model> · [<status>]` header + token-usage metadata.

**Open follow-up:** `unitAI-of6dw` (P3) — harden the researcher's agent-browser usage with safe-default flags (`--content-boundaries`, `--max-output`, `--allowed-domains`, `--action-policy`).

---

## 1. Dynamic / self-organizing agent workflows — `unitAI-544sf.1`

**What it is.** Runtime-decided spawn/handoff/stop (not a prewired chain). Three references:
- **Claude dynamic workflows** — JS script Claude writes, background runtime, ≤1000 subagents, intermediates in script vars, resumable in-session, no mid-run user input. (`code.claude.com/docs/en/workflows`)
- **Anthropic multi-agent research system** — lead agent spawns subagents, plan in memory, subagents write external artifacts and pass lightweight refs back; long-horizon work needs context compression + fresh subagents. (`anthropic.com/engineering/multi-agent-research-system`)
- **AutoScientists** (Harvard/`mims-harvard`) — shared experimental state via posts/comments/workspaces as a message bus; agents self-organize into hypothesis teams; stateless between sessions; stagnation/timeout salvage. (`arxiv.org/abs/2605.28655` + repo)

**Pattern.** Open-ended, breadth-first orchestration with shared *external* memory and explicit stop conditions — distinct from xtrm's current **static `chain_template` + policy-driven step-insert** (substrate §4.3, §6.9.3).

**Integration assessment.** xtrm already covers *bounded* adaptation (chain coordinator insert within autonomy policy). It does **not** have a runtime-branching, self-organizing research class. Good fit for mercury-style source-dive pipelines (breadth-first, tool-heavy, many independent threads, citations, external state); bad fit when same-context tight coupling dominates.

**Risks.** ~15× token cost vs chat (Anthropic's own number); weak long-chain context (substrate has no cross-session journal §4.3); coordination failure modes (duplicate work, stagnation, timeout).

**Recommendation — ADAPT (opt-in).** Keep policy-driven insert as default; add a `research/dynamic` chain class as an **opt-in catalog entry** for open-ended research only.

**Filed bead:** [`unitAI-wxl85`](https://github.com/Jaggerxtrm/specialists) (P3, open → deferred 2026-05-29 per operator decision) — design: opt-in research/dynamic (self-organizing) chain class.

---

## 2. agent-browser (Vercel) — `unitAI-544sf.2`

**What it is.** Native Rust browser-automation CLI (client → daemon → Chrome via CDP). Snapshot-ref a11y model optimized for LLM token efficiency; 50+ commands (open/click/fill/snapshot/get text/screenshot/pdf/eval/network/batch/chat). ~452 MB footprint (Chrome-for-Testing). **Not** an MCP server.

**Pattern.** Deterministic ref-based page interaction + extraction for agents.

**Integration assessment.** **Already adopted** as the researcher's Mode-4 read tool (see §0). Best transport: `agent-browser batch --json` (one call does open→snapshot→get-text). No new specialist needed.

**Risks.** ToS/rate-limits/bot-blocks; prompt injection from page content; `eval` runs page JS; HAR/network logs can capture tokens; Chrome+daemon footprint.

**Recommendation — ADOPTED (done).** Only justify a separate web-scraper specialist for long-running crawl / heavy extraction / strict per-target isolation.

**Filed bead:** `unitAI-of6dw` (P3, open → deferred 2026-05-29 per operator decision) — harden researcher agent-browser usage with safe-default flags (`--content-boundaries`, `--max-output`, `--allowed-domains`, `--action-policy`) + eval-deny on untrusted domains + HAR redaction. Independent tactical hardening; not roadmap-blocking.

---

## 3. SkillOpt (Microsoft) — `unitAI-544sf.3`

**What it is.** Trains skills "like neural nets" **without weight updates** via a 6-stage loop: `rollout` (scored trajectories) → `reflect` (patch dicts) → `aggregate` → `select` → `update` (`candidate_skill.md`) → `evaluate_gate` (accept only if candidate beats current; new best if beats best). Emits `SKILL.md` with **YAML frontmatter + body — same shape as xtrm skills**. (`github.com/microsoft/SkillOpt`)

**Pattern.** Trajectory-driven, gated, validation-first skill self-improvement.

**Integration assessment.** Document format already matches; the mismatch is metadata schema + a real validation/A-B harness. Cost scales with trajectory count (default `batch_size 40`, `workers 8`, `analyst_workers 16`, optimizer/target `gpt-5.5`).

**Risks.** No published minimum trajectory count; overfitting to transient runtime traces; needs a real held-out A/B harness to avoid false accept/reject.

**Recommendation — ADAPT (defer to post-v4).** Do **not** make this live self-editing now. Pilot **after v4 freeze** (roadmap §714-728 wants a clean post-ship revamp, not drip patches): 1 skill first, held-out task set + frozen registry snapshot; accept only if the primary metric improves with no key regressions. Quarterly cadence, not per-PR.

**Filed bead:** `unitAI-my1li` (P4, open → deferred 2026-05-29 per operator decision) — design (deferred): post-v4 SkillOpt-style skill-optimization pilot. Explicit defer until v4 freeze.

---

## 4. HexStrike AI — `unitAI-544sf.4`

**What it is.** MCP-backed security suite, ~100–150 tools (README "150+" vs MCP header "100+" — marketing, not contract; `github.com/0x4m4/hexstrike-ai`). Tool taxonomy:
- **Analysis** (safe on owned files/VMs): gdb, radare2, ghidra, checksec, binwalk, angr, pwntools, volatility3, exiftool, sleuthkit…
- **Authorized recon/assessment**: nmap, masscan, rustscan, amass, subfinder, httpx, katana, gobuster, ffuf, nuclei, nikto, prowler, scout-suite, trivy, checkov, kube-bench…
- **Opt-in active offense**: hydra, john, hashcat, medusa, netexec, responder, sqlmap, dalfox, pacu, msfvenom, AIExploitGenerator…

**Integration assessment.** Not a fit for the existing pi extension slot (resolver knows only native+gitnexus+serena) — needs a new adapter/catalog. Authorization is **coarse** (per-tool at wrapper level, but no built-in auth/sandbox/capability tokens; README says run in isolated VM, `alwaysAllow: []`).

**Risks.** Live-target misuse; no auth/sandbox; coarse auto-allow; cloud-tool secrets; taxonomy drift.

**Recommendation — ADAPT, and consider a NEW `security-tester` specialist.** The scan-only `security-auditor` (LOW, recommendations-only) is the wrong home for active/offensive tooling. **Proposed:** a distinct **`security-tester`** specialist for *active/authorized* testing (recon + local analysis baseline; offensive tools opt-in only), default-OFF, capability-tiered, per-repo opt-in + per-run audit log, gated on authorized scope + SCRUTINY=critical surfaces. `security-auditor` stays scan-only; `security-pipeline` stays semgrep+osv+gitleaks+dependabot baseline.

**Filed bead:** `unitAI-dhhm6` (P3, open → deferred 2026-05-29 per operator decision) — design: evaluate/spec a `security-tester` specialist (active testing) leveraging a HexStrike adapter, with a capability matrix and authorization model — explicitly NOT auto-enabled.

---

## 5. AWS Bedrock AgentCore — `unitAI-544sf.5`

**What it is.** Any-framework/any-model agent platform: Runtime, Memory, Gateway, Identity, Payments, Code Interpreter, Browser, Observability, MCP Server, Policy, **Evaluations**, Optimization. (`docs.aws.amazon.com/bedrock-agentcore`)

**Key pattern.** AgentCore **Evaluation** splits two roles:
- **Evaluators** — built-in *immutable LLM-judges* + *custom* evaluators (LLM judge or Lambda code); online / on-demand / batch; can evaluate agents *outside* AgentCore.
- **Diagnostic skill** — a *separate* log/trace triage flow for empty/failing evals (NOT a scorer).

Plus **DevOps Agent learned-skills**: SKILL.md + refs/assets, auto-load by description, agent-type targeting (incl. `Evaluation`), auto-refresh every 30 investigations / on capability change, non-executable docs only.

**Integration assessment.** The evaluator/diagnostic split maps cleanly onto xtrm's reviewer/code-sanity/security gates and should shape **roadmap Phase 7 R-checks**: a `score-check` (evaluator path) vs `diagnose-check` (plumbing/trace path). The learned-skills pattern mirrors the xtrm skill system; difference: AWS learns from telemetry, xtrm can learn from board/reports/docs (ties to SkillOpt §3).

**Risks.** AWS-specific glue (ARN/CloudWatch/X-Ray/console) is noise; preview/pricing text shifts. No AWS-runtime lock-in needed to adopt the patterns (consumption-billed, any-framework).

**Recommendation — ADAPT (extract pattern, no AWS dependency).**

**Filed bead:** `unitAI-cg4y6` (P2, open → deferred 2026-05-29 per operator decision) — design: absorb AgentCore evaluator-vs-diagnostic split into roadmap Phase 7 R-checks.

**⚠ OPERATOR NOTE 2026-05-29:** the AgentCore research scope was misunderstood by the researcher, and the derived recommendation here is **not valid as-is**. The "score-check vs diagnose-check" framing should NOT be absorbed into the roadmap. If the AgentCore direction is pursued later, the bead must be re-scoped and re-researched first. Left open + deferred for that future re-evaluation; not closed because the topic itself may still warrant fresh investigation under correct scope.

---

## 6. Agentic observability stack — `unitAI-544sf.6`

**What it is / capability gap.** xtrm has a SQLite canonical stream (`.specialists/db/observability.db`) + `sp log` / `sp feed` + channels/wakes/memory tables, but **no Prometheus exporter / `/metrics`**, **no alert-rule UI**, **no anomaly engine**, **no traces**.
- **Datadog** — biggest managed surface (monitors + anomaly + APM + log mgmt) but SaaS lock-in. (reference, not adopt)
- **Grafana** — dashboards + alerting over many sources; but core SQL sources are PG/MySQL/MSSQL, **not SQLite** → needs an adapter/ETL/plugin.
- **Snowflake** — cold cross-repo warehouse analytics only (per-second billing, 60s min); not the hot alert loop.

**Recommendation — ADOPT (Grafana first).** Keep raw in `observability.db`, export a curated view; add Grafana for dashboards + alerting (SQLite→Grafana adapter); add a new **`monitor`** specialist for the anomaly-detection gap (no native engine today); traces later only; Snowflake cold-warehouse only; Datadog reference-only.

**Filed bead:** `unitAI-itn9h` (P2, open → deferred 2026-05-29 per operator decision) — design: agentic observability — Grafana adapter + `monitor` specialist for anomaly gap.

---

## 7. CCH Tagetik — `unitAI-544sf.7` (scoping)

**What it is.** Wolters Kluwer **Corporate Performance Management (CPM)** suite — financial close, consolidation, planning, reporting, analytics, ESG/regulatory reporting; "single unified platform" with embedded AI, deployed on AWS. AWS relevance is real: AWS **Global Technology Partner** + AWS **Marketplace** listing + AWS Summit 2024 "cloud journey with AWS" speaker post (no official summit-agenda page found naming it — inferred). (`wolterskluwer.com/en/solutions/cch-tagetik`, AWS Marketplace)

**Recommendation — DEFER / SKIP.** Relevant only if xtrm pursues an enterprise-finance / reporting / FinOps direction (more a mercury/finance-stack tie than specialists-core). Researcher proposed an optional deeper P2 child if that direction matters.

**Proposed path → bead:** none now (defer); reopen scoping into a deeper bead only if the enterprise-finance direction is pursued.

---

## Decision summary

| # | Topic | Researcher recommendation | Filed bead | Operator decision 2026-05-29 |
|---|---|---|---|---|
| .5 | AgentCore eval pattern | Adapt → Phase 7 R-checks (score/diagnose split) | `unitAI-cg4y6` (P2) | **Deferred** — research scope misunderstood; recommendation invalid as-is; re-scope before any future absorbance |
| .6 | Observability | Adopt → Grafana adapter + `monitor` specialist | `unitAI-itn9h` (P2) | **Deferred** — net-new capability, out of current roadmap scope; promote when observability becomes priority |
| .1 | Dynamic workflows | Adapt (opt-in) → research/dynamic chain class | `unitAI-wxl85` (P3) | **Deferred** — substrate-level chain_template extension; future substrate-design iteration |
| .4 | HexStrike | Adapt → `security-tester` specialist | `unitAI-dhhm6` (P3) | **Deferred** — new specialist creation outside roadmap scope; revisit when security-active-testing becomes priority |
| .3 | SkillOpt | Adapt (later) → post-v4 pilot | `unitAI-my1li` (P4) | **Deferred** — explicit by design (post-v4) |
| .2 | agent-browser | Adopted | `unitAI-of6dw` (P3) | **Deferred** — adoption already done (researcher v1.3.0); hardening bead waits independent shipping window |
| .7 | CCH Tagetik | Defer/skip | (none filed) | **Skip** — only relevant if enterprise-finance direction pursued |

Cross-references: .5 (learned-skills) ↔ .3 (SkillOpt) both inform skill self-improvement; .1 ↔ substrate §4.3 chain coordinator; .6 ↔ `observability.db` / `sp log`.

---

## Operator decision 2026-05-29 — no roadmap integration

After review, the operator decided that **none of the 6 filed beads above gets integrated into the canonical roadmap** (`docs/design/roadmap/specialists-roadmap.md`). Reasons captured here for the next session:

1. **The roadmap is execution-ready** at 12 opportunities / 8 phases / D1–D30 / ~3–4 days wall-clock auto-mode. Mid-flight absorbance risks scope creep against a fixed shipping budget.
2. **`cg4y6` (AgentCore split) is invalid as-derived** — research scope misframed; the score-check/diagnose-check distinction proposed is not what AgentCore actually means in context. Re-scoping required before any future absorbance attempt.
3. **`itn9h` and `dhhm6` introduce net-new capabilities** (monitor specialist, security-tester specialist) outside the runtime-cleanup scope this roadmap addresses.
4. **`wxl85` is substrate-level** (chain_template class extension, §6.9.10 catalog) — belongs to substrate-design iterations, not the runtime roadmap.
5. **`my1li` is already explicitly deferred by design** (post-v4 freeze).
6. **`of6dw` is tactical hardening** of a just-shipped tool — ships independently when convenient, not roadmap-blocking.

All 6 beads are therefore **`bd defer`**'d (status: deferred). They remain in `bd list` (visible) but do not show in `bd ready` (not actionable). The bd `defer` semantics fit exactly here: not blocked, not closed — set aside for later consideration, revisited when operator promotes individually.

**Storage of research info — not lost by deferring:**
- This synthesis doc (`docs/design/post-aws-summit-research-findings.md`) is the canonical record of what was researched and what was recommended
- Per-stream researcher memos live on each `unitAI-544sf.{1-7}` bead's notes (auto-appended via `per-turn-handoff-schema`)
- Durable insights saved via `bd remember` (queryable later by future specialists via `bd memories <keyword>` per Opp 11 pull-not-push)
- Follow-up beads `cg4y6 / itn9h / wxl85 / dhhm6 / my1li / of6dw` themselves carry full scope + rationale on description

The research did the right job: mapped the territory, produced actionable recommendations, surfaced where the operator's strategic call is needed. Deferring is the strategic call.
