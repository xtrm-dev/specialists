"""Open-bead scan: duplicate candidates + /planning contract quality, via Jev (bead unitAI-gexnv).

  BOARD=market-data uv run --with typesafe-sdk python scan.py build   # candidates, no key needed
  BOARD=market-data uv run --with typesafe-sdk python scan.py run     # Jev calls, resumable
  BOARD=market-data uv run --with typesafe-sdk python scan.py report  # prints + writes scan-report.md
"""
import json, math, re, sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

from dupes import HERE, NOISE, check_mask, mask, remember, questions as dupe_questions, view

SECTIONS = {  # wording from planning/references/contracts.md
    "PROBLEM": "why this work exists: the defect, missing capability, or decision pressure",
    "SUCCESS": "observable conditions that mean the work is complete",
    "SCOPE": "the owned files, systems, or behaviors, specific enough to prevent accidental expansion",
    "NON_GOALS": "nearby work that is deliberately excluded",
    "CONSTRAINTS": "compatibility, safety, ownership, architecture, rollout, or implementation invariants",
    "VALIDATION": "the exact checks or evidence expected, including integrated behavior where it matters",
    "OUTPUT": "the durable result the worker must leave, such as code, a report, notes, or an artifact",
}
OPEN = lambda r: r["status"] != "closed"
S = lambda i: i.split("-")[-1] if i.count("-") > 1 else i


def load_all():
    rows = list(map(json.loads, open(HERE / "bd.jsonl")))
    remember([r["id"] for r in rows])
    return {r["id"]: r for r in rows if not NOISE.search(r.get("title") or "")}


def contract_text(r):
    return "\n\n".join(x for x in (r.get("description"), r.get("design"), r.get("acceptance_criteria")) if x)


def headers(r):
    t = contract_text(r)
    return [s for s in SECTIONS if re.search(r"(^|\n)\s*(#+\s*)?\**" + s.replace("_", "[_ ]") + r"\**\s*[:\n]", t, re.I)]


def label(r):
    ls = r.get("labels") or []
    return "ready" if "contract:ready" in ls else "draft" if "contract:draft" in ls else "none"


# ---------- candidates ----------

def tfidf(by):
    docs = {i: re.findall(r"[a-z][a-z0-9_]{2,}", (r["title"] + " ") .lower() * 3 + (r.get("description") or "")[:3000].lower())
            for i, r in by.items()}
    df = Counter(t for toks in docs.values() for t in set(toks))
    n = len(docs)
    vec = {}
    for i, toks in docs.items():
        v = {t: c * math.log(n / df[t]) for t, c in Counter(toks).items() if df[t] < 0.3 * n}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1
        vec[i] = {t: x / norm for t, x in v.items()}
    return vec


def cos(a, b):
    if len(a) > len(b): a, b = b, a
    return sum(x * b.get(t, 0) for t, x in a.items())


def build():
    by = load_all()
    vec = tfidf(by)
    links = {frozenset((d.get("issue_id"), d.get("depends_on_id"))): d.get("type")
             for r in by.values() for d in r.get("dependencies") or []}
    family = lambda a, b: a.startswith(b + ".") or b.startswith(a + ".")
    opens = [i for i in by if OPEN(by[i])]
    pairs = {}
    for a in opens:
        sims = sorted(((cos(vec[a], vec[b]), b) for b in by if b != a and not family(a, b)), reverse=True)
        picks = [x for x in sims if OPEN(by[x[1]])][:3] + [x for x in sims if not OPEN(by[x[1]])][:2]
        for s, b in picks:
            # ponytail: fixed 0.15 cosine floor, tune if the scan misses paraphrased dupes
            k = frozenset((a, b))
            if s < 0.15 or links.get(k) == "parent-child": continue
            pairs[k] = {"a": min(k), "b": max(k), "cos": round(s, 3), "link": links.get(k),
                        "kind": "open-open" if OPEN(by[b]) else "open-closed"}
    with open(HERE / "scan-pairs.jsonl", "w") as f:
        for p in pairs.values(): f.write(json.dumps(p) + "\n")
    print(f"open beads: {len(opens)}  dupe pairs: {len(pairs)} {Counter(p['kind'] for p in pairs.values())}")
    print(f"already linked: {Counter(p['link'] for p in pairs.values() if p['link'])}")
    print(f"total requests: {len(pairs) + len(opens)}")


