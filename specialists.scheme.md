---
title: specialists.scheme
date_created: Tuesday, May 12th 2026, 7:26:49 am
date_modified: Tuesday, May 12th 2026, 7:34:20 am
---
# Specialists as an Agent Mind

This note sketches why `specialists` is not just “many agents”, but a way to keep an orchestrator coherent while delegating cognition into fresh, scoped, contract-bound sessions.
The core idea: a single long-running agent chat accumulates context, bias, stale assumptions, and task residue. A specialist pipeline lets the orchestrator stay central while spawning short-lived expert contexts that receive only the contract, rules, and evidence they need.

## 1. Single-agent chat: everything accumulates in one mind

```mermaid
flowchart TD
  U[User asks task] --> A[One long agent chat]
  A --> C1[Reads project context]
  C1 --> C2[Investigates]
  C2 --> C3[Plans]
  C3 --> C4[Implements]
  C4 --> C5[Runs tests]
  C5 --> C6[Reviews own work]
  C6 --> C7[Fixes review findings]
  C7 --> C8[Explains / closes]
  C1 --> R[Context residue]
  C2 --> R
  C3 --> R
  C4 --> R
  C5 --> R
  C6 --> R
  C7 --> R
  R --> A
  R --> Rot[Context rot]
  R --> Drift[Goal drift]
  R --> Bias[Self-confirmation bias]
  R --> Noise[Prompt noise]
  R --> Fatigue[Instruction fatigue]
  Rot --> Bad[Lower-quality decisions]
  Drift --> Bad
  Bias --> Bad
  Noise --> Bad
  Fatigue --> Bad
```
In the single-chat model, the agent is doing every cognitive role in the same context window:
- explorer
- planner
- implementer
- tester
- reviewer
- debugger
- security reviewer
- memory keeper
- release operator
That sounds convenient, but each step leaves residue. Old hypotheses, abandoned plans, partial files, failed commands, stale assumptions, and emotional momentum all stay in the same working memory.
The agent begins to carry too much of its own history.
Over time, the session starts behaving less like a clean reasoning system and more like a tired developer with too many browser tabs open.

## 2. Failure modes of the single-agent model

```mermaid
flowchart LR
  LongSession[Long single session] --> ContextRot[Context rot]
  LongSession --> Anchoring[Anchoring on early hypothesis]
  LongSession --> SelfReview[Self-review bias]
  LongSession --> ToolResidue[Tool/output residue]
  LongSession --> ScopeCreep[Scope creep]
  LongSession --> ForgottenConstraints[Forgotten constraints]
  ContextRot --> Symptoms[Symptoms]
  Anchoring --> Symptoms
  SelfReview --> Symptoms
  ToolResidue --> Symptoms
  ScopeCreep --> Symptoms
  ForgottenConstraints --> Symptoms
  Symptoms --> S1[Reviews become vibes]
  Symptoms --> S2[Tests mirror implementation]
  Symptoms --> S3[Fixes chase symptoms]
  Symptoms --> S4[Issue contract ignored]
  Symptoms --> S5[Context window fills with irrelevant details]
```
The dangerous part is not only token count. The dangerous part is cognitive contamination.
A long session makes it easier for the agent to:
- defend its own implementation during review
- test what it built instead of what the issue asked for
- keep following an early wrong hypothesis
- silently widen scope
- forget old constraints buried thousands of tokens back
- treat completion claims as evidence

## 3. Specialist pipeline: orchestrator as central mind

```mermaid
flowchart TD
  U[User / project need] --> O[Orchestrator]
  O --> IC[Issue contract]
  IC --> CV[Contract validation]
  CV -->|ready| O
  CV -->|not ready| Repair[Improve issue contract]
  Repair --> IC
  O --> E1[Explorer\nfresh context]
  O --> P[Planner\nfresh context]
  O --> X[Executor\nfresh context]
  O --> TW[Test-writer\nfresh context]
  O --> TR[Test-runner\nfresh context]
  O --> CS[Code-sanity\nfresh context]
  O --> SA[Security-auditor\nfresh context]
  O --> R[Reviewer\nfresh context]
  IC --> E1
  IC --> P
  IC --> X
  IC --> TW
  IC --> TR
  IC --> CS
  IC --> SA
  IC --> R
  Rules[Mandatory rules] --> E1
  Rules --> P
  Rules --> X
  Rules --> TW
  Rules --> TR
  Rules --> CS
  Rules --> SA
  Rules --> R
  Results[Structured handoffs / evidence] --> O
  E1 --> Results
  P --> Results
  X --> Results
  TW --> Results
  TR --> Results
  CS --> Results
  SA --> Results
  R --> Results
  O --> Decision[Next orchestration decision]
  Results --> Decision
  Decision --> O
```
In the specialist model, the orchestrator does not try to become every expert itself.
Instead, it keeps the global thread:
- what the user wants
- what the issue contract says
- which specialist should run next
- what evidence has been produced
- whether the chain is allowed to continue
- whether the work is done
The specialists are spawned as fresh, narrow cognitive modules.
Each specialist receives:
- the issue contract
- role-specific system prompt
- mandatory rules
- scoped context
- relevant prior evidence
- output contract
Then it returns a structured handoff.
The orchestrator keeps continuity without filling its own context with every implementation detail.

