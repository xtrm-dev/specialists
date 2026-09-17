"""Jev duplicate-detection probe on a bd export (XTRM-99, bead unitAI-gexnv).

  bd export -o bd.jsonl
  uv run --with typesafe-sdk python dupes.py build   # pairs.jsonl + baseline (no key needed)
  uv run --with typesafe-sdk python dupes.py run     # calls Jev, caches to answers.jsonl
  uv run --with typesafe-sdk python dupes.py report  # AUC / Brier / ECE, Jev vs baseline
"""
import json, os, random, re, sys, difflib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(os.environ.get("BOARD", Path(__file__).parent))  # folder holding bd.jsonl
ID = r"(?:[a-z][a-z0-9]*(?:-[a-z]+)*-)?[a-z0-9]{3,6}(?:\.\d+)*"  # full or bare (t80he.18) ids
REDUNDANT = re.compile(
    r"(duplicate|dupe|superseded|replaced by|folded into|merged into|consolidated into|covered by|subsumed by)"
    r"[^.;\n]{0,60}?\b(" + ID + r")\b", re.I)


NOISE = re.compile(r"smoke|session handoff|\[bench:|test prompt|probe\b|sandbox|dummy", re.I)


KNOWN = set()  # ids to mask; filled by load()


def remember(ids):
    # full ids, plus bare suffixes that contain a digit (t80he.18, k1q) so plain words are never masked
    KNOWN.update(ids)
    KNOWN.update(s for i in ids for s in [i.rsplit("-", 1)[-1]] if re.search(r"\d", s))


SECRET_ASSIGN = re.compile(r"(?i)\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)(\\?[\"']?\s*[:=]\s*\\?[\"']?)([^\s\"'\\,}]{8,})")
SECRET_BARE = re.compile(r"\b(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{60,}|(?:AKIA|ASIA)[A-Z0-9]{16}|[A-Za-z0-9/+]{40,}={0,2})\b")


def redact(s):
    # Never send credentials to an external API (MMD-585 carried live R2 keys in its contract text).
    s = SECRET_ASSIGN.sub(lambda m: f"{m.group(1)}{m.group(2)}<redacted>", s or "")
    return SECRET_BARE.sub("<redacted>", s)


def mask(s):
    return re.sub(r"[a-z0-9][a-z0-9-]*[a-z0-9](?:\.\d+)*", lambda m: "<issue>" if m.group(0) in KNOWN else m.group(0), redact(s))


def check_mask(by):
    """Abort before spending API calls if masking eats plain words (the 2026-09-17 bug)."""
    text = " ".join((r["title"] + " " + (r.get("description") or "")[:500]) for r in by.values())
    words = re.findall(r"\b[a-z]{3,}\b", text)
    masked = re.findall(r"\b[a-z]{3,}\b", mask(text).replace("<issue>", " "))
    assert len(masked) > 0.98 * len(words), f"mask removed {len(words) - len(masked)}/{len(words)} plain words"


def load():
    rows = [json.loads(l) for l in open(HERE / "bd.jsonl")]
    remember([r["id"] for r in rows])
    return {r["id"]: r for r in rows if not NOISE.search(r.get("title") or "")}


def positives(by):
    pairs = {}
    prefix = Counter(i.split(".")[0].rsplit("-", 1)[0] for i in by).most_common(1)[0][0]
    for r in by.values():
        for m in REDUNDANT.finditer(r.get("close_reason") or ""):
            t = m.group(2) if m.group(2) in by else f"{prefix}-{m.group(2)}"  # bare id -> board prefix
            if t in by and t != r["id"]:
                pairs[frozenset((r["id"], t))] = m.group(1).split()[0].lower()
        for d in r.get("dependencies") or []:
            if d.get("type") == "supersedes" and {d.get("issue_id"), d.get("depends_on_id")} <= by.keys():
                pairs[frozenset((d["issue_id"], d["depends_on_id"]))] = "supersedes-dep"
    return pairs


def words(r):
    return set(re.findall(r"[a-z0-9]{3,}", (r["title"] + " " + (r.get("description") or "")[:800]).lower()))


def sim(a, b):
    """Deterministic baseline: title ratio + body token Jaccard."""
    wa, wb = words(a), words(b)
    jac = len(wa & wb) / max(1, len(wa | wb))
    return 0.5 * difflib.SequenceMatcher(None, a["title"].lower(), b["title"].lower()).ratio() + 0.5 * jac


def build():
    random.seed(7)
    by = load()
    pos = positives(by)
    linked = {frozenset((d.get("issue_id"), d.get("depends_on_id")))
              for r in by.values() for d in r.get("dependencies") or []}
    neg = {}
    # relates-to: related but (by label) not redundant
    rel = [frozenset((d["issue_id"], d["depends_on_id"])) for r in by.values()
           for d in r.get("dependencies") or [] if d.get("type") == "relates-to"
           and {d["issue_id"], d["depends_on_id"]} <= by.keys()]
    for p in random.sample(rel, 60): neg.setdefault(p, "relates-to")
    # siblings under one parent: same area, distinct work
    kids = {}
    for i in by:
        if "." in i: kids.setdefault(i.rsplit(".", 1)[0], []).append(i)
    sib = [frozenset(random.sample(v, 2)) for v in kids.values() if len(v) >= 2]
    for p in random.sample(sib, min(50, len(sib))): neg.setdefault(p, "sibling")
    # lexically similar, unlinked: hardest negatives (may hide unlabeled dupes)
    ids = list(by)
    cand = {frozenset(random.sample(ids, 2)) for _ in range(60000)}
    same_title = lambda c: len({by[x]["title"].strip().lower() for x in c}) == 1
    # ponytail: identical titles are unlabeled, not negatives (run 1: 39/49 were real dupes)
    cand = sorted((c for c in cand if c not in linked and c not in pos and not same_title(c)),
                  key=lambda c: -sim(*(by[x] for x in c)))
    for p in cand[:50]: neg.setdefault(p, "similar-unlinked")
    for p in random.sample(cand[5000:], 20): neg.setdefault(p, "random")
    out = [{"a": sorted(p)[0], "b": sorted(p)[1], "label": 1, "kind": k} for p, k in pos.items()]
    out += [{"a": sorted(p)[0], "b": sorted(p)[1], "label": 0, "kind": k} for p, k in neg.items() if p not in pos]
    for o in out: o["baseline"] = round(sim(by[o["a"]], by[o["b"]]), 4)
    with open(HERE / "pairs.jsonl", "w") as f:
        for o in out: f.write(json.dumps(o) + "\n")
    print(len(out), Counter(o["kind"] for o in out))
    ys = [o["label"] for o in out]
    print(f"baseline AUC (all pairs) = {auc(ys, [o['baseline'] for o in out]):.3f}")