# ---------- Jev ----------

def quality_questions():
    from typesafe_sdk import Choice, Noul, Score
    qs = {
        s.lower(): Score(
            instructions=f"How well does `ticket` state its {s}: {desc}? Judge the content, not whether a heading exists.",
            criteria=[f"Missing: nothing in the ticket states {desc}.",
                      f"Partial: {desc} is implied, vague, or incomplete; a worker would have to guess or ask.",
                      f"Complete: {desc} is explicit and specific enough to act on without asking."])
        for s, desc in SECTIONS.items()}
    qs["executable"] = Noul(instructions=(
        "A fresh, competent engineer with repository access, but without any chat history, "
        "could execute `ticket` correctly from its text alone."))
    qs["readiness"] = Choice(
        instructions="What kind of work item is `ticket`?",
        criteria={
            "ready": "A specified task: problem, expected result, and boundaries are clear enough to start work.",
            "draft": "A real problem worth doing, but scope or approach still needs exploration before work starts.",
            "not_a_contract": "Notes, a log, a placeholder, or a title with too little text to act on.",
            "container": "An epic or tracker that coordinates other tickets rather than specifying one change.",
        })
    return qs


def ticket(r):
    return {"title": mask(r["title"]), "type": r.get("issue_type"),
            "labels": [l for l in r.get("labels") or [] if not l.startswith("contract:")],  # hide the answer
            "text": mask(contract_text(r))[:6000]}


def cached(path, key):
    return {key(j) for j in map(json.loads, open(path))} if path.exists() else set()


def run():
    from typesafe_sdk import TypeSafeClient
    by = load_all()
    check_mask(by)
    client = TypeSafeClient(model="jev-latest")
    dq, qq = dupe_questions(), quality_questions()

    out = HERE / "scan-dupes.jsonl"
    done = cached(out, lambda j: (j["a"], j["b"]))
    todo = [p for p in map(json.loads, open(HERE / "scan-pairs.jsonl")) if (p["a"], p["b"]) not in done]

    def dupe(p):
        r = client.system_one(state={"issue_a": view(by[p["a"]]), "issue_b": view(by[p["b"]])}, questions=dq)
        c = r.choices["relation"]
        return {**p, "noul": r.nouls["redundant"].noul, "choice": c.choice, "probs": dict(c.probabilities)}

    with ThreadPoolExecutor(8) as ex, open(out, "a") as f:
        for i, res in enumerate(ex.map(dupe, todo), 1):
            f.write(json.dumps(res) + "\n"); f.flush()
            print(f"[dupes {i}/{len(todo)}] P={res['noul']:.2f} {res['choice']:16} {res['kind']:11} "
                  f"{S(res['a'])} <-> {S(res['b'])}", flush=True)

    out = HERE / "scan-quality.jsonl"
    done = cached(out, lambda j: j["id"])
    todo = [i for i in by if OPEN(by[i]) and i not in done]

    def quality(i):
        r = client.system_one(state={"ticket": ticket(by[i])}, questions=qq)
        return {"id": i, "label": label(by[i]), "headers": headers(by[i]), "type": by[i].get("issue_type"),
                "executable": r.nouls["executable"].noul, "readiness": r.choices["readiness"].choice,
                "sections": {s.lower(): r.scores[s.lower()].score for s in SECTIONS}}

    with ThreadPoolExecutor(8) as ex, open(out, "a") as f:
        for i, res in enumerate(ex.map(quality, todo), 1):
            f.write(json.dumps(res) + "\n"); f.flush()
            print(f"[quality {i}/{len(todo)}] exec={res['executable']:.2f} {res['readiness']:14} "
                  f"label={res['label']:5} headers={len(res['headers'])}/7 {S(res['id'])}", flush=True)