## 4. The human mind analogy

This is close to how a human mind works when it is healthy.
You do not keep every low-level motor action, memory, belief, and skill in conscious attention all at once. You have a central executive that delegates to specialized subsystems:
```mermaid
flowchart TD
  Conscious[Central executive / attention] --> Vision[Visual system]
  Conscious --> Motor[Motor skill]
  Conscious --> Language[Language faculty]
  Conscious --> Memory[Episodic memory]
  Conscious --> Critic[Internal critic]
  Conscious --> Planning[Planning faculty]
  Vision --> Conscious
  Motor --> Conscious
  Language --> Conscious
  Memory --> Conscious
  Critic --> Conscious
  Planning --> Conscious
```
You do not consciously compute every word, muscle movement, and perceptual edge. Specialized systems do their work and report back.
`specialists` gives an AI agent a similar structure:
```mermaid
flowchart TD
  O[Orchestrator\ncentral executive] --> Explorer[Explorer\nmap code]
  O --> Debugger[Debugger\nfind root cause]
  O --> Executor[Executor\nmake scoped change]
  O --> TestWriter[Test-writer\nwrite behavior tests]
  O --> TestRunner[Test-runner\nexecute/classify tests]
  O --> Reviewer[Reviewer\njudge against contract]
  O --> Memory[Memory processor\nstore durable lessons]
  Explorer --> O
  Debugger --> O
  Executor --> O
  TestWriter --> O
  TestRunner --> O
  Reviewer --> O
  Memory --> O
```
The orchestrator remains the “self”.
The specialists are capabilities and bounded memories that can be activated without permanently polluting the central context.

## 5. Contract-bound cognition

The crucial mechanism is the issue contract.
Without a good contract, specialists are just fragmented chaos. With a good contract, each specialist has a narrow frame and a clear success target.
```mermaid
flowchart LR
  BadIssue[Vague issue] --> BadPrompt[Vague prompt]
  BadPrompt --> BadRun[Drifty specialist run]
  BadRun --> WeakEvidence[Weak evidence]
  WeakEvidence --> BadReview[Review by vibes]
  GoodIssue[Precise issue contract] --> GoodPrompt[Scoped specialist prompt]
  GoodPrompt --> GoodRun[Focused specialist run]
  GoodRun --> Evidence[Concrete evidence]
  Evidence --> GoodReview[Review against acceptance criteria]
```
A dispatchable issue should say:
- problem
- desired outcome
- scope
- non-goals
- acceptance criteria
- validation
- dependencies
- risk
- suggested chain
- issue-local mandatory rules
Then each specialist can work from the same contract, but from a fresh context.

## 6. Context engineering instead of context hoarding

Single-agent sessions often hoard context:
```text
read everything → keep everything → reason in one giant window
```
Specialist orchestration uses context engineering:
```text
contract → select role → inject only relevant context → require structured output
```
```mermaid
flowchart TD
  AllContext[All possible project context] --> Filter[Context engineering]
  Contract[Issue contract] --> Filter
  Role[Specialist role] --> Filter
  Rules[Mandatory rules] --> Filter
  Filter --> Prompt[Small focused prompt]
  Prompt --> Fresh[Fresh specialist session]
  Fresh --> Handoff[Structured handoff]
  Handoff --> Orchestrator[Orchestrator memory]
```
The aim is not to give every agent everything.
The aim is to give each agent exactly what lets it make a good local decision.

## 7. Full-ish specialist pipeline

