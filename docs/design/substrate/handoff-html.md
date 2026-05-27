# HTML handoff — substrate-design.html update + channels.html creation

> **Audience.** The agent in the next session who will do the HTML/typesetting work. This is a self-contained brief: with this document and the four canonical files it references, you do not need the prior session's conversation history.
>
> **What's asked.** Two HTML deliverables, both styled identically: (1) bring `substrate-design.html` from its current state (~rev6/7) up to rev10, and (2) create a fresh `channels.html` from `channels.md` in the same style. Existing `substrate-design.html` is the visual reference; this handoff documents the style explicitly so you do not have to reverse-engineer it.
>
> **Operator.** Jaggerxtrm / dawid. Solopreneur, ~10 repos in parallel. Prefers honesty about scope and pushback over deference.

---

## 1. The four files you need

1. **`substrate-design.md`** — the canonical English source, revision 10. 18 top-level sections, 1816 lines. This is what `substrate-design.html` must reflect.
2. **`substrate-design.html`** — the existing visual reference. Hand-crafted typesetting, magazine-quality. Currently behind by 3-4 revisions: missing §3.1 (runtime alignment), §4.3 (chain coordinator, rev10), §6.2.1 (three classifiers, rev8), §6.4 (precondition gate, rev9), §6.9 chain templates entirely (rev9), §6.10 close flow (rev9), and §10.2 is the old "Memory curator" section that rev10 entirely replaced. Preserve the styling, replace the content where needed.
3. **`channels.md`** — the source for `channels.html`. 640 lines, 15 sections. Already rev9-aligned with the §15 migration map.
4. **`substrate-design-it.md`** — Italian translation. Mentioned only so you know it exists. Out of scope for HTML work; an Italian HTML is a separate future task.

---

## 2. What the existing substrate-design.html does well — do not break these

The existing HTML is a hand-crafted magazine-style document. Its strengths, all to preserve:

- **Magazine-typeset reading experience**: Newsreader serif for body, JetBrains Mono for code/labels, generous whitespace, dropcap on the first paragraph of `.lead` sections.
- **Restrained single-accent palette**: cream paper (`#F5F2E9`) on dark ink (`#15130E`) with one accent (deep oxblood, `#7A1F1B`) used sparingly for links, section numbers, dropcap, dingbat, code-block left border.
- **Section numbering as a typographic element**: each `<h2>` carries a `<span class="num">NN</span>` rendered as small monospace accent-colored — `00`, `01`, … — *separate from* the title text. Numbers are zero-padded.
- **The kicker / title / subtitle / meta-grid masthead** at the top: a small uppercase letter-spaced kicker, a large italic serif title, an italic serif subtitle, then a 4-column monospace metadata grid (status / scope / audience / version).
- **The dingbat**: a small italic accent-colored ornament (`§`, `❦`, or similar) positioned absolute top-right of the masthead, rotated slightly. Subtle, one per document.
- **Code blocks as a separate object**: dark background (`#1A1813`), cream text, monospace, with a 3px oxblood left border — visually distinct from prose.
- **Tables as quiet objects**: thin rules in `--paper-shade`, monospace uppercase column headers with letter-spacing, hoverable rows.
- **Long-form readability constraints**: paragraphs max 68ch, list items max 65ch, page max 1080px centered with 80px top padding and 56px sides. Do not let lines run edge-to-edge.
- **The faint paper-grain background**: a 32×32 radial-gradient dot pattern at 2.5% opacity on the body. Subtle texture; do not remove.

If anything about your output makes the document feel like a generic technical doc instead of a magazine, you've drifted from the style.

---

## 3. The style guide — inline CSS, fonts, structural pattern

You can copy the existing HTML's `<head>` (lines 1-180 of `substrate-design.html`) verbatim for both files; both share the same stylesheet. The complete style follows.

### 3.1 Fonts (Google Fonts)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### 3.2 CSS variables (the palette)

