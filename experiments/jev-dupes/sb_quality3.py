"""v3 contract quality across boards (bead unitAI-gexnv). Read-only: never calls `sb issue attest`.

Changes from v2 (blind check, 16 contracts): Jev missed stale references, open decisions and self-declared
blocks, penalized well-specified live/operator work, and validation_proves_success had no signal.

  python3 sb_prep.py                                                  # scratch imports -> <board>/sb-open.json
  uv run --with typesafe-sdk python sb_quality3.py run [board ...]    # Jev, resumable
  python3 sb_quality3.py report [board ...]                           # + agreement with <board>/labels.jsonl
"""
import json, re, subprocess, sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from sb_prep import ATTEST_ONLY, BOARDS, HERE

STANDARD = {  # planning/references/contracts.md
    "purpose": "A ready contract lets a fresh competent worker with repository access execute the work without the chat "
               "transcript. Missing information belongs in the contract or a referenced artifact.",
    "problem": "Why this exists: the defect, missing capability, or decision pressure, in real prose.",
    "success": "Observable conditions that mean the work is complete.",
    "scope": "Owned files/systems/behaviors, specific enough to prevent accidental expansion.",
    "nonGoals": "Nearby work deliberately excluded.",
    "constraints": "Compatibility, safety, ownership, architecture, rollout, or implementation invariants.",
    "validation": "Exact checks/evidence expected, including integrated behavior where it matters.",
    "output": "Durable result the worker must leave.",
}


def candidates(board):
    return [d for d in json.load(open(HERE / board / "sb-open.json")) if d["reasons"] == [ATTEST_ONLY] and d["kind"] != "epic"]


# ---------- deterministic evidence (never sent to Jev) ----------

def repo_index(repo):
    files = subprocess.run(["git", "-C", str(repo), "ls-files"], capture_output=True, text=True).stdout.split()
    return set(files), {f.rsplit("/", 1)[-1] for f in files}


def symbols(text):
    # backticked code-like tokens: snake_case, CamelCase::path, calls. Plain words are skipped.
    toks = re.findall(r"`([^`\s]{4,80})`", text)
    out = set()
    for t in toks:
        t = t.rstrip("()").split("(")[0]
        if re.fullmatch(r"[A-Za-z_][\w]*(?:(?:::|\.)[A-Za-z_]\w*)*", t) and ("_" in t or "::" in t or re.search(r"[a-z][A-Z]", t)):
            out.add(t.split("::")[-1].split(".")[-1])
    return out


def evidence(boards):
    """Per issue: symbols named in PROBLEM (claims about current code) that do not occur in the repo."""
    ev = {}
    for b in boards:
        repo, (full, base) = BOARDS[b], repo_index(BOARDS[b])
        issues = candidates(b)
        syms = {d["humanRef"]: symbols(d["contract"].get("problem") or "") for d in issues}
        allsyms = sorted(set().union(*syms.values())) if syms else []
        found = set()
        if allsyms:
            pat = HERE / b / ".symbols"; pat.write_text("\n".join(allsyms))
            g = subprocess.run(["git", "-C", str(repo), "grep", "-o", "-h", "-w", "-F", "-f", str(pat)], capture_output=True, text=True)
            found = set(g.stdout.split())
        for d in issues:
            text = json.dumps(d["contract"])
            cited = set(re.findall(r"[\w.-]+(?:/[\w.-]+)*\.(?:py|rs|ts|tsx|md|yml|yaml|toml|json|sh|sql)\b", text))
            ev[(b, d["humanRef"])] = {
                "problem_symbols": len(syms[d["humanRef"]]),
                "problem_symbols_missing": sorted(syms[d["humanRef"]] - found),
                "paths_not_in_repo": sorted(c for c in cited if c not in full and not ("/" not in c and c in base)),
            }
    return ev


# ---------- Jev ----------

def questions():
    from typesafe_sdk import Choice, Noul
    return {
        "executable": Noul(instructions=(
            "Per `standard.purpose`: a fresh, competent worker with repository access could execute `ticket` correctly "
            "without any chat history. Work that needs live systems or an operator still counts when the ticket states "
            "exactly what to do, in what order, and how to prove it.")),
        "execution_mode": Choice(
            instructions="What does a worker need in order to complete `ticket`?",
            criteria={"repo_only": "Changes and checks inside the repository: code, tests, docs, CI.",
                      "live_environment": "Access to running production or staging systems, hosts, or cloud accounts.",
                      "operator_or_other_team": "A human operator, another team, or another repository must act or decide."}),
        "open_decision": Noul(instructions=(
            "`ticket` leaves a design choice, threshold, precondition, or delete-versus-fix decision unresolved, "
            "and does not name who decides or how the worker should decide.")),
        "validation_covers_success": Noul(instructions=(
            "`ticket.contract.validation` includes a check that directly demonstrates the main condition stated in "
            "`ticket.contract.success`, not only supporting or local checks.")),
        "self_blocked": Noul(instructions=(
            "`ticket` states that work cannot start until an external decision, ruling, or another ticket completes.")),
    }


def deep_mask(x, mask):
    # mask each string value; masking serialized JSON can break escape sequences
    if isinstance(x, str): return mask(x)
    if isinstance(x, list): return [deep_mask(v, mask) for v in x]
    if isinstance(x, dict): return {k: deep_mask(v, mask) for k, v in x.items()}
    return x


