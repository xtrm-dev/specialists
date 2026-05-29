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

**Proposed path → bead:** design bead for an opt-in dynamic/self-organizing chain class (substrate), deferred-friendly.

---

## 2. agent-browser (Vercel) — `unitAI-544sf.2`

**What it is.** Native Rust browser-automation CLI (client → daemon → Chrome via CDP). Snapshot-ref a11y model optimized for LLM token efficiency; 50+ commands (open/click/fill/snapshot/get text/screenshot/pdf/eval/network/batch/chat). ~452 MB footprint (Chrome-for-Testing). **Not** an MCP server.

**Pattern.** Deterministic ref-based page interaction + extraction for agents.

**Integration assessment.** **Already adopted** as the researcher's Mode-4 read tool (see §0). Best transport: `agent-browser batch --json` (one call does open→snapshot→get-text). No new specialist needed.

**Risks.** ToS/rate-limits/bot-blocks; prompt injection from page content; `eval` runs page JS; HAR/network logs can capture tokens; Chrome+daemon footprint.

**Recommendation — ADOPTED (done).** Only justify a separate web-scraper specialist for long-running crawl / heavy extraction / strict per-target isolation.

**Proposed path → bead:** `unitAI-of6dw` (already filed) — safe-default flags + eval-deny on untrusted domains + HAR redaction.

---

## 3. SkillOpt (Microsoft) — `unitAI-544sf.3`

**What it is.** Trains skills "like neural nets" **without weight updates** via a 6-stage loop: `rollout` (scored trajectories) → `reflect` (patch dicts) → `aggregate` → `select` → `update` (`candidate_skill.md`) → `evaluate_gate` (accept only if candidate beats current; new best if beats best). Emits `SKILL.md` with **YAML frontmatter + body — same shape as xtrm skills**. (`github.com/microsoft/SkillOpt`)

**Pattern.** Trajectory-driven, gated, validation-first skill self-improvement.

**Integration assessment.** Document format already matches; the mismatch is metadata schema + a real validation/A-B harness. Cost scales with trajectory count (default `batch_size 40`, `workers 8`, `analyst_workers 16`, optimizer/target `gpt-5.5`).

**Risks.** No published minimum trajectory count; overfitting to transient runtime traces; needs a real held-out A/B harness to avoid false accept/reject.

**Recommendation — ADAPT (defer to post-v4).** Do **not** make this live self-editing now. Pilot **after v4 freeze** (roadmap §714-728 wants a clean post-ship revamp, not drip patches): 1 skill first, held-out task set + frozen registry snapshot; accept only if the primary metric improves with no key regressions. Quarterly cadence, not per-PR.

**Proposed path → bead:** deferred/backlog bead — post-v4 SkillOpt-style skill-optimization pilot.

---

## 4. HexStrike AI — `unitAI-544sf.4`

**What it is.** MCP-backed security suite, ~100–150 tools (README "150+" vs MCP header "100+" — marketing, not contract; `github.com/0x4m4/hexstrike-ai`). Tool taxonomy:
- **Analysis** (safe on owned files/VMs): gdb, radare2, ghidra, checksec, binwalk, angr, pwntools, volatility3, exiftool, sleuthkit…
- **Authorized recon/assessment**: nmap, masscan, rustscan, amass, subfinder, httpx, katana, gobuster, ffuf, nuclei, nikto, prowler, scout-suite, trivy, checkov, kube-bench…
- **Opt-in active offense**: hydra, john, hashcat, medusa, netexec, responder, sqlmap, dalfox, pacu, msfvenom, AIExploitGenerator…

**Integration assessment.** Not a fit for the existing pi extension slot (resolver knows only native+gitnexus+serena) — needs a new adapter/catalog. Authorization is **coarse** (per-tool at wrapper level, but no built-in auth/sandbox/capability tokens; README says run in isolated VM, `alwaysAllow: []`).

**Risks.** Live-target misuse; no auth/sandbox; coarse auto-allow; cloud-tool secrets; taxonomy drift.

