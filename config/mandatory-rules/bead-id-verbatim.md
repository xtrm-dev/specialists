# bead-id-verbatim

## Rule
Source bead-id arguments verbatim from injected context: `bead_id`, branch name, prior turn output, or `bd create` output. Do not retype bead ids from memory or regenerate them.

## Command scope
Applies only to bd commands that take a bead id, especially `bd close`, `bd update`, `bd dep add`, `bd dep list`, and `bd show`.

## Legit cases
- New bead creation: id may not exist yet; once `bd create` returns it, copy exact text forward.
- Narrative prose: may mention bead ids freely. Only command arguments must be verbatim.

## Failure example
Today logs showed `unitAI-m8744.2` and `unitAI-m8744.3` retyped as `unitAI-m87442` and `unitAI-m87443`; `bd close` then failed with `issue id not found`.