# ---------- report ----------

def load_rows(name):
    p = HERE / name
    return [json.loads(l) for l in open(p)] if p.exists() else []


def report():
    by = load_all()
    L = []
    say = L.append
    t = lambda i, n=70: f"`{S(i)}` [{by[i]['status']}] {by[i]['title'][:n]}"

    ds = load_rows("scan-dupes.jsonl")
    say(f"# Open-bead scan: {HERE.name}\n\n## Duplicate candidates ({len(ds)} pairs checked)\n")
    say("P = Jev probability that finishing one makes the other unnecessary. Check each pair by hand before closing anything.\n")
    for kind, head in (("open-open", "Open ↔ open: merge candidates"), ("open-closed", "Open ↔ closed: possibly already done")):
        rows = sorted((d for d in ds if d["kind"] == kind and d["noul"] >= 0.5), key=lambda d: -d["noul"])
        say(f"\n### {head} (P ≥ 0.5: {len(rows)})\n")
        for d in rows[:25]:
            link = f" · already linked: {d['link']}" if d["link"] else ""
            say(f"- **P={d['noul']:.2f}** {d['choice']} · cos {d['cos']}{link}\n  - {t(d['a'])}\n  - {t(d['b'])}")

    qs = load_rows("scan-quality.jsonl")
    sec = [s.lower() for s in SECTIONS]
    weakest = lambda q: ", ".join(f"{s} {q['sections'][s]:.1f}" for s in sorted(sec, key=lambda s: q["sections"][s])[:3])
    say(f"\n## Contract quality ({len(qs)} open beads)\n")
    say("Section scores run 0 (missing) to 2 (complete). `executable` = P(a fresh worker could execute it from the text alone).\n")
    say("| label | n | mean executable | " + " | ".join(sec) + " |\n|---|---|---|" + "---|" * len(sec))
    for lab in ("ready", "draft", "none"):
        g = [q for q in qs if q["label"] == lab]
        if g:
            say(f"| {lab} | {len(g)} | {sum(q['executable'] for q in g) / len(g):.2f} | "
                + " | ".join(f"{sum(q['sections'][s] for q in g) / len(g):.2f}" for s in sec) + " |")
    say(f"\nJev readiness vs board label: {dict(Counter((q['label'], q['readiness']) for q in qs))}\n")

    groups = [
        ("Labeled contract:ready but weak (executable < 0.5)", lambda q: q["label"] == "ready" and q["executable"] < 0.5, lambda q: q["executable"]),
        ("All 7 headings present, content weak (executable < 0.5)", lambda q: len(q["headers"]) == 7 and q["executable"] < 0.5, lambda q: q["executable"]),
        ("Promotion candidates: contract:draft but executable ≥ 0.7", lambda q: q["label"] == "draft" and q["executable"] >= 0.7, lambda q: -q["executable"]),
        ("No headings but executable ≥ 0.7 (fine as written)", lambda q: not q["headers"] and q["executable"] >= 0.7, lambda q: -q["executable"]),
        ("Not dispatchable: Jev says not_a_contract", lambda q: q["readiness"] == "not_a_contract" and q["type"] != "epic", lambda q: q["executable"]),
    ]
    for head, pred, key in groups:
        g = sorted(filter(pred, qs), key=key)
        say(f"\n### {head}: {len(g)}\n")
        for q in g[:15]:
            say(f"- exec {q['executable']:.2f} · {q['readiness']} · headings {len(q['headers'])}/7 · weakest: {weakest(q)}\n  - {t(q['id'])}")

    text = "\n".join(L)
    (HERE / "scan-report.md").write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    {"build": build, "run": run, "report": report}[sys.argv[1]]()
