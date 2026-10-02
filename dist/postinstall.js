// src/pi/native-specialists-registration.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var CURRENT = "/pi-extensions/native-specialists";
var LEGACY = "/pi-extensions/specialist-subagents";
var REL = join("config", "pi-extensions", "native-specialists");
function getNativeSpecialistsExtensionPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", REL), join(here, "..", "..", REL)]) {
    if (existsSync(join(candidate, "index.mjs")))
      return resolve(candidate);
  }
  return null;
}
function getPiSettingsPath(env = process.env) {
  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, "settings.json");
}
function sourceOf(entry) {
  const source = typeof entry === "string" ? entry : entry?.source;
  return typeof source === "string" ? source.replace(/\/+$/, "") : "";
}
function withSource(entry, source) {
  return typeof entry === "string" ? source : { ...entry, source };
}
function registerNativeSpecialists(bundledPath = getNativeSpecialistsExtensionPath(), settingsPath = getPiSettingsPath()) {
  if (!bundledPath)
    return { status: "skipped", settingsPath, reason: "bundled extension not found" };
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
      settings = parsed;
    } catch (error) {
      return { status: "skipped", settingsPath, reason: `unreadable settings: ${error.message}` };
    }
  }
  if (settings.packages !== undefined && !Array.isArray(settings.packages)) {
    return { status: "skipped", settingsPath, reason: "`packages` is not an array" };
  }
  const packages = [...settings.packages ?? []];
  const current = packages.find((entry) => sourceOf(entry).endsWith(CURRENT));
  let source = current ? sourceOf(current) : bundledPath;
  let legacyFound = false;
  const next = [];
  for (const entry of packages) {
    const entrySource = sourceOf(entry);
    if (!entrySource.endsWith(LEGACY)) {
      next.push(entry);
      continue;
    }
    if (current || legacyFound) {
      legacyFound = true;
      continue;
    }
    legacyFound = true;
    const sibling = entrySource.slice(0, -LEGACY.length) + CURRENT;
    source = existsSync(join(sibling, "index.mjs")) ? sibling : bundledPath;
    next.push(withSource(entry, source));
  }
  if (!current && !legacyFound)
    next.push(bundledPath);
  const status = legacyFound ? "migrated" : current ? "present" : "added";
  if (status === "present")
    return { status, settingsPath, source };
  settings.packages = next;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}
`);
  return { status, settingsPath, source };
}

// src/postinstall.ts
var isGlobal = process.env.npm_config_global === "true" || process.env.npm_config_location === "global";
if (isGlobal && process.env.SPECIALISTS_SKIP_PI_REGISTRATION !== "1") {
  try {
    const result = registerNativeSpecialists();
    if (result.status === "skipped") {
      console.warn(`specialists: Pi extension not registered (${result.reason}); run \`sp init --global\` later.`);
    } else if (result.status !== "present") {
      console.log(`specialists: native-specialists Pi extension ${result.status} in ${result.settingsPath}`);
    }
  } catch (error) {
    console.warn(`specialists: Pi extension registration failed: ${error.message}`);
  }
}