def view(r):
    # Strip close_reason/notes/status (they leak the label) and mask issue ids.
    return {"title": mask(r["title"]), "type": r.get("issue_type"),
            "created": (r.get("created_at") or "")[:10], "description": mask(r.get("description"))[:2000]}


def questions():
    from typesafe_sdk import Choice, Noul
    return {
        "redundant": Noul(instructions=(
            "`issue_a` and `issue_b` are two tickets from the same software project tracker. "
            "Completing one of them would make the other unnecessary: they ask for the same work, "
            "or one fully covers or replaces the other.")),
        "relation": Choice(
            instructions="What is the relationship between the work described in `issue_a` and `issue_b`?",
            criteria={
                "same_work": "Both ask for essentially the same change or investigation.",
                "one_covers_other": "One is a broader or later version that fully includes the other's work.",
                "related_distinct": "Same area or feature, but each requires separate work.",
                "unrelated": "Different areas; doing one says nothing about the other.",
            }),
    }


def run():
    from typesafe_sdk import TypeSafeClient
    by, qs = load(), questions()
    check_mask(by)
    ans = HERE / "answers.jsonl"
    done = {(j["a"], j["b"]) for j in map(json.loads, open(ans))} if ans.exists() else set()
    todo = [p for p in map(json.loads, open(HERE / "pairs.jsonl")) if (p["a"], p["b"]) not in done]
    print("todo", len(todo))
    client = TypeSafeClient(model="jev-latest")

    def one(p):
        # ponytail: pair order is sorted-id, not randomized; add a swapped rerun if order bias shows up
        r = client.system_one(state={"issue_a": view(by[p["a"]]), "issue_b": view(by[p["b"]])}, questions=qs)
        c = r.choices["relation"]
        return {**p, "noul": r.nouls["redundant"].noul, "choice": c.choice,
                "probs": dict(c.probabilities), "conf": c.confidence}

    with ThreadPoolExecutor(8) as ex, open(ans, "a") as f:
        for i, res in enumerate(ex.map(one, todo), 1):
            f.write(json.dumps(res) + "\n"); f.flush()
            print(f"[{i}/{len(todo)}] label={res['label']} P={res['noul']:.2f} {res['choice']:16} {res['kind']}", flush=True)


def auc(ys, ss):
    pos = [s for y, s in zip(ys, ss) if y]; neg = [s for y, s in zip(ys, ss) if not y]
    return sum((p > n) + 0.5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg))


def report():
    rs = [json.loads(l) for l in open(HERE / "answers.jsonl")]
    y = [r["label"] for r in rs]
    ch = [r["probs"].get("same_work", 0) + r["probs"].get("one_covers_other", 0) for r in rs]
    print(f"n={len(rs)} pos={sum(y)}")
    print(f"AUC  baseline={auc(y, [r['baseline'] for r in rs]):.3f}  jev_noul={auc(y, [r['noul'] for r in rs]):.3f}  jev_choice={auc(y, ch):.3f}")
    for name, p in (("noul", [r["noul"] for r in rs]), ("choice", ch)):
        brier = sum((a - b) ** 2 for a, b in zip(p, y)) / len(y)
        bins = [[(pi, yi) for pi, yi in zip(p, y) if min(int(pi * 10), 9) == k] for k in range(10)]
        ece = sum(len(b) * abs(sum(x for x, _ in b) / len(b) - sum(t for _, t in b) / len(b)) for b in bins if b) / len(y)
        tp = sum(pi >= .5 and yi for pi, yi in zip(p, y)); fp = sum(pi >= .5 and not yi for pi, yi in zip(p, y))
        print(f"{name:6} brier={brier:.3f} ece={ece:.3f} @0.5 precision={tp / max(1, tp + fp):.2f} recall={tp / sum(y):.2f}")
    print("\nmean P(redundant) by kind:")
    for k in sorted({r["kind"] for r in rs}):
        v = [r["noul"] for r in rs if r["kind"] == k]
        print(f"  {k:18} n={len(v):3} {sum(v) / len(v):.2f}")
    print("\nconfident false positives (possible unlabeled dupes — check by hand):")
    for r in sorted((r for r in rs if not r["label"]), key=lambda r: -r["noul"])[:8]:
        print(f"  {r['noul']:.2f} {r['kind']:16} {r['a']} <-> {r['b']}")
    print("missed positives:")
    for r in sorted((r for r in rs if r["label"]), key=lambda r: r["noul"])[:5]:
        print(f"  {r['noul']:.2f} {r['kind']:16} {r['a']} <-> {r['b']}")


if __name__ == "__main__":
    {"build": build, "run": run, "report": report}[sys.argv[1]]()