A strong implementation chain looks like this:
```mermaid
flowchart TD
  Issue[Issue contract] --> Validate[Contract validator]
  Validate -->|ready| Explore{Need discovery?}
  Validate -->|not ready| Improve[Orchestrator improves issue]
  Improve --> Validate
  Explore -->|yes| Explorer[Explorer]
  Explore -->|no| Implement
  Explorer --> Implement[Executor or Debugger]
  Implement --> TestNeed{Need tests?}
  TestNeed -->|yes| TestWriter[Test-writer]
  TestNeed -->|no| TestRunner
  TestWriter --> TestRunner[Test-runner]
  TestRunner --> Sanity[Code-sanity]
  Sanity --> SecurityNeed{Security/input/config risk?}
  SecurityNeed -->|yes| Security[Security-auditor]
  SecurityNeed -->|no| Review
  Security --> Review[Reviewer]
  Review -->|PASS| Merge[Merge / close]
  Review -->|PARTIAL| Resume[Resume responsible specialist]
  Review -->|FAIL| Rework[Rework or re-scope]
  Resume --> TestRunner
  Rework --> Implement
```
Not every task needs the full chain. The point is that the orchestrator chooses deliberately instead of letting one chat absorb every role.

## 8. Why this reduces drift

Specialists reduce drift because each role starts clean.
Executor does not carry the whole planning debate.
Reviewer does not share the executor’s self-justification.
Test-writer can be told to test the contract, not the implementation.
Security-auditor does not inherit the implementer’s optimism.
Code-sanity can look only for maintainability and type-risk.
```mermaid
flowchart LR
  Contract[Same issue contract] --> Executor[Executor fresh session]
  Contract --> TestWriter[Test-writer fresh session]
  Contract --> Reviewer[Reviewer fresh session]
  Executor --> Diff[Implementation diff]
  TestWriter --> Tests[Behavior tests]
  Reviewer --> Verdict[Independent verdict]
  Diff --> Orchestrator
  Tests --> Orchestrator
  Verdict --> Orchestrator
```
The orchestrator then compares independent outputs against the same contract.
That is the real advantage: independence with shared constraints.

## 9. What the orchestrator becomes

The orchestrator is not “the agent doing all work”.
It is closer to:
- working memory
- executive function
- scheduler
- judge of readiness
- context router
- evidence integrator
- keeper of task identity
```mermaid
flowchart TD
  O[Orchestrator] --> Readiness[Checks contract readiness]
  O --> Routing[Chooses specialist chain]
  O --> Context[Builds scoped context]
  O --> Monitor[Monitors jobs]
  O --> Integrate[Integrates evidence]
  O --> Decide[Decides next step]
  O --> Close[Closes with proof]
```
Specialists become capabilities the orchestrator can invoke without becoming them.
This lets the system scale task complexity without turning the central session into an overloaded memory dump.

## 10. Short version

Single-agent chat:
```text
One mind does everything → context fills → bias/drift/rot accumulates → self-review weakens.
```
Specialist pipeline:
```text
Central orchestrator keeps identity → specialists run fresh scoped cognition → structured evidence returns → reviewer checks contract.
```
Human analogy:
```text
Conscious attention does not contain every skill. It invokes specialized faculties, receives results, and decides what to do next.
```
For agents, `specialists` is that architecture.
It turns one overloaded chat into a coordinated mind with bounded expert subprocesses.

## 11. Herd memory system

The specialist system should not remember by stuffing everything into one orchestrator context.
It should remember through the herd.

Each specialist run produces artifacts:

- structured handoff
- investigation report
- root cause explanation
- test evidence
- review verdict
- runtime observation
- follow-up issue
- memory note

Those artifacts become shared memory for future runs.

```mermaid
flowchart TD
  Explorer[Explorer] --> H1[Architecture map]
  Debugger[Debugger] --> H2[Root cause report]
  Executor[Executor] --> H3[Implementation summary]
  TestWriter[Test-writer] --> H4[Behavior coverage]
  TestRunner[Test-runner] --> H5[Test evidence]
  Reviewer[Reviewer] --> H6[Verdict and gaps]
  Service[Service specialist] --> H7[Runtime observations]

  H1 --> Herd[Herd memory system]
  H2 --> Herd
  H3 --> Herd
  H4 --> Herd
  H5 --> Herd
  H6 --> Herd
  H7 --> Herd

  Herd --> Retrieval[Task-specific retrieval]
  Retrieval --> Orchestrator[Orchestrator]
  Retrieval --> Future[Future specialist run]
```

The herd remembers through artifacts, not through one giant context window.

This matters because memory becomes queryable, compressible, and attributable. A future debugger can retrieve the prior root-cause report without inheriting the entire emotional and tool-output history of the previous session. A future reviewer can inspect evidence without carrying the executor’s self-justification. The orchestrator can stay light while still having access to durable collective memory.

## 12. Adaptive pipelines

There is no single correct specialist chain.

The orchestrator should choose a pipeline based on task shape, issue contract, risk, and available evidence.

