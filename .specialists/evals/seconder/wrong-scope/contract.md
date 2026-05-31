# PROBLEM
Add field `x` to type `Foo` in `src/foo.ts`.

# SUCCESS
- `Foo` has new field `x: string`
- No unrelated files change

# SCOPE
- Only `src/foo.ts`
- Only type update for `Foo`

# NON_GOALS
- No refactors
- No unrelated module edits

# VALIDATION
- Diff only touches `src/foo.ts`
- No unrelated imports or logic changes
