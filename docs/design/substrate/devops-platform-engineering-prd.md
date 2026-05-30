# PRD (DRAFT) — DevOps / Platform Engineering for xtrm + Mercury

> **Status:** DRAFT · living document · started 2026-05-30 · operator-driven.
> **Provenance:** grew out of research epic `unitAI-544sf` (AWS Bedrock AgentCore,
> AWS DevOps Agent learned-skills, observability, HexStrike) + grounding in
> `~/dev/gitboard` (Omniforge console) + operator vision notes (2026-05-29/30).
> **Tracking:** `unitAI-ia1xw` (this doc). Future interactions (transcripts, researcher
> runs, design passes) build on top of this doc. No devops work-beads filed yet —
> operator gates that.
> **Related beads (not yet re-scoped):** `unitAI-rgu4q` (observability, reframed),
> `unitAI-x84i8` (security-tester), `unitAI-4urhs` (AgentCore eval → Phase 7 R-checks),
> `unitAI-mg5sm` (SkillOpt pilot), `unitAI-of6dw` (agent-browser hardening).

---

## 1. Problem & motivation

The specialists roster has **no devops/platform agent**. Operating the Mercury
stack (50+ independently deployable services: agent runtimes, specialist services,
MCP servers, Dolt, shared LSP, schedulers, APIs, workers) is today **terminal-only +
a light `gitboard` app**. There is no standardized telemetry, no agentic
detect→triage→RCA→mitigation loop, no deploy automation behind a stable interface,
and IaC (Terraform) has been consistently ignored and is not well understood.

AWS recently shipped the **AWS DevOps Agent** — a powerful, well-scoped pipeline
with a full UI/UX and an agent-type family (Generic / On-demand / Incident Triage /
Incident RCA / Incident Mitigation / Evaluation) plus learned-skills auto-generated
from telemetry. It is both a **tool** we can wire to our VPS stack and a **reference
architecture** for the devops capability we want.

---

## 2. Strategic framing — two separate tracks

These must NOT be conflated. They run in parallel and inform each other.

### Track A — Product / SDK (the long game)
1. Use **specialists/substrate** to build an **"SDK"** for integrating easily into Mercury.
2. Dogfooding Mercury surfaces **gaps, bugs, UX problems** → feed them back to improve specialists.
3. Harden xtrm into a **product for customers** — become their partner and integrate it
   into their systems reliably.

> Mercury is the proving ground that turns xtrm from internal tooling into a sellable platform.

### Track B — Infra / telemetry (actionable now, operator-led)
1. **Scan `~/projects/mercury/infra`** to detect what telemetry is missing.
2. Use specialists to **map every Mercury repo** and **rebuild better Grafana dashboards now**.
3. Decide whether to integrate **beyond Prometheus / Grafana / OpenTelemetry**.

> This is what the operator can work on immediately, independent of the product track.

---

## 3. Core principle — coexist & integrate, do NOT rebuild

We do **not** recreate Grafana inside the console. We **make the systems coexist**:
- **Import** Grafana dashboards; **build on top of** Grafana / Prometheus / OpenTelemetry / Terraform.
- gitboard becomes the **agentic, xtrm-native layer on top of** standard infra (via **MCP + custom tools**), surfacing — not replacing — Prometheus/Grafana.
- IaC (Terraform-like) is adopted, not reinvented.

> Correction to an earlier framing: it is NOT "gitboard vs Grafana." gitboard is the
> agentic console that *integrates* Grafana/Prometheus/Terraform and adds the agent layer.

---

## 4. The DevOps capability — two operating contexts

A single agent spanning both becomes unfocused. Treat as two contexts (likely → distinct
specialists or one persona with two skill-packs — **open decision §9**).

### 4a. Platform / internal (the specialists/substrate/core stack itself) — *immediately actionable*
- Automatic agent deployment; server provisioning
- CPU / RAM / **token usage** monitoring
- Worktree & job-runner management
- Alerting on critical services
- Backup & disaster recovery
- Platform scalability
- Full observability of pipeline, MCP, databases
- `sp ps` verification, cleanup, orphan-process / serena-lsp / dolt monitoring

> This context maps directly onto gitboard's existing event-bus + the specialists `observability.db`.

