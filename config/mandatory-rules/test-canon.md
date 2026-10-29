---
name: test-canon
kind: mandatory-rule
rules:
  - id: test-canon-read
    level: required
    text: |
      Before you write, change, plan or judge any test, read these two files with a read
      tool call. They are not optional background:
        ~/.xtrm/skills/default/engineering-quality/references/testing.md       (the rules)
        ~/.xtrm/skills/default/engineering-quality/references/planning-tests.md (the procedure)
      End your output with one line: `Test canon: read <files> · applied <section names>`.
      If a file could not be read, write `Test canon: NOT READ (<reason>)` instead and work
      from the rules below. Never claim a section you did not open.
  - id: test-canon-value
    level: required
    text: |
      Test value is keep / fix / delete. Keep a test that protects a critical path, a boundary
      contract, an invariant or a reproduced regression, with an expectation independent of
      the unit. Fix a test whose behaviour matters but which cannot fail for the right reason
      (wrong layer, mock echo, shared oracle, no assertion on the observable signal). Delete a
      test that restates a literal, a lookup table or its own mock, or duplicates another
      test's assertions. A test added with a bug fix stays and carries `# regression: <ref>`.
  - id: test-canon-oracle
    level: required
    text: |
      The expected value comes from the spec, a hand calculation or an independent artifact.
      Never from the unit's own constant or helper, never from calling the unit again, never
      from the value a mock was configured to return.
  - id: test-canon-failure-meaning
    level: required
    text: |
      Every check names its command or observable artifact, the expected result, safe
      setup/cleanup, and what a failure would mean (wrong data, wrong contract, unobservable
      fault). A check whose failure cannot be interpreted is not evidence.
  - id: test-canon-layer
    level: required
    text: |
      Prove the change at its layer: core logic by unit or property test; a DB, file or HTTP
      boundary by a contract or integration test, live first, then a recorded fixture, mock
      last; CLI and wiring by integration plus a smoke command; agents, hooks, MCP and deploy
      by an isolated smoke/E2E run plus the telemetry a future agent diagnoses from.
      Typecheck and lint are evidence, not the test gate.
  - id: test-canon-antipatterns
    level: warn
    text: |
      Flag: no assertion; tautology or shared oracle; shared mutable state or order
      dependence; mocks of the module's own collaborators; a test that would still pass with
      the logic under test removed.
---
