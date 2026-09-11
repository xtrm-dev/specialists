// src/tools/substrate/issue.tool.ts
//
// MCP surface over Substrate's IssueService (unitAI-aiwva.9).
//
// ONE op-discriminated tool rather than eight named ones. The 2026-07-28 tool list is
// static and asserted in deterministic order by the packaged-plugin harness, so every
// new name is permanent surface area; eight issue verbs would nearly double a 7-tool
// server to describe one domain. The op enum costs one field and keeps the surface
// legible.
//
// The service is INJECTED, never imported. `@xtrm/substrate` is unpublished and cannot
// load under bun today (it hard-imports node:sqlite, which bun lacks), so a module-scope
// import would make the whole server fail to start on the runtime we actually ship.
// Injection also lets the unit tests drive a fake and lets the tool light up unchanged
// the moment Substrate becomes reachable. See src/substrate/services.ts.
//
// Payloads are bounded and reference-first. `specialist_status` shipped a 2.19 MB
// response because one section was unbounded (unitAI-aiwva.8); nothing here returns an
// uncapped collection or an untruncated contract body.
import * as z from 'zod';
import { resolveSubstrate, substrateUnavailablePayload } from '../../substrate/services.js';

/** Max rows any list-shaped op returns. Totals are reported alongside. */
const MAX_ROWS = 50;
/** Max characters of any free-text body (contract sections, descriptions). */
const MAX_BODY = 4000;

export const substrateIssueSchema = z.object({
  op: z
    .enum(['resolve', 'get', 'create', 'update_contract', 'project_resolve', 'project_create', 'link_checkout', 'list_links'])
    .describe('Which IssueService operation to run.'),
  ref: z.string().optional().describe('Issue ref for "resolve" (e.g. a prefix-numbered id).'),
  issue_id: z.string().optional().describe('Issue id for "get" and "update_contract".'),
  contract: z.record(z.unknown()).optional().describe('Contract object for "create" and "update_contract".'),
  title: z.string().optional().describe('Title for "create".'),
  project_id: z.string().optional().describe('Project id for "create", "project_resolve" and "link_checkout".'),
  prefix: z.string().optional().describe('Project prefix for "project_create".'),
  name: z.string().optional().describe('Project name for "project_create".'),
  git_root: z.string().optional().describe('Checkout path for "link_checkout".'),
  idempotency_key: z.string().optional().describe('Idempotency key for "create".'),
});

type Input = z.infer<typeof substrateIssueSchema>;

/** Truncate a body rather than dropping it: a marker is debuggable, an omission is not. */
function body(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.length <= MAX_BODY) return value;
  return { truncated: true, bytes: value.length, head: value.slice(0, MAX_BODY) };
}

function cap<T>(rows: readonly T[]): { rows: T[]; total: number; capped: boolean } {
  return { rows: rows.slice(0, MAX_ROWS), total: rows.length, capped: rows.length > MAX_ROWS };
}

/** Every op names the fields it needs, so a bad call is answered, not thrown. */
function require_(input: Input, fields: Array<keyof Input>): string | null {
  const missing = fields.filter((f) => input[f] === undefined || input[f] === null || input[f] === '');
  return missing.length > 0 ? `op "${input.op}" requires: ${missing.join(', ')}` : null;
}

interface IssueServiceLike {
  resolveRef(ref: string): unknown;
  getIssue(id: string): unknown;
  createIssue(input: unknown, opts?: { idempotencyKey?: string }): unknown;
  updateContract(id: string, contract: unknown): unknown;
  resolveProject(input: { explicit?: string }): unknown;
  createProject(input: { prefix: string; name: string }): unknown;
  linkCheckout(gitRoot: string, projectId?: string): unknown;
  listLinks(): readonly unknown[];
}

function project(issue: unknown): unknown {
  if (!issue || typeof issue !== 'object') return issue;
  const record = { ...(issue as Record<string, unknown>) };
  for (const key of ['contract', 'description', 'body', 'notes']) {
    if (key in record) record[key] = body(record[key]);
  }
  return record;
}

export function createSubstrateIssueTool(getIssues: () => IssueServiceLike | null = defaultIssues) {
  return {
    name: 'substrate_issue',
    description:
      'Read and write XTRM work items through Substrate IssueService. Substrate is the authority; ' +
      'this tool is transport. Ops: resolve, get, create, update_contract, project_resolve, ' +
      'project_create, link_checkout, list_links. create and update_contract MUTATE.',
    async execute(raw: unknown): Promise<unknown> {
      const input = substrateIssueSchema.parse(raw);
      const issues = getIssues();
      if (!issues) return substrateUnavailablePayload('substrate_issue', resolveSubstrate());

      try {
        switch (input.op) {
          case 'resolve': {
            const bad = require_(input, ['ref']);
            if (bad) return { status: 'error', error: bad };
            return { status: 'ok', issue: project(issues.resolveRef(input.ref as string)) };
          }
          case 'get': {
            const bad = require_(input, ['issue_id']);
            if (bad) return { status: 'error', error: bad };
            return { status: 'ok', issue: project(issues.getIssue(input.issue_id as string)) };
          }
          case 'create': {
            const bad = require_(input, ['title', 'contract', 'project_id']);
            if (bad) return { status: 'error', error: bad };
            const created = issues.createIssue(
              { title: input.title, contract: input.contract, projectId: input.project_id },
              input.idempotency_key ? { idempotencyKey: input.idempotency_key } : undefined,
            );
            return { status: 'ok', issue: project(created) };
          }
          case 'update_contract': {
            const bad = require_(input, ['issue_id', 'contract']);
            if (bad) return { status: 'error', error: bad };
            return { status: 'ok', issue: project(issues.updateContract(input.issue_id as string, input.contract)) };
          }
          case 'project_resolve': {
            const resolved = issues.resolveProject(input.project_id ? { explicit: input.project_id } : {});
            return { status: 'ok', project: resolved };
          }
          case 'project_create': {
            const bad = require_(input, ['prefix', 'name']);
            if (bad) return { status: 'error', error: bad };
            return {
              status: 'ok',
              project: issues.createProject({ prefix: input.prefix as string, name: input.name as string }),
            };
          }
          case 'link_checkout': {
            const bad = require_(input, ['git_root']);
            if (bad) return { status: 'error', error: bad };
            return {
              status: 'ok',
              link: issues.linkCheckout(input.git_root as string, input.project_id),
            };
          }
          case 'list_links': {
            const { rows, total, capped } = cap(issues.listLinks());
            return { status: 'ok', links: rows, total, capped };
          }
        }
      } catch (error) {
        // Substrate throws for genuine domain refusals (bad contract shape, unknown ref).
        // Those are answers, not transport failures: returning them as payload keeps the
        // refusal readable instead of collapsing it into an MCP error frame.
        return { status: 'error', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

function defaultIssues(): IssueServiceLike | null {
  const handle = resolveSubstrate();
  return handle.available ? (handle.services?.issues as IssueServiceLike) : null;
}