### 4b. Cloud / VPS / AWS (the infra frontier) — *less charted; IaC gap lives here*
- Build CI/CD pipelines
- Manage Kubernetes
- Configure AWS / Azure / GCP
- Write Terraform
- Automate deployment
- Monitor systems; manage alerts
- Optimize reliability & cost
- Implement pipeline security
- Support developers in delivery

---

## 5. Roles & roster additions

### Delivery vs. monitoring — *separable roles, joined at the deploy boundary*
- **`deployer` specialist (delivery / CI-CD / IaC)** — build → test → scan → publish →
  deploy → health-check. **Per-repo configured.** Owns CI/CD + Terraform.
- **`devops` / SRE specialist (ops / observability)** — runtime observability, anomaly
  detection, incident triage → RCA → mitigation, capacity & cost.
- **Handoff = the pulse:** a deploy event fires → Ops watches **pre/post** performance +
  error rates → **pushes back** to Dev on regression. (The Dev↔Ops post-deploy loop.)

> Open: one `devops` persona with delivery+ops skill-packs, or two specialists? (§9)

### Deploy-via-specialist (governance primitive)
- Instead of dev agents running `docker compose up` directly, a correctly per-repo-configured
  devops/deployer specialist is invoked via e.g. **`make spdeploy`**.
- Dev agents are **instructed** to use it.
- A **hook + extension forbids direct `docker` commands** (enforcement).
- Matches the DX principle: complex infra abstracted behind stable interfaces (`mercury deploy`).

---

## 6. AWS DevOps Agent — dual role

- **As a tool:** wire it to the VPS stack first (powerful, immediate leverage).
- **As a reference:** mirror its pipeline + UI/UX + agent-type family (Triage / RCA /
  Mitigation / Evaluation) + learned-skills-from-telemetry for our own specialist(s).
- Then decide integration shape (§9): wire it into the specialists-service container, vs.
  a dedicated **devops-specialist container** (with a clone of the repo under investigation +
  access to Prometheus metrics).

---

## 6.1 Grounded reference architecture (from re:Invent COP362 + "Introducing" + Tech Tales GA demos)

Transcript analyses live in `~/second-mind/inbox/transcripts/*.analysis.md`. They confirm the
agent is mechanically **LLM reasoning over MCP tools, grounded by a continuously-built topology
graph** — *"there's nothing special… about GitHub Actions… it's an LLM frankly"* (COP362 30:34);
*"the key unlock… is thanks to LLMs and MCP"* (33:14). We already have the pieces (specialists =
LLM reasoning; MCP; GitNexus = code graph; gitboard scanner + event-bus). **What's missing is
narrow:** an infra topology graph + an MCP query server over our telemetry + a skill encoding the
RCA loop.

**Operating model to mirror:**
- **Two lanes.** *Reactive* — alarm/ticket/page → pull logs/metrics/traces → build/use topology →
  RCA + mitigation (prepare→pre-validate→apply→post-validate→rollback) → report. *Proactive* —
  background scan of past incidents → clustered posture recommendations (autoscaling safety, IAM
  hardening, health-check rollback, pre-prod test gates). → **Maps onto the pulse primitive:
  event-pulse drives reactive; scheduled-pulse drives prevention. The pulse is the spine.**
