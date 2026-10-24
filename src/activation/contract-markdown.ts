// The single projection from a structured work contract to the 7-section markdown the
// prompt surface reads. It lives on its own so the lightweight read-only render path
// can use it without loading the activation host (SPECIALISTS-4353).

/** Render a structured work contract back to the 7-section layout the prompt surface reads. */
export function contractToMarkdown(contract: unknown): string {
  if (contract === null || typeof contract !== 'object') return '';
  const c = contract as Record<string, unknown>;
  const lines: string[] = [];
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x !== null ? Object.values(x as Record<string, unknown>).filter((y) => typeof y === 'string').join(': ') : String(x))) : []);
  const problem = text(c['problem']);
  if (problem) lines.push(`PROBLEM: ${problem}`);
  const success = text(c['success']);
  if (success) lines.push(`SUCCESS: ${success}`);
  const sections: Array<[string, unknown]> = [
    ['SCOPE', c['scope']],
    ['NON_GOALS', c['nonGoals']],
    ['CONSTRAINTS', c['constraints']],
    ['VALIDATION', c['validation']],
    ['OUTPUT', c['output']],
  ];
  for (const [name, value] of sections) {
    const items = list(value);
    if (items.length === 0) continue;
    lines.push(`${name}:`);
    for (const item of items) lines.push(`- ${item}`);
  }
  return lines.join('\n');
}