def run(boards):
    from typesafe_sdk import TypeSafeClient
    from dupes import check_mask, mask, remember
    client, qs = TypeSafeClient(model="jev-latest"), questions()
    for b in boards:
        bd = {r["id"]: r for r in map(json.loads, open(HERE / b / "bd.jsonl"))}
        remember(list(bd))
        check_mask({i: {"title": r["title"], "description": r.get("description")} for i, r in bd.items()})
    ev = evidence(boards)
    for b in boards:
        out = HERE / b / "sb-quality-v3.jsonl"
        done = {json.loads(l)["ref"] for l in open(out)} if out.exists() else set()
        todo = [d for d in candidates(b) if d["humanRef"] not in done]
        print(f"== {b}: {len(todo)} todo", flush=True)

        def one(d):
            r = client.system_one(state={"standard": STANDARD, "ticket": {
                "title": mask(d["title"]), "kind": d["kind"], "contract": deep_mask(d["contract"], mask)}}, questions=qs)
            return {"board": b, "ref": d["humanRef"], "title": d["title"], "evidence": ev[(b, d["humanRef"])],
                    "execution_mode": r.choices["execution_mode"].choice,
                    **{k: r.nouls[k].noul for k in ("executable", "open_decision", "validation_covers_success", "self_blocked")}}

        with ThreadPoolExecutor(8) as ex, open(out, "a") as f:
            for i, res in enumerate(ex.map(one, todo), 1):
                f.write(json.dumps(res) + "\n"); f.flush()
                e = res["evidence"]
                print(f"[{b} {i}/{len(todo)}] exec={res['executable']:.2f} open_dec={res['open_decision']:.2f} "
                      f"val_cov={res['validation_covers_success']:.2f} blocked={res['self_blocked']:.2f} "
                      f"{res['execution_mode']:22} stale={len(e['problem_symbols_missing'])}/{e['problem_symbols']} {res['ref']}", flush=True)


# ---------- report ----------

def auc(ys, ss):
    pos = [s for y, s in zip(ys, ss) if y]; neg = [s for y, s in zip(ys, ss) if not y]
    return sum((p > n) + .5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg)) if pos and neg else float("nan")


def policy(r):
    """Combined score; higher = more dispatchable. Weights are placeholders until labels exist."""
    stale = len(r["evidence"]["problem_symbols_missing"]) > 0
    return r["executable"] * (1 - r["open_decision"]) * (1 - r["self_blocked"]) * (0.5 if stale else 1.0)


def report(boards):
    files = [HERE / b / "sb-quality-v3.jsonl" for b in boards]
    rs = [json.loads(l) for p in files if p.exists() for l in open(p)]
    if not rs:
        return print("no v3 results yet: run `sb_quality3.py run` first")
    print(f"n={len(rs)} by board {dict(Counter(r['board'] for r in rs))}")
    print(f"execution_mode {dict(Counter(r['execution_mode'] for r in rs))}")
    for k in ("executable", "open_decision", "validation_covers_success", "self_blocked"):
        v = sorted(r[k] for r in rs)
        print(f"  {k:26} p10={v[len(v)//10]:.2f} median={v[len(v)//2]:.2f} p90={v[9*len(v)//10]:.2f}")
    print(f"  stale PROBLEM symbols: {sum(bool(r['evidence']['problem_symbols_missing']) for r in rs)} issues")
    labels = {}
    for b in boards:  # blind batches: <name>.labels.json (C-ids) + <name>.key.json (C-id -> ref)
        for lf in sorted((HERE / b).glob("blind-*.labels.json")):
            key = json.load(open(str(lf).replace(".labels.json", ".key.json")))
            for j in json.load(open(lf)):
                labels[(b, key[j["id"]])] = {**j, "ref": key[j["id"]]}
    if labels:
        print(f"labels loaded: {len(labels)}  dispatchable yes: {sum(l['dispatchable'] == 'yes' for l in labels.values())}")
    lab = [(r, labels[(r["board"], r["ref"])]) for r in rs if (r["board"], r["ref"]) in labels]
    if not lab:
        return print("no labels.jsonl yet")
    y = [l["dispatchable"] == "yes" for _, l in lab]
    print(f"\nagreement with labels (n={len(lab)}, dispatchable yes={sum(y)}):")
    for name, f in [("executable", lambda r: r["executable"]), ("1-open_decision", lambda r: 1 - r["open_decision"]),
                    ("1-self_blocked", lambda r: 1 - r["self_blocked"]),
                    ("not stale", lambda r: 0.0 if r["evidence"]["problem_symbols_missing"] else 1.0), ("policy", policy)]:
        print(f"  AUC {name:16} {auc(y, [f(r) for r, _ in lab]):.2f}")
    yv = [l["validation_proves_success"] == "yes" for _, l in lab]
    print(f"  AUC validation_covers_success vs label yes: {auc(yv, [r['validation_covers_success'] for r, _ in lab]):.2f} (yes={sum(yv)})")
    ym = [l["execution_mode"] for _, l in lab if l.get("execution_mode")]
    if ym:
        print(f"  execution_mode agreement: {sum(r['execution_mode'] == l.get('execution_mode') for r, l in lab) / len(ym):.0%}")
    print("\nlargest disagreements (policy vs label):")
    for r, l in sorted(lab, key=lambda x: -abs(policy(x[0]) - (x[1]["dispatchable"] == "yes")))[:10]:
        print(f"  {r['board']:12} {r['ref']:10} label={l['dispatchable']:3} policy={policy(r):.2f} exec={r['executable']:.2f} "
              f"open={r['open_decision']:.2f} blocked={r['self_blocked']:.2f} stale={r['evidence']['problem_symbols_missing'][:2]}  {l.get('main_gap', '')[:90]}")


if __name__ == "__main__":
    boards = sys.argv[2:] or list(BOARDS)
    {"run": run, "report": report}[sys.argv[1]](boards)
