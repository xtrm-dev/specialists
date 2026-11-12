# Release workflow

`npm version <patch|minor>` runs `bun run changelog` through the package `preversion` hook, so git-cliff refreshes `[Unreleased]` before the version commit and tag.

Prerequisite: install `git-cliff` on `PATH` (`brew install git-cliff` or `cargo install git-cliff`).

Before publishing:

```bash
bun run changelog:check
bun run build
bun test
npm pack --dry-run
```

## Rebuilding `dist/` (read this before you commit a build)

`dist/` is committed and the runtime loads it. Two CI jobs, `payload-contract` and `packed-smoke`,
rebuild it with the bun pinned in `.bun-version` and then require the result to equal the committed
files. A bundle built by a different bun is a different bundle: bun 1.4.0 emits
`var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res)` where 1.4.2 emits
`var __esm = (fn, res, err) => () => {`, and the two keep different `exports_*` helper blocks. If
your global bun differs from the pin, the committed bundle fails both jobs with a diff that says
nothing about the cause.

Run the guard instead of guessing:

```bash
bun run check:dist-reproducible           # check; restores dist/ when it differs
bun run check:dist-reproducible --write   # keep the rebuild, then commit it
```

The guard refuses to build with a bun other than the pinned one, and it names the pinned version,
the files that differ, and the fix. To satisfy it without changing your global bun, install the
pinned binary into a temporary directory and put it first on `PATH`:

```bash
curl -fsSL https://bun.sh/install | BUN_INSTALL=/tmp/bun142 bash -s "bun-v1.4.2"
PATH=/tmp/bun142/bin:$PATH bun run check:dist-reproducible --write
```

`PATH` matters: `bun run build` shells out to `bun` for its nested builds, so pinning only the
outer invocation builds part of the bundle with the wrong version. Alternatively point
`SPECIALISTS_PINNED_BUN` at an existing binary of the pinned version.

Commit a rebuilt `dist/` as its own toolchain-only commit, so the source change stays reviewable.

Publishing is operator-approved only. After approval, publish the scoped package and create the matching GitHub release from the version tag using that version's CHANGELOG section.
