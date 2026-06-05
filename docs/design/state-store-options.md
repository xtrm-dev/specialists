# State Store & Deployment Tiers

> Status: design draft (2026-06-05).
> Resolves the recurring "SQLite vs Dolt vs Supabase for a shared store" question by
> separating it into **deployment tiers**. The storage choice is not one decision — it
> follows the tier (single user → team → company), all of which want web access to the
> console + DevOps + AgentOps optimization suite.
> Companion docs: `substrate-it-rev11.md` §13 (single-store + daemon), §17 (API faces),
> `specialist-agentops-suite.md` (the optimization suite this serves).

---

## 0. The realization

The earlier framing ("do you even need a shared DB?") assumed a single local user. That is
only the *smallest* edition. The real product spans a spectrum, and **every tier wants the
same web console** — work visualization + DevOps + the AgentOps optimization suite:

- **Solo, one machine** — one developer, local.
- **Solo, many machines** — same person, laptop + desktop + CI.
- **Team** — several people sharing a board, reviewing each other's specialist work.
- **Company** — many teams, many repos, central web access, roles/permissions.

The mistake is picking *one* store for all of them. The right move is a **two-tier
architecture** where the store scales with the tier, and the local runtime decision the
substrate doc already made (§13) stays intact at the bottom.

---

## 1. Two-tier architecture

```
            ┌─────────────────────────────────────────────┐
            │   SHARED / WEB TIER  (team, company)         │
            │   • web console (visualization)              │
            │   • DevOps + AgentOps optimization suite      │
            │   • auth (who sees what) · multi-user         │
            │   • realtime feed in the browser              │
            │   → Postgres / Supabase                       │
            └───────────────▲─────────────────────────────┘
                            │  projection / sync upward
                            │  (correlation by opaque ID, §13.1)
   ┌────────────────────────┴───────────────────────────────┐
   │   LOCAL RUNTIME TIER  (always present, authoritative)    │
   │   • sp / sb / channels · job lifecycle · worktrees       │
   │   • ONE daemon, ONE socket, ONE state.db per machine     │
   │   → SQLite (WAL)                                          │
   └──────────────────────────────────────────────────────────┘
```

**Bottom tier — local runtime (authoritative).** Unchanged from `substrate-it-rev11.md`
§13.2: one local SQLite (WAL) file behind one daemon, routing all projects/worktrees on the
machine by `project_id`. This is where the truth is written. It must stay local because the
whole §13.2 design exists to *avoid* the networked-server failure modes that burned bd
(Dolt corruption, "9 servers", "database not found in worktree"). Solo users never need
anything above this.

**Top tier — shared/web (projection).** When you cross into team/company, you need a place
that: serves a web console to many people, knows *who can see what*, and pushes live updates
into a browser. That is a fundamentally different store with different requirements (auth,
multi-user concurrency, realtime, a web API). The local SQLite runtime **projects/syncs
upward** into it; the shared tier is a **read-mostly projection plus team-level writes**
(comments, approvals, optimization decisions), never the source of truth for runtime state.

This is exactly the §17.3 "materialize vs read-live" fork applied at the deployment seam:
local stays read-live-authoritative; the team/company view is materialized upward.

---

## 2. Storage per tier

| Tier | What it needs | Store | Why |
|---|---|---|---|
| Solo, one machine | local, fast, zero-ops | **SQLite + daemon** | the substrate design; nothing to add |
| Solo, many machines | shared state, still light, no team/web | **libSQL / Turso** (shared/replicated SQLite) | near drop-in with existing SQLite code; no heavy server |
| Team | web console, auth, multi-user, realtime | **Supabase (Postgres)** | bundles auth + realtime + API the web console needs |
| Company | all of the above + roles, scale, central web | **Supabase / Postgres** (managed or self-hosted) | mature, scalable, battle-tested |

Note the jump: **libSQL/Turso solves "one person, many machines" but does *not* give
auth/realtime/web-API.** The moment the console is multi-user and web-facing (team/company),
you need that bundle — which is precisely what Supabase adds on top of Postgres.

---

## 3. Why Supabase for the shared tier (not plain Postgres, not Dolt)

**vs Dolt — out, unless data-versioning becomes a product feature.** Dolt's only unique
value is git-style branch/merge/diff *on the data*. We don't want that (and bd already got
burned: immature, wonky, corruption). Crucially, the "track history / audit changes" need —
the *useful* part of versioning — is already met **without** Dolt: substrate §17 owns its
store and emits a monotonic `changesSince(cursor)` feed. We get change-tracking from a normal
DB; we do not need Dolt's storage engine. Dolt re-enters only if branch/merge-of-data is ever
a deliberate feature. It isn't today.

