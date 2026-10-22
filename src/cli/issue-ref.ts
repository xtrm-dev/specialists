// Shared `--issue-ref` / `--bead` / `--bead-id` resolution.
//
// `--issue-ref` is the primary spelling. `--bead` and `--bead-id` are permanent
// compatibility aliases for the same Substrate Issue locator. All three feed the
// same input: there is no parallel code path, and supplying more than one
// distinct value fails closed rather than picking one.

export interface IssueRefInput {
  issueRef?: string;
  bead?: string;
  beadId?: string;
}

export function resolveIssueRef(input: IssueRefInput): string | undefined {
  const candidates: string[] = [];
  if (input.issueRef?.trim()) candidates.push(input.issueRef.trim());
  if (input.bead?.trim()) candidates.push(input.bead.trim());
  if (input.beadId?.trim()) candidates.push(input.beadId.trim());
  const distinct = [...new Set(candidates)];
  if (distinct.length > 1) {
    throw new Error(
      `Conflicting --issue-ref/--bead values (${distinct.join(' vs ')}). ` +
        `Supply one value: --issue-ref <id> (primary; --bead/--bead-id are permanent compatibility aliases).`,
    );
  }
  return distinct[0];
}