```css
:root{
  --ink:#15130E;
  --paper:#F5F2E9;
  --paper-shade:#EBE7DB;
  --rule:#15130E;
  --muted:#6B675C;
  --faint:#A8A395;
  --accent:#7A1F1B;        /* deep oxblood, single accent */
  --serif:'Newsreader','Iowan Old Style','Charter','Georgia',serif;
  --mono:'JetBrains Mono','SF Mono','Consolas',monospace;

  /* event class palette — used by the dashboard section, matches dashboard colors */
  --c-life:#6B675C;        /* lifecycle */
  --c-mail:#3F2F86;        /* channel messages */
  --c-teth:#9A6A12;        /* tether hints */
  --c-coll:#8A2949;        /* collisions */
  --c-ctrc:#1A4D85;        /* contract state */
  --c-plan:#2C5F1F;        /* plan/seed events */
}
```

### 3.3 Body & paper

```css
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);font-family:var(--serif);font-size:17px;line-height:1.55}
body{
  background-image: radial-gradient(circle at 0 0, rgba(21,19,14,0.025) 1px, transparent 1px);
  background-size:32px 32px;
}
.page{max-width:1080px;margin:0 auto;padding:80px 56px 120px}
```

### 3.4 Code, links, tables

```css
.code, code, kbd, .mono{font-family:var(--mono);font-size:0.88em}
code{background:var(--paper-shade);padding:1px 5px;border-radius:2px}
pre{background:#1A1813;color:#E8E3D2;padding:18px 22px;overflow-x:auto;border-radius:0;
    border-left:3px solid var(--accent);font-family:var(--mono);font-size:13px;line-height:1.55}
pre code{background:transparent;padding:0;color:inherit}
a{color:var(--accent);text-decoration:none;border-bottom:1px solid var(--accent)}
a:hover{background:var(--accent);color:var(--paper)}
table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px}
th,td{border-bottom:1px solid var(--paper-shade);padding:8px 10px;text-align:left;vertical-align:top}
th{font-family:var(--mono);text-transform:uppercase;letter-spacing:0.1em;font-size:10px;
   color:var(--muted);border-bottom:1.5px solid var(--rule);font-weight:500}
tbody tr:hover{background:var(--paper-shade)}
```

### 3.5 Masthead — top-of-document block

```css
.masthead{border-bottom:2px solid var(--rule);padding-bottom:36px;margin-bottom:48px;position:relative}
.kicker{font-family:var(--mono);font-size:11px;letter-spacing:0.22em;text-transform:uppercase;
        color:var(--muted);margin-bottom:14px}
h1.title{font-family:var(--serif);font-weight:500;font-size:64px;line-height:1.02;
         letter-spacing:-0.025em;margin:0 0 18px;font-style:italic}
h1.title span{font-style:normal;font-weight:400}
.subtitle{font-family:var(--serif);font-size:21px;font-style:italic;color:var(--ink);
          font-weight:400;max-width:740px;line-height:1.4}
.meta{margin-top:32px;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;
      font-family:var(--mono);font-size:11px;letter-spacing:0.05em}
.meta dt{color:var(--muted);text-transform:uppercase;letter-spacing:0.15em;
         font-size:10px;margin-bottom:4px}
.meta dd{margin:0;color:var(--ink)}
.dingbat{position:absolute;top:-8px;right:0;font-family:var(--serif);font-style:italic;
         font-size:18px;color:var(--accent);transform:rotate(2deg)}
```

Masthead HTML pattern:

```html
<header class="masthead">
  <div class="dingbat">§</div>
  <div class="kicker">Design memo · revision 10 · 2026</div>
  <h1 class="title"><span>Substrate:</span> Containers, Issues, and the Seed Lifecycle</h1>
  <div class="subtitle">A runtime architecture for agent-native work. Replaces the orchestrator's tribal practices with named, observable, replayable entities.</div>
  <dl class="meta">
    <div><dt>Status</dt><dd>Draft, rev 10</dd></div>
    <div><dt>Scope</dt><dd>xtrm project</dd></div>
    <div><dt>Readers</dt><dd>Operator · Orchestrator · Coordinators</dd></div>
    <div><dt>Source</dt><dd>substrate-design.md</dd></div>
  </dl>
</header>
```

### 3.6 Sections — numbered, italic-serif headings

