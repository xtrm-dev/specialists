# permission-guard (phase 1, SPECIALISTS-4285)

Sandboxed `bash` for READ_ONLY specialists. Loaded via `-e <this dir>`
(legacy CLI spawns) or the resource loader's `extensionPaths` (native
activation) when `SPECIALISTS_PERMISSION_GUARD=1` and the resolved contract
grants READ_ONLY bash.

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

Environment: vars whose names match secret patterns (token, secret,
passwd/password, api_key/apikey, auth, credential, private_key —
case-insensitive) are stripped via `--unsetenv`. Everything else passes
through, preserving documented behavior (notably `PI_*` session metadata)
and ambient proxy/tool configuration.

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
  the flag is on AND this artifact resolves; every load site throws or
  refuses when the grant exists but the artifact is missing.

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
