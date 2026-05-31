# PROBLEM
Add field `x` to type `Foo` in `src/foo.ts`.

# SUCCESS
- `Foo` has new field `x: string`
- Diff stays within `src/foo.ts`

# SCOPE
- Only `src/foo.ts`
- Only the `Foo` type update

# NON_GOALS
- No refactors
- No unrelated module edits

# VALIDATION
- Diff only touches `src/foo.ts`
- Implementation is type-safe
