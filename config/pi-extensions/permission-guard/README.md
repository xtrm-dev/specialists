# permission-guard (phase 1, SPECIALISTS-4285)

Sandboxed `bash` for READ_ONLY specialists. Loaded via `-e <this dir>`
(legacy CLI spawns) or the resource loader's `extensionPaths` (native
activation) by default (SPECIALISTS-4290) whenever the resolved contract
grants READ_ONLY bash. `SPECIALISTS_PERMISSION_GUARD=0` (or `false`) opts out.

## How it works

`tool_call` input mutation — not a tool override. The builtin `bash` stays
registered; before execution its `command` is rewritten to run inside
bubblewrap:

```
<abs-bwrap> --ro-bind / / --proc /proc --dev /dev --tmpfs /tmp --tmpfs /run
  --unshare-net --unshare-pid --unshare-ipc --cap-drop ALL
  --die-with-parent --new-session
  --setenv TMPDIR /tmp --setenv TEMP /tmp --setenv TMP /tmp
  --setenv XDG_CACHE_HOME /tmp/xdg-cache
  <secret --unsetenv pairs> <credential masks> --chdir <cwd> -- bash -c <command>
```

`--tmpfs /run` hides the user bus and the docker socket (systemd-run /
docker escape); `--unshare-pid --unshare-ipc --cap-drop ALL` complete the
isolation. bwrap is resolved to an absolute path once at self-check, and
the self-check runs the real boundary argv shape.

Credential masks cover existing host paths only (dirs get `--tmpfs`,
files get `--ro-bind /dev/null`): `.ssh`, `.aws`, `.gnupg`,
`.config/gh`, `.config/gcloud`, `.config/glab-cli`, `.docker`, `.netrc`,
`.npmrc`, `.git-credentials`, `.pi/agent*`, `.claude/.credentials*`.

Environment: `--clearenv` plus an allowlist passthrough — PATH HOME USER
LOGNAME SHELL LANG LC_* TERM PI_* (secret-pattern names excluded even when
allowlisted), plus the TMPDIR/TEMP/TMP/XDG_CACHE_HOME pins. A deny-list
cannot enumerate ambient secrets (DATABASE_URL, *_DSN, *_WEBHOOK, provider
PATs), so the environment boundary is allowlist-shaped.

Because the mechanism is a `tool_call` handler, codemode-nested calls
(`ctx.executeTool`, carrying `parentToolCallId`) are wrapped identically —
one handler covers both paths.

## Fail-closed

- `session_start` runs a bwrap self-check. Until it passes, every bash call
  is blocked with a reason. A throwing handler also blocks (Pi fail-safe).
- `PI_SPECIALIST_PERMISSION_TIER` names the tier on CLI spawns; a set tier
  other than READ_ONLY refuses. Unset (native in-process path, where
  curated-conditional loading is the authorization) proceeds sandboxed.
- The resolver (`shouldGrantGuardedBash`) grants READ_ONLY bash only when
  the guard is not opted out AND this artifact resolves. When the artifact
  is missing, CLI spawns warn and launch without bash; native activation
  refuses if bash is granted but the guard is not loaded.

## Verify

- Unit: `bun --bun vitest run tests/unit/pi/permission-guard.test.ts`
  (pure builders, fail-closed behavior, nested-call equivalence).
- Boundary probes: `bash scripts/probe-permission-guard.sh` (13 checks:
  writes fail, private tmp succeeds, network fails, credential reads fail,
  git/ocr read commands succeed, both mutation controls). Skips with reason
  when bwrap is absent.
- Mutation control: weakening `--ro-bind` or `--unshare-net` must flip the
  matching probe to fail-open — the flags are load-bearing, not decorative.

## Not covered

`user_bash` (operator `!cmd`), `!` shell escapes, and `pi.exec` / direct
`node:fs` inside extension code never emit `tool_call`, so no `tool_call`
handler — this guard included — can see them. The boundary covers the
specialist MODEL's `bash` tool calls only, which is the whole of what a
headless specialist can reach.

## Non-goals (phase 2)

LOW/MEDIUM/HIGH write confinement, network allowlists, sandbox-runtime /
socat. Command-pattern rules, if any are ever added, are hints; the bwrap
boundary is the control.