```css
section{margin:64px 0;scroll-margin-top:24px}
section > h2{font-family:var(--serif);font-style:italic;font-weight:500;font-size:32px;
             letter-spacing:-0.01em;margin:0 0 24px;padding-bottom:8px;
             border-bottom:1px solid var(--rule);
             display:flex;align-items:baseline;gap:14px}
section > h2 .num{font-family:var(--mono);font-style:normal;font-size:13px;
                  color:var(--accent);letter-spacing:0.1em;flex-shrink:0;width:38px}
h3{font-family:var(--serif);font-weight:500;font-size:22px;margin:36px 0 12px;
   letter-spacing:-0.005em}
h4{font-family:var(--mono);text-transform:uppercase;letter-spacing:0.15em;
   font-size:11px;color:var(--accent);margin:24px 0 10px;font-weight:600}
p{margin:0 0 16px;max-width:68ch}
ul,ol{padding-left:22px}
li{margin-bottom:6px;max-width:65ch}
strong{font-weight:600}
em{font-style:italic}
```

Section HTML pattern (numbers zero-padded, `00` is allowed for layout/intro):

```html
<section id="lifecycle">
  <h2><span class="num">03</span>The container lifecycle</h2>
  <p>...</p>
  <h3>3.1 Runtime alignment</h3>
  <p>...</p>
</section>
```

### 3.7 Dropcap (first-paragraph drop letter on `.lead` sections)

```css
section.lead p:first-of-type::first-letter{
  font-family:var(--serif); float:left;
  font-size:64px; line-height:0.85;
  padding:8px 10px 0 0;
  font-weight:500; color:var(--accent);
  font-style:italic;
}
```

Apply `class="lead"` only to the first content section (the "Problem" intro for substrate, the "Problem" intro for channels). One per document. The dropcap is a magazine cue — don't sprinkle it.

### 3.8 The page wrapper

```html
<body>
  <div class="page">
    <header class="masthead">...</header>
    <section id="...">...</section>
    <section id="...">...</section>
    ...
  </div>
</body>
```

---

## 4. Deliverable 1 — substrate-design.html rev6/7 → rev10

The existing HTML is preserved as visual reference. **Strategy: do not patch in place; rebuild the body content from `substrate-design.md` rev10, keeping the existing `<head>` and `<header class="masthead">` (updating only the rev number).** Patching a rev6/7 HTML to rev10 piecemeal produces internally incoherent prose with dangling forward-references.

### Section mapping (rev10 markdown → HTML section numbers)

The markdown sections map to HTML sections roughly as follows. Use these as `<h2><span class="num">NN</span>Title</h2>`:

| HTML num | Title | Source in `substrate-design.md` |
|---|---|---|
| `00` | Project layout | top of doc (preamble + "Layout") |
| `01` | Problem | §1 |
| `02` | Conceptual model | §2 (and all subsections §2.1–§2.6) |
| `03` | The container lifecycle | §3 (and §3.1 runtime alignment as `<h3>`) |
| `04` | Container kinds | §4 (and §4.1 seed, §4.2 node, **§4.3 chain coordinator (NEW)**, §4.4 merge) |
| `05` | Seed: planning in depth | §5 (all subsections) |
| `06` | The new issue system | §6 (large — §6.1 through §6.10) |
| `07` | Channels (recap) | §7 |
| `08` | Tether | §8 |
| `09` | Collision matrix | §9 |
| `10` | Memory | §10 (note: was "Memory curator", rev10 retitled "Memory"; **§10.2 is entirely rewritten** — old "Memory curator" section is gone, replaced by "Memory access is a capability, not a role") |
| `11` | CLI surface | §11 |
| `12` | Dashboard | §12 |
| `13` | Data model / storage | §13 |
| `14` | Open questions | §14 + §14.1 questions-for-next-agent |
| `15` | Sequencing | §15 |
| `16` | Summary | §16 |
| `17` | API surface | §17 |

### What's new since the existing HTML (priority order)

**Highest priority — entirely missing, must be added:**

