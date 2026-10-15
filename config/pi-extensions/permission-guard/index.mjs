// Permission guard, phase 1 (SPECIALISTS-4285): sandboxed bash for READ_ONLY.
//
// Design: `tool_call` input mutation, NOT a tool override. The builtin `bash`
// stays registered, so this works identically on every launch surface with no
// registry, source-class, or allowlist changes: legacy CLI spawn
// (src/pi/session.ts, src/specialist/script-runner.ts) and native activation
// (src/activation/native-host.ts, reached via MCP specialist_dispatch in
// src/mcp/v2-server.ts and via config/pi-extensions/native-specialists/).
// Codemode-nested calls (ctx.executeTool) fire `tool_call` with
// parentToolCallId set, so they are wrapped identically — verified by unit
// test with a nested event.
//
// Boundary per call: bwrap --ro-bind / / --proc /proc --dev /dev --tmpfs /tmp
// --tmpfs /run --unshare-net --unshare-pid --unshare-ipc --cap-drop ALL
// --die-with-parent --new-session --setenv TMPDIR/TEMP/TMP and XDG_CACHE_HOME
// to /tmp (+ --unsetenv for secret-pattern env vars) --chdir <cwd> -- bash -c
// <command>, plus credential masks (existing host paths only: dirs overmounted
// with tmpfs, files bound to /dev/null read-only).
//
// NOT covered: user_bash (operator `!cmd`), `!` shell escapes, and pi.exec /
// direct node:fs inside extension code never emit tool_call, so this guard
// (like any tool_call handler) cannot see them. The boundary covers the
// specialist MODEL's bash tool calls only — which is the whole of what a
// headless specialist can reach.
//
// Fail closed: session_start runs a bwrap self-check; while it has not
// passed, EVERY bash call is blocked with a reason. A throwing tool_call
// handler also blocks (Pi fail-safe). Nothing here ever runs raw bash.
//
// Tier channel: PI_SPECIALIST_PERMISSION_TIER, set by CLI spawners. When set
// and not READ_ONLY the call is refused (defense in depth — the loader only
// loads this extension for granted READ_ONLY sessions). When unset (native
// in-process path, where curated-conditional loading is the authorization)
// the call proceeds sandboxed.
//
// Phase 2 (separate Issue): LOW/MEDIUM/HIGH write confinement, network
// allowlists via sandbox-runtime + socat.

export const TIER_ENV_KEY = 'PI_SPECIALIST_PERMISSION_TIER';
export const READ_ONLY_TIER = 'READ_ONLY';

export const SELF_CHECK_FAILURE_PREFIX = 'permission-guard: bwrap self-check failed';
export const TIER_REFUSAL_PREFIX = 'permission-guard: refusing bash';

// Credential paths masked inside the sandbox. Plain entries are joined to
// $HOME; starred entries are prefix-globs inside $HOME.
export const CREDENTIAL_PATHS = [
  '.ssh', '.aws', '.gnupg', '.config/gh', '.config/gcloud', '.config/glab-cli',
  '.docker', '.netrc', '.npmrc', '.git-credentials',
];
export const CREDENTIAL_GLOBS = ['.pi/agent*', '.claude/.credentials*'];

// Env vars matching any of these are stripped (--unsetenv) before the call.
// Case-insensitive substring match on the NAME. Keeps documented behavior
// (PI_* session metadata, ambient proxy/tool config) while removing the
// token/key/secret material a prompt-injected agent must never see.
export const SECRET_ENV_PATTERNS = ['token', 'secret', 'passwd', 'password', 'api_key', 'apikey', 'auth', 'credential', 'private_key'];

/** Names from `env` matching SECRET_ENV_PATTERNS (case-insensitive). Pure. */
export function secretEnvNames(env) {
  const names = [];
  for (const key of Object.keys(env ?? {})) {
    const lower = key.toLowerCase();
    if (SECRET_ENV_PATTERNS.some((p) => lower.includes(p))) names.push(key);
  }
  return names;
}

