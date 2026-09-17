"""Import each board's bd export into a SCRATCH Substrate db (never ~/.xtrm/state.db) and dump open issues.

  python3 sb_prep.py            # all boards in BOARDS
  python3 sb_prep.py core infra # subset
"""
import json, os, subprocess, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
HOME = Path.home()
BOARDS = {  # board dir -> repo root (source of bd export and of staleness checks)
    "market-data": HOME / "projects/mercury/market-data",
    "core": HOME / "dev/core",
    "darth-feedor": HOME / "projects/mercury/darth-feedor",
    "specialists": HOME / "dev/specialists",
    "infra": HOME / "projects/mercury/infra",
}
ATTEST_ONLY = "no current semantic attestation for this revision + contract hash"


def sb(db, *args):
    r = subprocess.run(["sb", "--db", str(db), "--json", *args], capture_output=True, text=True)
    return json.loads(r.stdout)


def prep(name):
    out, repo = HERE / name, BOARDS[name]
    out.mkdir(exist_ok=True)
    db = out / "sb-scratch.db"
    assert db.resolve() != (HOME / ".xtrm/state.db").resolve()
    if not (out / "bd.jsonl").exists():
        subprocess.run(["bd", "export", "-o", str(out / "bd.jsonl")], cwd=repo, check=True, capture_output=True)
    if not db.exists():
        prefix = name.replace("-", "")[:8].upper()
        rec = sb(db, "import", "beads", "--file", str(out / "bd.jsonl"), "--project", f"prj_{prefix.lower()}",
                 "--create-project", f"{prefix}:{name}")
        (out / "sb-import-receipt.json").write_text(json.dumps(rec))
    project = sb(db, "project", "list")["data"][0]["id"] if name != "market-data" else "prj_mmd"
    issues = sb(db, "issue", "list", "--project", project)["data"]
    opened = [sb(db, "issue", "show", i["id"])["data"] for i in issues if i["lifecycleState"] in ("open", "deferred")]
    (out / "sb-open.json").write_text(json.dumps(opened))
    att = [d for d in opened if d["reasons"] == [ATTEST_ONLY] and d["kind"] != "epic"]
    print(f"{name:13} issues={len(issues)} open={len(opened)} attestation-only(non-epic)={len(att)} "
          f"kinds={dict(Counter(d['kind'] for d in att))}", flush=True)


if __name__ == "__main__":
    for n in sys.argv[1:] or [b for b in BOARDS if b != "market-data"]:
        prep(n)
