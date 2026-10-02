#!/usr/bin/env node
// Summarize a bun --cpu-profile .cpuprofile: top functions by self time.
// Usage: node tests/perf/summarize-cpuprofile.mjs <file.cpuprofile>
import { readFileSync } from 'node:fs';

const prof = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
const total = prof.samples.reduce((acc, id, i) => {
  const node = byId.get(id);
  if (!node) return acc;
  const key = node.callFrame.functionName || '(anonymous)';
  const url = node.callFrame.url ? ` ${node.callFrame.url.replace(/^.*\/node_modules\//, 'nm:')}:${node.callFrame.lineNumber + 1}` : '';
  const k = `${key}${url}`;
  self.set(k, (self.get(k) ?? 0) + prof.timeDeltas[i]);
  return acc + prof.timeDeltas[i];
}, 0);

const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`total sampled: ${(total / 1000).toFixed(1)} ms`);
for (const [k, us] of top) console.log(`${(us / 1000).toFixed(0).padStart(8)} ms  ${k}`);