- **Topology / knowledge graph as reasoning substrate.** Built from account resources (IAM-visible
  relations) + telemetry service maps + CI/CD deployment entities; it *limits* the investigation
  search space. → We need an **infra topology graph** (distinct from GitNexus's code graph), fed by
  gitboard's UnifiedScanner + telemetry + deploy events.
- **Agent space = blast-radius boundary.** IAM-scoped, **read-only by default (get/list/describe,
  no edit)**, segmented by ownership (team/division). Setup ≈ "2 seconds". → Maps to our
  **per-repo/per-source scope + permission tiers**.
- **Trust-first, staged autonomy.** GA is recommendation-only; action-taking is roadmap, gated by
  the safe-change envelope + human approval ("trust first… then keys to the castle"). →
  **Resolves the autonomy question (§9):** devops specialist starts READ_ONLY/recommend (like
  `security-auditor`), graduates to action behind `make spdeploy` + prepare→validate→rollback.
- **Team-member embedding.** Triggered by alarms/tickets/pages; writes findings back to
  Slack/ServiceNow; works with other agents; one-click human escalation. → Maps to handoff-notes +
  Dev↔Ops pulse collaboration + operator escalation.
- **MCP-centric, BYO MCP.** Built-ins (CloudWatch, Dynatrace, Datadog, New Relic, Splunk) + **BYO
  MCP for OSS (Grafana/Prometheus/Loki) and custom** (demo: AgentCore MCP Gateway + Lambda + S3,
  built in ~20–40 min). → **Validates coexist-not-rebuild (§3): AWS itself integrates
  Grafana/Prometheus via MCP, doesn't replace them.** Confirms §7's MCP query server.
- **Skills / runbooks / steering.** Skills encode triage/RCA *format* (uploadable templates);
  runbooks encode ops micro-hints (log-ingest delay, grep context lines); steering redirects
  in-flight. → **Direct reuse of our skills + mandatory-rules + steering.**
- **CI/CD correlation.** GitHub/GitLab/CloudFormation → deployments mapped as entities → symptom
  onset correlated to recent change. → Validates the **Dev↔Ops post-deploy pulse**.
- **Incident → permanent fix.** Mitigation spec handed to Kiro (spec-driven) → property-based
  tests. → Maps to devops → executor/debugger → test-runner; an incident spawns a follow-up bead.
- **Investigation = parallel subagents**, multi-hypothesis, **documents ruled-out paths**
  (transparency). → Maps to debugger hypotheses + reviewer evidence matrices + workflow parallelism.
- **Partial-outage interpretation** (old task serving while new tasks fail; deployment stuck) — a
  nuance our monitor must capture, not just green/red.

**Benchmarks to mirror for our eval (ties `unitAI-4urhs`):** 1000+ internal incidents, **86% RCA
success**; Commonwealth Bank **5h→15m** RCA; agent-space quotas (20 agents/acct, 20h investigate +
15h prevent/mo in preview); per-second billing offset by AWS support credits. **The gaps they never
showed** — confidence scoring, false-positive cost, action-stage governance — are exactly the
R-checks we'd own.

---

## 7. Architecture — design the query path from the get-go

A devops agent is only useful if it has a **clear way to analyze** Prometheus, logs, etc.
This must be accounted for in the **substrate API design from the start**, including:

- **An MCP server that lets the devops agent query** — Prometheus metrics, logs, infra state.
- **Substrate API** surfaces telemetry/query primitives as first-class (not bolted on later).
- **gitboard devops page** — a dedicated page connected to the infra side, with the devops
  agent integrated; embeds Grafana, surfaces Prometheus, shows incident/triage state.
- Telemetry is **expanded + standardized** across repos (current Prometheus coverage is
  decent but incomplete and non-uniform).
- **The MCP query server lives in `mercury/infra` and grows with the telemetry.** As the
  telemetry-standardization pass adds metrics/log streams, the infra MCP exposes them —
  so the devops agent's query surface expands in lockstep with coverage. (Operator point,
  2026-05-30.) Mirrors AWS's AgentCore MCP Gateway pattern (§6.1) but home-rooted in infra.

### 7.1 Per-service knowledge substrate — service skills (gitnexus-enhanced)

The devops agent needs per-service operational knowledge, not just raw metrics. We already
have it: **service skills** (`.xtrm/skills/.../packs/<pack>/<service>/SKILL.md`) are
expert-persona docs per service — **Architecture, Data Flows, Cross-Service Health Check
(runnable bash), Failure Modes (symptom/cause/fix), Troubleshooting** — wired to `explorer`
+ `executor` for navigation. This is the direct analogue of the AWS agent's **runbooks +
per-service topology context** (§6.1).

- The **`service-skills-sync` librarian** (`.specialists/user/service-skills-sync.specialist.json`
  in market-data) already keeps these in sync with code drift using **gitnexus**
  (`detect_changes`/`impact`/`context`) + Serena, gated by a `drift_detector.py` pre-scan and
  PostToolUse/pre-commit/pre-push hooks (the `service-skills-set` "Trinity").
- **Proposal:** propagate gitnexus-awareness into the **default `service-skills-set`**
  (creating/using/updating skills), not just the market-data user override, so every service's
  skill is graph-navigable — and run the librarian as standard maintenance. The devops agent
  then **reads service skills as its per-service runbook/topology layer**; the health-check
  commands + failure-mode tables are exactly what the RCA loop consumes.