/** POSIX shell-quote one argv word. */
export function shq(word) {
  return `'${String(word).replace(/'/g, `'\\''`)}'`;
}

import { homedir } from 'node:os';

function homeDir() {
  return process.env.HOME || homedir();
}

/**
 * Credential-mask argv for a home directory. Entries absent on the host are
 * skipped (nothing to leak); existing directories are overmounted with an
 * empty tmpfs, existing files bound to /dev/null read-only. statSync and
 * readdirSync are injectable for tests.
 */
export async function buildCredentialMaskArgs(home, fsHooks = null) {
  const args = [];
  const statSyncFn = fsHooks?.statSync ?? null;
  let statSyncReal = null;
  const stat = async (p) => {
    if (statSyncFn) return statSyncFn(p);
    if (!statSyncReal) statSyncReal = (await import('node:fs')).statSync;
    return statSyncReal(p);
  };
  const readdirFn = fsHooks?.readdirSync ?? (await import('node:fs')).readdirSync;
  const { join } = await import('node:path');
  const maskOne = async (abs) => {
    let st;
    try {
      st = await stat(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) args.push('--tmpfs', abs);
    else args.push('--ro-bind', '/dev/null', abs);
  };
  for (const rel of CREDENTIAL_PATHS) {
    await maskOne(join(home, rel));
  }
  for (const pattern of CREDENTIAL_GLOBS) {
    const slash = pattern.lastIndexOf('/');
    const dirRel = pattern.slice(0, slash);
    const prefix = pattern.slice(slash + 1).replace(/\*$/, '');
    const dirAbs = join(home, dirRel);
    let entries;
    try {
      entries = readdirFn(dirAbs);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      await maskOne(join(dirAbs, entry));
    }
  }
  return args;
}

/**
 * bwrap argv prefix (everything up to `--`). Pure and unit-tested.
 * secretUnsetArgs are `--unsetenv NAME` pairs for secret-pattern env vars.
 */
export function buildBwrapPrefix({ maskArgs, secretUnsetArgs = [] }) {
  return [
    '--ro-bind', '/', '/',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    // /run carries the user bus and the docker socket: a systemd-run or
    // docker escape from inside the sandbox. Mask it, isolate pids and IPC.
    '--tmpfs', '/run',
    '--unshare-net',
    '--unshare-pid',
    '--unshare-ipc',
    '--cap-drop', 'ALL',
    '--die-with-parent',
    '--new-session',
    '--setenv', 'TMPDIR', '/tmp',
    '--setenv', 'TEMP', '/tmp',
    '--setenv', 'TMP', '/tmp',
    '--setenv', 'XDG_CACHE_HOME', '/tmp/xdg-cache',
    ...secretUnsetArgs,
    ...maskArgs,
  ];
}

/**
 * Full wrapped shell string for one bash call. Pure and unit-tested.
 * bwrapBin is the absolute bwrap path resolved by the self-check (never a
 * PATH lookup at call time); secretEnv lists env names to --unsetenv.
 */
export function buildWrappedCommand({ command, cwd, maskArgs, bwrapBin = 'bwrap', secretEnv = [] }) {
  const secretUnsetArgs = secretEnv.flatMap((name) => ['--unsetenv', name]);
  const prefix = buildBwrapPrefix({ maskArgs, secretUnsetArgs });
  const parts = [bwrapBin, ...prefix, '--chdir', cwd, '--', 'bash', '-c', command];
  return parts.map(shq).join(' ');
}

const selfCheckState = { checked: false, ok: false, detail: '', bwrapBin: null };

export function __resetSelfCheckForTest() {
  selfCheckState.checked = false;
  selfCheckState.ok = false;
  selfCheckState.detail = '';
  selfCheckState.bwrapBin = null;
}

/** Resolve bwrap to an absolute path via PATH. fsHooks injectable for tests. */
export async function resolveBwrapBin(fsHooks = null) {
  const pathMod = fsHooks?.path ?? (await import('node:path'));
  const fsMod = fsHooks?.fs ?? (await import('node:fs'));
  const pathEnv = fsHooks?.pathEnv ?? process.env.PATH ?? '';
  const isWindows = pathMod.delimiter === ';';
  for (const dir of pathEnv.split(pathMod.delimiter)) {
    if (!dir) continue;
    const candidate = pathMod.join(dir, isWindows ? 'bwrap.exe' : 'bwrap');
    try {
      fsMod.accessSync(candidate, fsMod.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Startup self-check: can this host actually sandbox? Runs the REAL boundary
 * argv shape (--proc, --dev, --tmpfs included) against the absolute bwrap
 * path and caches it for call time. execFn/fsHooks injectable for tests.
 */
export async function bwrapSelfCheck(execFn = null, fsHooks = null) {
  if (selfCheckState.checked) return { ...selfCheckState };
  let run = execFn;
  if (!run) {
    const { execFile } = await import('node:child_process');
    run = (bin, args, opts, cb) => execFile(bin, args, opts, cb);
  }
  const bin = await resolveBwrapBin(fsHooks);
  if (!bin) {
    selfCheckState.checked = true;
    selfCheckState.ok = false;
    selfCheckState.detail = 'bwrap not found on PATH';
    selfCheckState.bwrapBin = null;
    return { ...selfCheckState };
  }
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      run(
        bin,
        ['--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
          '--tmpfs', '/run', '--unshare-net', '--unshare-pid', '--unshare-ipc',
          '--die-with-parent', '--new-session', 'true'],
        { timeout: 15000 },
        (error) => (error ? rejectPromise(error) : resolvePromise(undefined)),
      );
    });
    selfCheckState.checked = true;
    selfCheckState.ok = true;
    selfCheckState.detail = '';
    selfCheckState.bwrapBin = bin;
  } catch (error) {
    selfCheckState.checked = true;
    selfCheckState.ok = false;
    selfCheckState.detail = error instanceof Error ? error.message : String(error);
    selfCheckState.bwrapBin = null;
  }
  return { ...selfCheckState };
}

/** Tier refusal reason, or null when the call may proceed sandboxed. */
export function tierRefusal() {
  const tier = (process.env[TIER_ENV_KEY] ?? '').toUpperCase();
  if (tier && tier !== READ_ONLY_TIER) {
    return `${TIER_REFUSAL_PREFIX}: tier '${tier}' is not sandboxed in phase 1 (READ_ONLY only)`;
  }
  return null;
}

export function bashRefusalReason() {
  if (!selfCheckState.checked || !selfCheckState.ok) {
    return `${SELF_CHECK_FAILURE_PREFIX}: ${selfCheckState.detail || 'self-check has not passed'}; refusing bash rather than running unsandboxed`;
  }
  return tierRefusal();
}

export default function permissionGuard(pi) {
  pi.on('session_start', async () => {
    await bwrapSelfCheck();
    if (!selfCheckState.ok) {
      console.error(`[permission-guard] ${SELF_CHECK_FAILURE_PREFIX}: ${selfCheckState.detail}; all bash calls will be refused`);
    }
  });

  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'bash') return undefined;
    const refusal = bashRefusalReason();
    if (refusal) return { block: true, reason: refusal };
    const maskArgs = await buildCredentialMaskArgs(homeDir());
    // Pi's bash input is {command, timeout} only (pi bash.js): the run cwd
    // comes from the handler context, which the session sets to the
    // specialist worktree. Never input.cwd, never process.cwd() (on the
    // native in-process path that is the HOST cwd, not the worktree).
    const cwd = ctx?.cwd ?? process.cwd();
    const input = event.input;
    input.command = buildWrappedCommand({
      command: input.command,
      cwd,
      maskArgs,
      bwrapBin: selfCheckState.bwrapBin ?? 'bwrap',
      secretEnv: secretEnvNames(process.env),
    });
    return undefined;
  });
}
