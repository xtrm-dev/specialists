#!/usr/bin/env node
/**
 * Idle-cost measurement for the specialists MCP server (SPECIALISTS-4217).
 *
 * Starts ONE MCP server over stdio (`plugins/specialists/scripts/mcp-server.mjs`,
 * the same entry the Claude plugin uses), performs the Claude-like startup
 * handshake (initialize → notifications/initialized → tools/list), then goes
 * completely idle: no further stdin input, no tool calls, no activations.
 *
 * Measures, over the idle window:
 *   - CPU seconds (utime+stime from /proc/<pid>/stat, converted with CLK_TCK=100)
 *   - RSS (VmRSS from /proc/<pid>/status), average and final
 *   - bytes the server wrote to stdout/stderr while idle (a non-zero number is
 *     itself a finding: an idle server should say nothing)
 *
 * Prints one JSON object on stdout. Run under `nice -n 19` on a shared host:
 *   nice -n 19 node tests/perf/measure-mcp-idle.mjs --idle-ms 300000
 *
 * Flags:
 *   --idle-ms <n>     idle window length, default 300000 (5 min)
 *   --warmup-ms <n>   settle time between handshake and baseline, default 5000
 *   --server-cwd <p>  cwd for the server process (repo state it opens); default: repo root
 *   --call-rate <n>    issue one tools/call every <n> ms during the idle
 *                      window (default 0 = no calls). Non-zero measures per-call cost.
 *   --call-tool <n>    tool + JSON arguments used by --call-rate, default
 *                      specialist_status with {} (SPECIALISTS-4217).
 *   --cpu-profile <p> run the server under bun's CPU profiler, writing <p> on exit
 *                      (bun --cpu-prof; --cpu-prof-md is used for grep-friendly output)
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const IDLE_MS = flag('--idle-ms', 300_000);
const WARMUP_MS = flag('--warmup-ms', 5_000);
const PROFILE = args.includes('--cpu-profile') ? args[args.indexOf('--cpu-profile') + 1] : null;
const CALL_RATE_MS = flag('--call-rate', 0);
const CALL_TOOL = args.includes('--call-tool')
  ? JSON.parse(args[args.indexOf('--call-tool') + 1])
  : { name: 'specialist_status', arguments: {} };
const CALL_METHOD = args.includes('--call-method') ? args[args.indexOf('--call-method') + 1] : 'tools/call';
const ENTRY = new URL('../../plugins/specialists/scripts/mcp-server.mjs', import.meta.url).pathname;
const BUN = process.env.SPECIALISTS_BUN ?? 'bun';
const CLK_TCK = 100; // getconf CLK_TCK on Linux
const ROOT = new URL('../..', import.meta.url).pathname;
const SERVER_CWD = args.includes('--server-cwd') ? args[args.indexOf('--server-cwd') + 1] : ROOT;

const serverArgs = PROFILE
  ? ['--cpu-prof', '--cpu-prof-md', `--cpu-prof-dir=${dirname(PROFILE)}`, `--cpu-prof-name=${basename(PROFILE)}`, ENTRY]
  : [ENTRY];
const child = spawn(BUN, serverArgs, { cwd: SERVER_CWD, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => { /* server exited; the die() path reports it */ });
let finished = false;
child.on('exit', (code, signal) => { if (!finished) die(`server exited early (code=${code} signal=${signal})`); });
const t0 = Date.now();

let stderrBytes = 0, stdoutBytes = 0;
let stderrTail = '';
child.stderr.on('data', (d) => { stderrBytes += d.length; stderrTail = (stderrTail + d.toString()).slice(-2000); });
child.stdout.on('data', (d) => { stdoutBytes += d.length; buffer += d.toString(); drain(); });

let buffer = '';
const pending = new Map();
function drain() {
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    } catch { /* not JSON-RPC; ignore */ }
  }
}
function rpc(method, params, isNotification = false) {
  const msg = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
  if (!isNotification) msg.id = rpc.nextId = (rpc.nextId ?? 0) + 1;
  child.stdin.write(JSON.stringify(msg) + '\n');
  if (isNotification) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20_000);
    pending.set(msg.id, (m) => { clearTimeout(timer); resolve(m); });
  });
}

function readProc() {
  try {
    const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(' ');
    const utime = Number(stat[13]), stime = Number(stat[14]);
    const status = readFileSync(`/proc/${child.pid}/status`, 'utf8');
    const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
    return { cpu: (utime + stime) / CLK_TCK, rss };
  } catch { return null; }
}

function die(msg) { console.error(`measure-mcp-idle: ${msg}\n${stderrTail}`); child.kill('SIGKILL'); process.exit(1); }

const initResp = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'idle-measure', version: '0.0.0' } });
if (initResp.error) die(`initialize failed: ${initResp.error.message}`);
await rpc('notifications/initialized', undefined, true);
const toolsResp = await rpc('tools/list', {});
if (toolsResp.error) die(`tools/list failed: ${toolsResp.error.message}`);

await delay(WARMUP_MS);
const base = readProc();
if (!base) die('server exited before baseline');
const baseErr = stderrBytes, baseOut = stdoutBytes;

const samples = [base];
let calls = 0;
let callTimer = null;
if (CALL_RATE_MS > 0) {
  callTimer = setInterval(() => {
    rpc.nextId = (rpc.nextId ?? 0) + 1;
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: rpc.nextId, method: CALL_METHOD,
      ...(CALL_METHOD === 'tools/call' ? { params: CALL_TOOL } : {}),
    }) + '\n');
    calls += 1;
  }, CALL_RATE_MS);
}
const tIdle0 = Date.now();
while (Date.now() - tIdle0 < IDLE_MS) {
  await delay(Math.min(10_000, IDLE_MS - (Date.now() - tIdle0)));
  const s = readProc();
  if (!s) die('server exited during idle window');
  samples.push(s);
}
if (callTimer) clearInterval(callTimer);
const tIdle1 = Date.now();
const idleSec = (tIdle1 - tIdle0) / 1000;
const cpu = samples[samples.length - 1].cpu - base.cpu;
const rssAvg = Math.round(samples.reduce((a, s) => a + s.rss, 0) / samples.length);
const rssFinal = samples[samples.length - 1].rss;
const cpuTimeline = samples.slice(1).map((s, i) => +(s.cpu - samples[i].cpu).toFixed(2));

console.log(JSON.stringify({
  pid: child.pid,
  bun: BUN,
  server_cwd: SERVER_CWD,
  idle_window_s: idleSec,
  idle_cpu_s: +cpu.toFixed(3),
  idle_cores: +(cpu / idleSec).toFixed(6),
  calls_issued: calls,
  call_method: CALL_METHOD,
  call_tool: CALL_TOOL.name,
  cpu_s_per_call: calls > 0 ? +(cpu / calls).toFixed(4) : undefined,
  rss_avg_kb: rssAvg,
  rss_final_kb: rssFinal,
  cpu_per_10s: cpuTimeline,
  idle_stderr_bytes: stderrBytes - baseErr,
  idle_stdout_bytes: stdoutBytes - baseOut,
  tool_count: initResp.result?.capabilities ? toolsResp.result?.tools?.length : undefined,
  startup_wall_s: +((Date.now() - t0 - IDLE_MS - WARMUP_MS) / 1000).toFixed(1),
}));
finished = true;
child.kill('SIGTERM');
setTimeout(() => child.kill('SIGKILL'), 5000).unref();
