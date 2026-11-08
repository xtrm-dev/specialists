// SPECIALISTS-4403 probe: with pi-claude-bridge as the provider, does a real Pi AgentSession
// execute tool calls itself (Pi's tool path, so the permission guard binds) instead of leaving
// them to Claude Code?
//
// The Claude Code query is replaced by a fake SDK stream: no network, no Claude login, no
// subscription quota. Copy this file into the bridge checkout so its node_modules resolve:
//
//   cp docs/spike-4403/claude-bridge-tool-exec-probe.mjs <bridge>/
//   cd <bridge>
//   HOME=<scratch> node --import tsx claude-bridge-tool-exec-probe.mjs noguard
//   HOME=<scratch> PI_SPECIALIST_PERMISSION_TIER=READ_ONLY \
//     node --import tsx claude-bridge-tool-exec-probe.mjs guard
//
// Compare `markerExists` and the bash tool result text between the two runs.
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const mode = process.argv[2] ?? "noguard";
const bridgeDir = resolve(process.env.BRIDGE_DIR ?? process.cwd());
const guardPath = resolve(process.env.PERMISSION_GUARD_DIR
  ?? "/home/dawid/dev/specialists/config/pi-extensions/permission-guard");
// The guard's sandbox mounts a fresh tmpfs on /tmp, so the working directory must be a real path.
const CWD = process.env.PROBE_CWD ?? "/tmp/spike-4403/probe-cwd-visible";
const ROOT = process.env.PROBE_ROOT ?? "/tmp/spike-4403";
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(ROOT, "home/.pi/agent");
const MARKER = process.env.PROBE_MARKER ?? join(ROOT, "proof", `bash-${mode}.txt`);
if (!isAbsolute(MARKER)) throw new Error("PROBE_MARKER must be absolute");
mkdirSync(AGENT_DIR, { recursive: true });
mkdirSync(CWD, { recursive: true });
mkdirSync(join(ROOT, "proof"), { recursive: true });
rmSync(MARKER, { force: true });

const bridge = await import(join(bridgeDir, "src/index.ts"));
const { setQuery, resetSharedSession, activeQueryContexts } = bridge.__test;

const ev = (event) => ({ type: "stream_event", event });
const init = (options) => ({ type: "system", subtype: "init", session_id: options.sessionId ?? options.resume });

let calls = 0;
setQuery(({ prompt, options }) => {
  calls += 1;
  const gen = (async function* () {
    const stream = prompt[Symbol.asyncIterator]();
    const first = (await stream.next()).value;
    yield init(options);
    yield { ...first, isReplay: true, session_id: options.sessionId ?? options.resume };
    yield ev({ type: "message_start", message: { id: "msg_1", usage: {} } });
    yield ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "mcp__custom-tools__bash", input: {} } });
    yield ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: `echo written > ${MARKER} || echo "write refused"; echo PWD=$(pwd)` }) } });
    yield ev({ type: "content_block_stop", index: 0 });
    yield ev({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} });
    yield ev({ type: "message_stop" });
    // Park: the bridge answers the parked MCP handler once Pi has executed the tool.
    await new Promise(() => {});
  })();
  gen.interrupt = async () => {};
  gen.close = () => {};
  return gen;
});

const observedToolCalls = [];
const loader = new DefaultResourceLoader({
  cwd: CWD,
  agentDir: AGENT_DIR,
  settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  ...(mode === "guard" ? { additionalExtensionPaths: [guardPath] } : {}),
  extensionFactories: [
    bridge.default,
    (pi) => {
      pi.on("tool_call", (event) => {
        observedToolCalls.push(event.toolName);
        return undefined;
      });
    },
  ],
});
await loader.reload();
const errors = loader.getExtensions?.().errors ?? [];
if (errors.length) console.log(JSON.stringify({ extensionErrors: errors.map(String) }));

const settings = SettingsManager.inMemory({ retry: { enabled: false } });
const { session } = await createAgentSession({
  cwd: CWD,
  agentDir: AGENT_DIR,
  resourceLoader: loader,
  settingsManager: settings,
  sessionManager: SessionManager.inMemory(CWD),
  noTools: "builtin",
  tools: ["bash"],
  model: {
    id: "claude-sonnet-4-6", name: "Bridge probe", api: "claude-bridge", provider: "claude-bridge",
    baseUrl: "claude-bridge", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
});

try {
  // The fake query never returns a final result, so this races a timeout by design: the probe
  // asserts on the tool execution, not on turn completion.
  const result = await Promise.race([
    session.prompt("Write the marker file with bash.").then(() => "prompt-returned"),
    new Promise((r) => setTimeout(() => r("timeout"), 45000)),
  ]);
  const toolResults = session.messages
    .filter((m) => m.role === "toolResult")
    .map((m) => ({ toolName: m.toolName, isError: m.isError, content: JSON.stringify(m.content).slice(0, 400) }));
  console.log(JSON.stringify({
    mode,
    prompt: result,
    toolCallHandlersSaw: observedToolCalls,
    activeTools: session.getActiveToolNames(),
    markerExists: existsSync(MARKER),
    markerPath: MARKER,
    toolResults,
    providerStreamCalls: calls,
  }, null, 1));
} finally {
  try { await session.abort(); } catch {}
  session.dispose();
  activeQueryContexts.clear();
  resetSharedSession();
}
process.exit(0);