**Recommendation — ADAPT, and consider a NEW `security-tester` specialist.** The scan-only `security-auditor` (LOW, recommendations-only) is the wrong home for active/offensive tooling. **Proposed:** a distinct **`security-tester`** specialist for *active/authorized* testing (recon + local analysis baseline; offensive tools opt-in only), default-OFF, capability-tiered, per-repo opt-in + per-run audit log, gated on authorized scope + SCRUTINY=critical surfaces. `security-auditor` stays scan-only; `security-pipeline` stays semgrep+osv+gitleaks+dependabot baseline.

**Proposed path → bead:** deferred bead to evaluate/spec a `security-tester` specialist (active testing) leveraging a HexStrike adapter, with a capability matrix and authorization model — explicitly NOT auto-enabled.

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

**Proposed path → bead:** design bead — absorb the evaluator-vs-diagnostic split into roadmap **Phase 7 R-checks** (`score-check` / `diagnose-check`).

---

## 6. Agentic observability stack — `unitAI-544sf.6`

**What it is / capability gap.** xtrm has a SQLite canonical stream (`.specialists/db/observability.db`) + `sp log` / `sp feed` + channels/wakes/memory tables, but **no Prometheus exporter / `/metrics`**, **no alert-rule UI**, **no anomaly engine**, **no traces**.
- **Datadog** — biggest managed surface (monitors + anomaly + APM + log mgmt) but SaaS lock-in. (reference, not adopt)
- **Grafana** — dashboards + alerting over many sources; but core SQL sources are PG/MySQL/MSSQL, **not SQLite** → needs an adapter/ETL/plugin.
- **Snowflake** — cold cross-repo warehouse analytics only (per-second billing, 60s min); not the hot alert loop.

**Recommendation — ADOPT (Grafana first).** Keep raw in `observability.db`, export a curated view; add Grafana for dashboards + alerting (SQLite→Grafana adapter); add a new **`monitor`** specialist for the anomaly-detection gap (no native engine today); traces later only; Snowflake cold-warehouse only; Datadog reference-only.

**Proposed path → bead(s):** SQLite→Grafana adapter + dashboards/alerting; a `monitor` specialist for anomaly detection.

---

## 7. CCH Tagetik — `unitAI-544sf.7` (scoping)

**What it is.** Wolters Kluwer **Corporate Performance Management (CPM)** suite — financial close, consolidation, planning, reporting, analytics, ESG/regulatory reporting; "single unified platform" with embedded AI, deployed on AWS. AWS relevance is real: AWS **Global Technology Partner** + AWS **Marketplace** listing + AWS Summit 2024 "cloud journey with AWS" speaker post (no official summit-agenda page found naming it — inferred). (`wolterskluwer.com/en/solutions/cch-tagetik`, AWS Marketplace)

**Recommendation — DEFER / SKIP.** Relevant only if xtrm pursues an enterprise-finance / reporting / FinOps direction (more a mercury/finance-stack tie than specialists-core). Researcher proposed an optional deeper P2 child if that direction matters.

**Proposed path → bead:** none now (defer); reopen scoping into a deeper bead only if the enterprise-finance direction is pursued.

---

## Decision summary

| # | Topic | Decision | Becomes |
|---|---|---|---|
| .5 | AgentCore eval pattern | Adapt | Design bead → Phase 7 R-checks (score/diagnose split) |
| .6 | Observability | Adopt | Grafana adapter + `monitor` specialist bead(s) |
| .1 | Dynamic workflows | Adapt (opt-in) | Design bead → opt-in `research/dynamic` chain class |
| .4 | HexStrike | Adapt | Deferred bead → evaluate **`security-tester`** specialist (active testing) |
| .3 | SkillOpt | Adapt (later) | Deferred bead → post-v4 skill-optimization pilot |
| .2 | agent-browser | Adopted | Done (`of6dw` hardening follow-up open) |
| .7 | CCH Tagetik | Defer/skip | None (reopen only if enterprise-finance pursued) |

Cross-references: .5 (learned-skills) ↔ .3 (SkillOpt) both inform skill self-improvement; .1 ↔ substrate §4.3 chain coordinator; .6 ↔ `observability.db` / `sp log`.