- Reference: example finished pack
  `~/projects/mercury/market-data/.xtrm/skills/user/packs/market-data/ingesting-pipeline/SKILL.md`
  (stack skill: members table, data-flow diagram, cross-service health check, failure-mode table).

> **Filed (2026-05-30):** `xtrm-tkqjn` (xtrm-tools) — make the default `service-skills-set`
> devops-aware + gitnexus-aware (the four workflow skills + registry/hooks), so every install
> inherits it. Paired with `mercury-market-data-5qts` (market-data) — a spike for a
> **script-specialist that auto-syncs service skills on master commit/PR-merge**, devops-aware
> and gitnexus-deep (semantic drift via detect_changes/impact, not mtime).

---

## 8. Foundations / prerequisites (must precede a useful agent)

1. **Telemetry standardization pass** — a first exploration pass over **all Mercury repos**
   (start: `~/projects/mercury/infra`) to inventory current metrics and define a **standard
   emission contract**. The process must be standardized, not per-repo ad hoc.
   → **Filed: `infra-bnh`** (mercury/infra project) — also covers the devops query-MCP (grows
   with telemetry), the OpenTelemetry eval, and the Terraform/IaC eval. Infra agents implement.
2. **Pulse-emitter primitive** — wake on **events** + **scheduled intervals**. Prototype this
   *now*, ahead of substrate-as-long-running-node landing in the xtrm project group. (When
   substrate lands, this expands into a long-running node.)
3. **IaC / Terraform literacy** — close the operator's knowledge gap; underpins provisioning,
   the cloud context, and reproducibility.
4. **MCP query server + substrate API hooks** — see §7.

---

## 9. Decisions

### Resolved by the transcript analysis (§6.1)
- **Autonomy / act-vs-recommend:** devops specialist starts **READ_ONLY / recommend-first** (like
  `security-auditor`), graduates to action behind `make spdeploy` + the
  prepare→pre-validate→apply→post-validate→rollback envelope + human approval. (AWS trust-first path.)
- **CI/CD vs monitoring:** separable roles (delivery vs ops), joined by the pulse. CI/CD-build is a
  different role, same lifecycle.
- **Coexist vs rebuild:** coexist — integrate Grafana/Prometheus/Loki via MCP (AWS does exactly this).
- **Reactive vs proactive:** two lanes, both driven by the pulse primitive (event vs scheduled).

### Still open
- One `devops` persona (delivery + ops skill-packs) **or** two specialists (`deployer` + `devops`)?
  *(Leaning two: a read-only `devops`/SRE for RCA+prevention, a `deployer` for safe-change delivery.)*
- Integration shape for AWS DevOps Agent: specialists-service container vs dedicated
  devops-specialist container (repo clone + Prometheus access)?
- Is the deployer **per-repo export** (like security-pipeline) the right model?
- Beyond Prometheus / Grafana / OpenTelemetry — integrate more (Datadog-like)? Decide after the
  telemetry pass.
- IoT / Terraform: scope of IaC adoption.
- **Infra topology graph** (new primitive, §6.1): build standalone, or extend GitNexus / gitboard's
  scanner? Where does it live and how is it kept fresh?
- MCP query server: where it lives + auth/permission model (scoped, read-only by default).

---

## 10. Research backlog (run on operator go — `--no-beads` / untracked)

