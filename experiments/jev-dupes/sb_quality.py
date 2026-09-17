"""Contract quality on Substrate fields, for issues that pass structural checks and lack only a
semantic attestation (bead unitAI-gexnv). Read-only: never calls `sb issue attest`.

  sb --db market-data/sb-scratch.db import beads ...        # see bead notes
  (sb issue show --json for open issues -> market-data/sb-open.json)
  uv run --with typesafe-sdk python sb_quality.py run  [repo_root]
  uv run --with typesafe-sdk python sb_quality.py report
"""
import json, os, re, sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent / "market-data"
REPO = Path(sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/projects/mercury/market-data"))
OUT = HERE / "sb-quality-v2.jsonl"  # v1: path misses were sent to Jev and biased executable (0.41 vs 0.53)
ATTEST_ONLY = "no current semantic attestation for this revision + contract hash"

# planning/references/contracts.md, verbatim where possible
STANDARD = {
    "purpose": "A ready contract lets a fresh competent worker with repository access execute the work "
               "without the chat transcript. Missing information belongs in the contract or a referenced artifact. "
               "A contract states what must be true; it prescribes a mechanism only when that mechanism is itself a constraint.",
    "problem": "Why this exists. State the defect, missing capability, or decision pressure in real prose.",
    "success": "Observable conditions that mean the work is complete.",
    "scope": "Owned files/systems/behaviors. Be specific enough to prevent accidental expansion.",
    "nonGoals": "Nearby work deliberately excluded.",
    "constraints": "Compatibility, safety, ownership, architecture, rollout, or implementation invariants.",
    "validation": "Exact checks/evidence expected. Include integrated behavior where it matters. Static checks alone do not prove integrated behavior.",
    "output": "Durable result the worker must leave: code/commit, report, bead notes, artifact, etc.",
}
FIELDS = ["problem", "success", "scope", "nonGoals", "constraints", "validation", "output"]


_FILES = None


def paths(contract):
    # Deterministic evidence. "not found" can be another repo (infra/...) or a container path: evidence, not proof.
    global _FILES
    if _FILES is None:
        import subprocess
        ls = subprocess.run(["git", "-C", str(REPO), "ls-files"], capture_output=True, text=True).stdout.split()
        _FILES = (set(ls), {p.rsplit("/", 1)[-1] for p in ls})
    full, base = _FILES
    text = json.dumps(contract)
    cands = set(re.findall(r"[\w.-]+(?:/[\w.-]+)*\.(?:py|rs|ts|md|yml|yaml|toml|json|sh|sql)\b", text))
    found = sorted(c for c in cands if c in full or ("/" not in c and c in base))
    return {"referenced_paths_found": found, "referenced_paths_not_in_this_repo": sorted(cands - set(found))}


def questions():
    from typesafe_sdk import Noul, Score
    qs = {
        f: Score(
            instructions=f"Judge the `ticket.contract.{f}` field against `standard.{f}` and `standard.purpose`. "
                         f"Judge substance and specificity, not length.",
            criteria=[f"Hollow: the {f} field is boilerplate, restates the title, or would not guide a worker.",
                      f"Partial: the {f} field is relevant but vague or incomplete; the worker would need to ask or guess.",
                      f"Meets the standard: the {f} field is specific enough to act on and check."])
        for f in FIELDS}
    qs["executable"] = Noul(instructions=(
        "Per `standard.purpose`: a fresh, competent worker with repository access, including the files the ticket "
        "references (see `evidence`), could execute `ticket` correctly without any chat history."))
    qs["validation_proves_success"] = Noul(instructions=(
        "Performing the checks in `ticket.contract.validation` would show that every condition in "
        "`ticket.contract.success` holds, including integrated behavior where it matters."))
    qs["scope_bounded"] = Noul(instructions=(
        "`ticket.contract.scope` and `ticket.contract.nonGoals` together make clear what the worker must NOT change."))
    return qs


def run():
    from typesafe_sdk import TypeSafeClient
    from dupes import check_mask, mask, remember  # reuse the verified id masking
    # epics coordinate children; they are not judged against the single-change standard
    issues = [d for d in json.load(open(HERE / "sb-open.json")) if d["reasons"] == [ATTEST_ONLY] and d["kind"] != "epic"]
    bd = {r["id"]: r for r in map(json.loads, open(HERE / "bd.jsonl"))}
    remember(list(bd))
    check_mask({i: {"title": r["title"], "description": r.get("description")} for i, r in bd.items()})
    done = {json.loads(l)["ref"] for l in open(OUT)} if OUT.exists() else set()
    todo = [d for d in issues if d["humanRef"] not in done]
    print(f"attestation-only issues: {len(issues)}  todo: {len(todo)}  repo: {REPO}")
    client, qs = TypeSafeClient(model="jev-latest"), questions()

    def one(d):
        contract = json.loads(mask(json.dumps(d["contract"])))
        ev = paths(d["contract"])
        # only confirmed paths go to Jev: a path not in the repo may be a file to create or another repo
        r = client.system_one(state={"standard": STANDARD, "evidence": {"referenced_paths_found": ev["referenced_paths_found"]},
                                     "ticket": {"title": mask(d["title"]), "kind": d["kind"], "contract": contract}},
                              questions=qs)
        return {"ref": d["humanRef"], "title": d["title"], "evidence": ev,
                "fields": {f: r.scores[f].score for f in FIELDS},
                **{k: r.nouls[k].noul for k in ("executable", "validation_proves_success", "scope_bounded")}}

    with ThreadPoolExecutor(8) as ex, open(OUT, "a") as f:
        for i, res in enumerate(ex.map(one, todo), 1):
            f.write(json.dumps(res) + "\n"); f.flush()
            weak = min(res["fields"], key=res["fields"].get)
            print(f"[{i}/{len(todo)}] exec={res['executable']:.2f} val→succ={res['validation_proves_success']:.2f} "
                  f"bounded={res['scope_bounded']:.2f} weakest={weak} {res['fields'][weak]:.1f} "
                  f"paths {len(res['evidence']['referenced_paths_found'])}/{len(res['evidence']['referenced_paths_not_in_this_repo'])} missing  {res['ref']}", flush=True)


def report():
    import statistics as st
    rs = [json.loads(l) for l in open(OUT)]
    say = print
    say(f"n={len(rs)} attestation-only issues\n")
    for k in ("executable", "validation_proves_success", "scope_bounded"):
        v = sorted(r[k] for r in rs)
        say(f"{k:26} p10={v[len(v)//10]:.2f} median={v[len(v)//2]:.2f} p90={v[9*len(v)//10]:.2f}  ≥0.7: {sum(x >= .7 for x in v)}  <0.3: {sum(x < .3 for x in v)}")
    say("\nmean field score (0 hollow – 2 meets standard): " + ", ".join(f"{f} {st.mean(r['fields'][f] for r in rs):.2f}" for f in FIELDS))
    mean = lambda r: st.mean(r["fields"].values())
    say(f"corr(executable, mean field) = {st.correlation([r['executable'] for r in rs], [mean(r) for r in rs]):.2f}")
    miss = [r for r in rs if r["evidence"]["referenced_paths_not_in_this_repo"]]
    say(f"issues citing paths that do not exist in the repo: {len(miss)}")
    # ponytail: rank-based cut (top/bottom quartile) until hand labels exist to set real thresholds
    q = lambda k, p: sorted(r[k] for r in rs)[int(p * (len(rs) - 1))]
    hi_e, hi_v, lo_e, lo_v = q("executable", .75), q("validation_proves_success", .75), q("executable", .25), q("validation_proves_success", .25)
    say(f"\nattest candidates (top quartile on executable ≥ {hi_e:.2f} AND validation_proves_success ≥ {hi_v:.2f}):")
    for r in sorted((r for r in rs if r["executable"] >= hi_e and r["validation_proves_success"] >= hi_v), key=lambda r: -r["executable"]):
        say(f"  {r['executable']:.2f}/{r['validation_proves_success']:.2f} {r['ref']:8} {r['title'][:80]}")
    say(f"\nreject candidates (bottom quartile on executable ≤ {lo_e:.2f} OR validation_proves_success ≤ {lo_v:.2f}), with gaps:")
    for r in sorted((r for r in rs if r["executable"] <= lo_e or r["validation_proves_success"] <= lo_v), key=lambda r: r["executable"] + r["validation_proves_success"])[:15]:
        gaps = [f for f in FIELDS if r["fields"][f] < 1.5] + (["validation does not prove success"] if r["validation_proves_success"] <= lo_v else []) \
               + ([f"paths not in repo (check: new file or other repo?): {', '.join(r['evidence']['referenced_paths_not_in_this_repo'][:2])}"] if r["evidence"]["referenced_paths_not_in_this_repo"] else [])
        say(f"  {r['executable']:.2f}/{r['validation_proves_success']:.2f} {r['ref']:8} {r['title'][:70]}\n      gaps: {gaps or '-'}")


if __name__ == "__main__":
    {"run": run, "report": report}[sys.argv[1]]()
