---
name: beads
description: >-
  Legacy Beads compatibility and migration intake only. Use when an explicitly
  Beads-backed legacy Specialists surface still requires bd, when inspecting
  historical Beads state, or when preparing/importing Beads data into Substrate.
  Do not use this skill as the durable-work doctrine for native/current XTRM work.
---

# Beads — legacy compatibility only

> **XTRM cutover:** Substrate owns durable work. For current work use the
> `using-substrate` and `using-xtrm` doctrine. Historical Beads IDs may resolve as
> Substrate aliases, but an alias is not work authority.

Use this skill only when one of these is true:

- the active command is explicitly documented as a legacy Beads-backed `sp` / Supervisor / NodeSupervisor surface;
- migration or archaeology requires reading historical Beads state;
- an import/alias reconciliation step explicitly requires `bd`.

Do not generalize legacy commands into native Specialist procedure.

## Native/current rule

For native/current XTRM work:

```text
pinned ready Substrate Issue revision = executable contract
Journal                            = continuity/findings/results
Specialist settlement              = evidence
Closure                            = explicit durable authority
Git                                = code/integration truth
```

Never replace that lifecycle with `bd show`, `bd update --claim`, notes, or `bd close`.

## Legacy compatibility

When an explicitly legacy surface genuinely requires a Beads ID:

- copy the ID exactly from authoritative compatibility context or command output;
- do not infer or regenerate it;
- keep the operation scoped to that compatibility path;
- do not treat Beads status/notes as authority for a native activation;
- do not create parallel durable work in both trackers.

Use `bd --help` for exact syntax because legacy CLI details may continue to change during XTRM-93.