- ✅ **DONE — Transcribed + analyzed** (operator-provided; folded into §6.1). Analysis docs in the Obsidian vault (`~/second-mind/inbox/transcripts/`):
  - re:Invent 2025 COP362 "Move beyond reactive: Transform cloud ops with AWS DevOps Agent" — [`AWS-reInvent-2025-Move-beyond-reactive-Transform-cloud-ops-with-AWS-DevOps-Agent-COP362.analysis.md`](~/second-mind/inbox/transcripts/AWS-reInvent-2025-Move-beyond-reactive-Transform-cloud-ops-with-AWS-DevOps-Agent-COP362.analysis.md) · [youtube.com/watch?v=JajBEYle67I](https://www.youtube.com/watch?v=JajBEYle67I)
  - "Introducing AWS DevOps Agent" — [`Introducing-AWS-DevOps-Agent-Amazon-Web-Services.analysis.md`](~/second-mind/inbox/transcripts/Introducing-AWS-DevOps-Agent-Amazon-Web-Services.analysis.md) · [youtube.com/watch?v=fMQfzwS0prQ](https://www.youtube.com/watch?v=fMQfzwS0prQ)
  - "Diving Deep on AWS DevOps Agent | AWS Tech Tales" — [`Diving-Deep-on-AWS-DevOps-Agent-AWS-Tech-Tales.analysis.md`](~/second-mind/inbox/transcripts/Diving-Deep-on-AWS-DevOps-Agent-AWS-Tech-Tales.analysis.md) · [youtube.com/watch?v=uFgGARWSCWk](https://www.youtube.com/watch?v=uFgGARWSCWk)
- **Researcher (docs):** AWS DevOps Agent official docs — `docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.html`
- **Researcher (broad scope):** *what a devops agent should be an expert of* — rubric = the
  Responsibilities spec in §11.
- **Researcher (tech landscape):** **detect what technologies are used in devops** (the stack
  a devops persona must know).
- **Researcher:** Terraform / IaC from zero — `developer.hashicorp.com/terraform/tutorials/docker-get-started`.
- **Researcher:** Prometheus + Grafana querying / embedding via MCP + custom tools.
- **Explorer (READ_ONLY):** Mercury telemetry inventory across repos (`~/projects/mercury/*`).

---

## 11. Reference — DevOps / Platform Engineering Responsibilities for Mercury

> Operator-authored rubric. Used as the scope for `researcher` runs and as the
> capability checklist for the devops specialist(s).

**Mission.** DevOps within Mercury is not feature development — it is *enabling developers
to build, test, deploy, operate, and scale the platform safely, efficiently, repeatably.*
DevOps owns the platform layer between software engineering and infrastructure; the goal is
to maximize developer velocity while maintaining reliability, observability, security, and
operational control. (DevOps → **Platform Engineering**.)

**CI/CD.** Fully automated. Every change triggers a standardized pipeline:
Git Push → Automated Validation → Docker Build → Security Scanning → Artifact Publishing →
Deployment → Health Verification. Manual deploys are the exception.

**Platform & container infra.** Container orchestration, service discovery, secrets mgmt,
network config, resource allocation, restart policies, environment mgmt, scalability —
predictable, resilient operation (Compose / Swarm / Nomad / k8s; objective identical).

**Observability** (first-class). Real-time visibility into system health, agent execution,
queue depth, resource consumption, token utilization, failure rates, latency, infra state.
Central metrics via Prometheus, visualized via Grafana. Examples: active specialists, running
/ waiting jobs, LSP instance counts, Dolt server counts, token consumption, memory, CPU, API
latency, queue growth.

**Alerting.** Detect abnormal states and route to operators before user impact:
`dolt_servers > expected_count`, `queue_depth > threshold`, `memory_usage > threshold`,
`token_consumption > budget`, `specialist_failure_rate > threshold`, duplicate infra
processes, MCP connectivity failures, DB unavailability.

**Reliability engineering.** Graceful failure: automatic restarts, health checks, retries,
failure isolation, backups, recovery & DR — no single-component failure cascades platform-wide.

**Capacity planning.** Continuously answer: how many specialists/LSP instances concurrently;
peak memory; bottleneck services; marginal cost of workload; throughput limits.

**Cost management.** Track token consumption, model usage, compute, storage growth, network,
per-service cost. Determine: most expensive agents/workflows, cost per job/user/workflow-category.
Operational visibility includes **financial** visibility.

**Developer experience (DX).** Reduce friction; devs shouldn't need deep ops knowledge.
Expose simple workflows: `mercury new-specialist`, `mercury test`, `mercury deploy`,
`mercury logs`, `mercury debug`. Abstract infra behind stable interfaces.

**Security.** Embedded in the platform lifecycle: secret mgmt, credential rotation, dependency
& container-image scanning, access control, audit logging, supply-chain validation — automated
wherever possible.

**Summary.** The real objective is not deploying 50+ services — it's providing immediate answers:
why is a workflow delayed; which agent is consuming excessive tokens; why are extra LSP instances
spawning; which component is failing; current operational cost; where the platform bottleneck is.
A successful Mercury platform lets developers focus on building agents/features while the system
provides deployment automation, observability, reliability, scalability, security, and
operational insight **by default**.