1. **§4.3 Chain coordinator** (rev10). Net-new section between §4.2 (Node coordinator) and §4.4 (Merge). Four roles: entry gate, borderline judge, hygiene coordinator via pulse, close-time judge. Model selection per chain_template. Lifecycle bounded. Source in `substrate-design.md` lines 199-218.
2. **§6.9 Chain templates and composition** (rev9). Large — §6.9.1 through §6.9.10. The whole "workflow → chain_template" rework: two-layer templates, composition in three moments, worktree lease, two-axis git, deliberative issue types, six template archetypes. ~600 lines of source.
3. **§6.10 Closing an issue — close is a derivation, not an imperative** (rev9, with rev10 coordinator addition). Close hierarchy, transactional close at merge, the new paragraph about the chain coordinator's close-time pass. ~150 lines of source.
4. **§10.2 Memory access is a capability, not a role** (rev10). Complete rewrite of what was "Memory curator". Eliminates the dedicated memory-curator role; planner queries at seed-time, specialist at run-time, chain coordinator distills at close. Source lines 1210-1220.
5. **§6.4 Precondition gate** (rev9). Distinct from §5.10 failure recovery — "we should not have started" vs "we started and stumbled". Refuses with the structured envelope.
6. **§6.2.1 Three classifiers — class/type/role** (rev8). Stored not derived; gate-ness structurally enforced.

**Medium priority — additions/changes to existing sections:**

7. **§3.1 Runtime alignment** (rev9, with rev10 chain refinement). Event-driven advancement on `turn_end`/pulse/`sb` command; the `verdict: ready` from chain coordinator as the dispatch precondition for step-1. Render as `<h3>` inside the §3 lifecycle section.
8. **§5.10 Failure recovery — generic closing judge** (rev10 update). The "closing judge" language is generic now: chain coordinator for chain, node coordinator for node, operator for seed escalated.
9. **§6.7 Issue relationships** — the nine-relationship model (rev8), with `informs`/`spawned_by` recorded as future splits.
10. **§13.3 Schema** — additions: `autonomy_json` extended to chain (max_inserts, allowed_insertion_roles, max_followup_proposals, escalate_when), `chain_coordinator_model`, `resolved_chain_json`, `worktree_lease_json`, `fork_base`.
11. **Status header + changelog** — update masthead `Status` metadata to "Draft, rev 10". The doc's status paragraph (just under the title) names the rev10 changes; render this as the `.subtitle` text or as a small section beneath the masthead.

**Low priority — likely already correct in the existing HTML but verify:**

- §1 Problem, §2 Conceptual model, §3 lifecycle (the upper part), §4.1/§4.2, §5 seed, §8 tether, §9 collisions, §11 CLI, §12 dashboard, §13.1/§13.2.

### Tables in §10 and §6 — render as styled tables

The markdown has several reference tables that benefit from the `<table>` styling: the §10.1 three-lens memory table, the §6.7 nine-relationships table, the §6.9.10 six-templates table, the §6.2.1 class/type/role table. Render these as proper HTML tables, not as `<ul>`.

### Code blocks

Several sections have JSON / DDL / pseudocode in fenced code blocks. Render as `<pre><code>` with the dark theme. Notable code blocks: §5.7 plan example, §5.10 recovery policy, §6.1 issue schema, §6.9.5 composition example, §13.3 full schema DDL.

---

## 5. Deliverable 2 — channels.html (new)

Build `channels.html` from `channels.md` using the same stylesheet and the same masthead/section pattern.

### Masthead

```html
<header class="masthead">
  <div class="dingbat">¶</div>
  <div class="kicker">Design memo · v0 → v3 · 2026</div>
  <h1 class="title"><span>Channels:</span> A Reusable Inter-Specialist Communication Layer</h1>
  <div class="subtitle">An append-only, subscribable, multi-party message stream per container. Rev-9 aligned with substrate; sequenced v0 → v3.</div>
  <dl class="meta">
    <div><dt>Status</dt><dd>Design draft, rev-9 aligned</dd></div>
    <div><dt>Scope</dt><dd>Inter-specialist comms</dd></div>
    <div><dt>Relationship</dt><dd>Subordinate to substrate</dd></div>
    <div><dt>Source</dt><dd>channels.md</dd></div>
  </dl>
</header>
```

### Section mapping

