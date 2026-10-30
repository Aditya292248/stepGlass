# @stepglass/checks

The deterministic check engine. It evaluates versioned check definitions (from
`@stepglass/schema`) over a session's recorded events and returns `CheckResult`s. Checks decide;
nothing here calls a model. The engine is pure and synchronous: no I/O, no clock, no randomness.
Results are stamped from the events themselves, and their IDs are UUIDv7s derived from the session
prefix, so the same input always yields the same output.

## API

```ts
import { evaluateBundle, inspectBundle, evaluateCheck, indexTrace } from '@stepglass/checks'

const results = evaluateBundle(bundle, events) // CheckResult[], one per check, in bundle order

const inspected = inspectBundle(bundle, events) // [{ result, expected }]
// `expected` lists steps a sequence rule required that were not recorded, for the UI's
// "Expected, not recorded" rows: { tool?, kind?, before: { actionId, tool?, eventId } }

const trace = indexTrace(events) // build once, then evaluate checks one at a time
const one = evaluateCheck(definition, trace)
```

Lower-level pieces are exported too: `evaluate(expr, ctx)` for a single expression (for example,
lesson conditions), the Kleene connectives `and3` / `or3` / `not3`, `happensBefore`, and `diffPaths`.

## Semantics of unknown

Every expression evaluates to a JSON value or `UNKNOWN`. `UNKNOWN` means "the recording does not
decide this", and it is never coerced to `false`, `null` or a pass.

- **Logic** is Kleene's strong three-valued logic: one `false` decides an `and`, one `true` decides
  an `or`, `not unknown` is `unknown`.
- **Missing data is unknown.** A missing field path, an unbound variable, an uncaptured or redacted
  payload, a missing snapshot, a non-integer where an integer is needed, a sum that leaves the
  safe-integer range, or a type mismatch all yield `unknown` with a machine-readable reason.
- **Incomplete recordings.** A recording is complete when the session started and finished, no
  `recording.gap` was reported, and every finish or snapshot has its action's start. Over an
  incomplete recording, lists of actions are _partial_: a witness still counts (`any`, `in`, a
  violation found), but claims about every element or about absence (`all`, `count`, `sum`, "never
  happened") are `unknown`.
- **Passes need evidence.** A pass cites at least one event (the schema requires it). Claims of
  absence cite the session's start and finish events, because they rest on the whole recording.
  A true assertion with nothing to cite is `unknown`.
- **Passes need verified evidence.** Reading object state (`snapshot`, `only_changed`) demands
  verification: if the action's evidence label (from `deriveEvidenceLabel`) is `reported` or
  `unknown`, for example a tool-reported snapshot or half a before/after pair, a pass becomes
  `unknown`. Weak evidence can still decide a fail.

## Operators

All of `CHECK_OPERATORS`, as `@stepglass/schema` defines them.

- `events` selects actions by kind, tool, status and `inputMatches` (which sees `action` and `input`).
  An action whose membership is undecidable makes the list partial.
- `snapshot` reads the first `before` or the last `after` state of an object.
- Ordering (`lt`, `lte`, `gt`, `gte`) is defined only on safe integers: money is in minor units and
  percentages are in basis points. `eq`, `ne` and `in` use structural JSON equality.
- A comparison with `measure` also emits a `Measurement` for the gauge: the left side is the value,
  the right side the limit, and the terms are the parts that should add up to the value. If any of
  those numbers is unknown, no gauge is emitted.
- `required_before`: every `second` action needs a `first` action that succeeded and finished
  before it started.
- `forbidden_after_unless`: no `forbidden` action may start after a `trigger` action is over,
  unless an `unless` action succeeded strictly in between.
- Happens-before uses `seq` within one producer and timestamps across producers. Equal
  cross-producer timestamps are `unknown`.
- `only_changed` diffs each object's first `before` against its last `after`, ignoring
  `computedFields`. A change outside the listed objects fails and names the changed paths. An
  unlisted object with half a pair is `unknown`, and so is a session with no snapshots at all.
  A write that records no snapshots is invisible to `only_changed`; its own evidence label
  (`reported`) is where that shows.