**vs plain Postgres — Supabase *is* Postgres**, plus the four things the multi-user web
console would otherwise force us to build by hand:
- **Auth** — registration, sessions, "who sees which project/repo" (essential for team/company).
- **Realtime** — row changes → websockets → the console updates live in the browser (this is
  the web equivalent of `sp feed`/`sb feed`).
- **Auto REST/GraphQL API** — the console reads/writes data with no bespoke backend.
- **Storage** — artifacts, plan files, reports.

Pick *plain* Postgres only if you want zero extra services and will build the API/auth/realtime
layer yourself anyway. For a console that must serve teams/companies, Supabase removes exactly
the backend you'd otherwise write.

**Speed/efficiency:** Postgres (under Supabase) is decades-mature and fast for this workload.
Dolt pays a performance tax for the history tracking we don't want. So "fast, efficient,
shared" points at Postgres, not Dolt.

---

## 4. How the AgentOps suite maps onto the tiers

The optimization suite (`specialist-agentops-suite.md`) splits naturally across the seam, and
this is the answer to its open question §12 ("cross-repo aggregation — where does the store
live?"):

- **Capture stays local** — `sp-improve(<name>)` proposal beads + per-run telemetry/forensics
  are written by the local runtime, per machine, as work happens.
- **Aggregation, evaluation, golden-sets, console-driven eval runs go to the shared tier** —
  cross-repo, cross-user pooling (hundreds of runs/week across repos) needs the networked
  store. The web console's "fleet maturity view" + "proposal queue" + "run the suite" buttons
  read/write the shared tier.

So the AgentOps suite is *why* the shared tier exists for non-solo users, and the shared tier
is *where* the suite's cross-repo aggregation lands. They justify each other.

---

## 5. Decision tree

```
Need to share state at all?
├─ No (solo, one machine) ........................ SQLite + daemon   ← substrate §13, done
└─ Yes
   ├─ Just my own machines, no team/web ......... libSQL / Turso (shared SQLite, light)
   └─ Team / company web console (auth, realtime)  Supabase (Postgres)
        └─ Do I want git-style branch/merge of DATA?
           ├─ No (default) .......................  stay on Postgres
           └─ Yes (deliberate feature) ..........  only then consider Dolt
```

---

## 6. Why keep the runtime local even when the shared tier exists

- **The bd→Dolt lesson (§13.2):** a networked server *as the runtime* caused corruption and
  coordination failures. The shared tier is a projection, not the write path for job/container
  lifecycle.
- **Offline / solo resilience:** a developer must be able to work with no server reachable.
- **Clean seam:** the no-cross-domain-FK discipline (§13.1, correlation by opaque ID) makes
  projecting local rows upward into Postgres trivial — IDs are just strings; the shared tier
  stitches them in the reader, same pattern as the single-store join.

---

## 7. Migration / compatibility

- The codebase is SQLite today (`observability-sqlite.ts`, etc.). The shared tier is
  **additive** — a projection/sync target — so adopting it does **not** rewrite the runtime.
- **libSQL/Turso** is the lowest-friction "shared" step because it aims at SQLite
  compatibility (closest to existing code). It is the right answer for *solo-many-machines*,
  the wrong answer for *team web* (no auth/realtime/API).
- **Supabase** is introduced when (and only when) the console goes multi-user/web. Build the
  projection as a one-way sync from local `state.db` → Supabase tables, keyed by the same
  opaque IDs.

---

## 8. Open questions

- **Sync direction & conflict** — is the shared tier strictly read-only-projection, or do
  team writes (approvals, comments, optimization decisions) flow *back* down? Lean: team
  writes live only in the shared tier, correlated by ID, never overwriting local runtime rows.
- **Self-host vs managed Supabase** — self-host for data ownership (Docker compose) vs managed
  for zero-ops; company tier may demand self-host.
- **Auth model** — map specialist permission tiers (LOW/MEDIUM/HIGH) + SCRUTINY onto Supabase
  row-level security / roles for the web tier.
- **What exactly projects upward** — full runtime state, or a curated console/AgentOps view?
  (Ties to §17.3: curate, don't mirror everything.)
- **n8n's place** — orchestrates between `sp serve` (local script specialists) and the shared
  Supabase tier; it is glue, not a store.