| HTML num | Title | Source in `channels.md` |
|---|---|---|
| `01` | Problem | §1 |
| `02` | Goals | §2 |
| `03` | Non-goals | §3 |
| `04` | Concepts | §4 (table renders well) |
| `05` | Architecture | §5 (and §5.1 storage, §5.1.1 store-now-and-later bridge, §5.2 lifecycle, §5.3 message kinds, §5.4 subscription, §5.5 runtime integration, §5.6 topologies, §5.7 stop conditions) |
| `06` | Spec schema | §6 |
| `07` | Node config | §7 |
| `08` | CLI surface | §8 |
| `09` | Self-managed node flow | §9 |
| `10` | Permission & safety | §10 (and §10.1 authority decision, §10.2 error envelope) |
| `11` | Sequenced implementation v0→v3 | §11 |
| `12` | Open questions | §12 |
| `13` | Risks & mitigations | §13 |
| `14` | Success criteria per version | §14 |
| `15` | Substrate relationship & migration map | §15 (and §15.1–§15.5) |

### Render hints specific to channels.html

- **The §5.3 message-kinds table** is the visual centerpiece — render as a proper styled `<table>` with all columns visible.
- **The §15.4 concept-by-concept migration map** is a 13-row 3-column table — render carefully, this is the document's payoff.
- **The §5.1 SQL DDL** should be a `<pre><code>` block, dark theme.
- **The v0 / v0.5 / v1 / v2 / v3 sub-sections** in §11 are conceptually separate stages — render each with `<h3>` and consider a small versioned accent label (use the `--accent` color, monospace) to make the staging visible at a glance.
- **The §15.5 "Settled / Owed" bifurcation** at the end of §15 should be visually distinct — perhaps two side-by-side blocks or a clear `<h4>` separation. This is where the doc tells you what it owes substrate; it should not be lost in prose flow.

---

## 6. Method recommendations

- **Build from markdown, not by patching HTML.** Both files are likely cleaner to write fresh from the markdown source than to surgery the existing HTML. The CSS is reusable verbatim; the body content is the work.
- **A converter is OK but inspect the output.** A pandoc-style markdown→HTML pass gets you 80% there; the remaining 20% (masthead, section numbers as `<span class="num">`, table rendering, code block styling, dropcap class on the right section, paragraph break-up) needs hand tweaks.
- **Verify against `substrate-design.md` for content fidelity.** Do not summarize, do not skip subsections. The markdown is the canonical content.
- **One single-file HTML per deliverable.** All CSS inline in `<style>`, no external assets except the Google Fonts link. Both files should open in any browser without dependencies.
- **Hover-able section anchors.** Each `<h2>` and `<h3>` should have an `id` matching the section slug (e.g., `id="lifecycle"`, `id="chain-coordinator"`) so cross-references can link.

---

## 7. Quality bar — what "done" looks like

- `substrate-design.html` reads end-to-end as a magazine-typeset rev10 design memo. No dangling forward-references. The chain coordinator §4.3 is present and complete. §6.9 chain templates is present in full. §6.10 close flow is present. §10.2 is the new "Memory access is a capability" content, not the old "Memory curator" content. Status meta shows "rev 10".
- `channels.html` is a parallel artifact in the same style. The §15 migration map renders as the visual payoff at the end. The v0→v3 sequencing in §11 is visually scannable.
- Both render correctly at 1080px desktop and degrade gracefully at narrower widths (the page-wrapper has the max-width; line-length constraints already protect readability).
- Both validate as well-formed HTML. No console errors. Fonts load.

---

## 8. Open coordination notes

- **The operator (Jaggerxtrm/dawid) will likely review by reading the HTML side-by-side with the markdown.** Match the markdown semantics carefully; if you find a discrepancy where the markdown is unclear, ask before guessing.
- **Style decisions you may make on your own:** which dingbat character to use per document, the exact wording of `kicker` and `subtitle` if the existing isn't ideal, where to place a `.lead` dropcap (one per document, the first content section).
- **Style decisions to NOT make on your own:** palette changes, font swaps, removing the paper-grain background, restructuring the masthead grid, changing section-number style. These are the document's identity.

You have everything you need. Build.