```mermaid
flowchart TD
  Task[Task / issue contract] --> Router[Pipeline router]

  Router --> Bug[Unknown-cause bug]
  Router --> Feature[Scoped feature]
  Router --> Architecture[Risky architecture]
  Router --> ServiceRuntime[Service/runtime issue]
  Router --> Docs[Documentation sync]
  Router --> Memory[Memory consolidation]

  Bug --> B1[debugger]
  B1 --> B2[test-writer]
  B2 --> B3[test-runner]
  B3 --> B4[reviewer]

  Feature --> F1[executor]
  F1 --> F2[test-writer]
  F2 --> F3[test-runner]
  F3 --> F4[code-sanity]
  F4 --> F5[reviewer]

  Architecture --> A1[explorer]
  A1 --> A2[overthinker]
  A2 --> A3[planner]
  A3 --> A4[executor]
  A4 --> A5[reviewer]

  ServiceRuntime --> S1[service specialist]
  S1 --> S2[process monitor]
  S2 --> S3[debugger or executor if needed]
  S3 --> S4[reviewer]

  Docs --> D1[researcher]
  D1 --> D2[sync-docs]
  D2 --> D3[reviewer]

  Memory --> M1[memory-processor]
  M1 --> M2[herd memory update]
```

Examples:

```text
bug unknown cause:
debugger → test-writer → test-runner → reviewer

feature scoped:
executor → test-writer → test-runner → code-sanity → reviewer

risky architecture:
explorer → overthinker → planner → executor → reviewer

service/runtime issue:
service-specialist → process monitor → debugger/executor if needed → reviewer

knowledge/doc sync:
researcher → sync-docs → reviewer

memory consolidation:
memory-processor → herd memory update
```

The pipeline is itself part of the orchestration decision. A good orchestrator does not blindly run the same chain every time. It routes cognition.

## 13. Service specialists and long-running processes

Some specialists are not one-shot workers.

A service specialist can own a long-running process, monitor it, summarize it, and alert the orchestrator only when something meaningful changes.

```mermaid
sequenceDiagram
  participant O as Orchestrator
  participant S as Service specialist
  participant P as Long-running process
  participant M as Herd memory

  O->>S: Start service contract
  S->>P: Launch / attach / monitor
  P-->>S: Logs, health, errors, events
  S-->>O: Status summaries and alerts
  S-->>M: Runtime observations
  O->>S: Steer, resume, or stop
```

This is different from executor/debugger work.

A service specialist behaves more like a daemon faculty: it maintains a relationship with a runtime surface without forcing the orchestrator to keep raw logs, health checks, stack traces, and timing observations in central context.

Useful service-specialist responsibilities:

- run dev servers
- monitor test watchers
- track logs
- watch health endpoints
- summarize recurring failures
- detect readiness transitions
- preserve runtime observations into herd memory
- wake the orchestrator only for meaningful events

This is especially important for long-running test and preflight flows. Long runs are valuable stress harnesses, but their raw output should not become orchestrator context rot.

## 14. User specialists as custom faculties

Package specialists are the base faculties.
User specialists are custom faculties.

The specialists in paths like:

```text
/home/dawid/second-mind/.specialists/user
```

are examples of how the mind extends itself for personal or project-specific work.

```mermaid
flowchart TD
  O[Orchestrator] --> Package[Package specialists]
  O --> User[User specialists]
  O --> Project[Project specialists]

  Package --> Base[Base faculties: debugger, executor, reviewer]
  User --> Custom[Custom faculties: personal workflows, vault-aware agents, domain specialists]
  Project --> Domain[Project faculties: service/runtime/domain-specific workers]

  Base --> O
  Custom --> O
  Domain --> O
```

This makes the system extensible in the same way a person develops new skills.

The core mind does not need to permanently contain every domain. It can install or author a new specialist, then invoke that specialist when the right contract appears.

That means the specialists ecosystem is not just parallelization. It is a growing capability graph.

## 15. Updated short version

Single-agent chat:

```text
One mind does everything → context fills → bias/drift/rot accumulates → self-review weakens.
```

Specialist pipeline:

```text
Central orchestrator keeps identity → specialists run fresh scoped cognition → structured evidence returns → reviewer checks contract.
```

Herd memory:

```text
The system remembers through durable artifacts and retrieval, not by keeping every run in one context window.
```

Adaptive pipelines:

```text
Task shape chooses chain. Bug, feature, architecture, service runtime, docs, and memory work use different specialist paths.
```

Service specialists:

```text
Long-running processes are monitored by dedicated faculties, not by bloating orchestrator context with raw logs.
```

User specialists:

```text
Custom faculties extend the mind for personal, project, and domain-specific work.
```

For agents, `specialists` is a coordinated mind: central executive, fresh expert faculties, herd memory, and adaptable pipelines.
