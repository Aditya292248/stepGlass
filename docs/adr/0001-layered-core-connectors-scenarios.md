# 0001. Separate a domain-agnostic core from connectors and scenarios

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Stepglass must work for any agent, but its demos are concrete: an email agent, a refund agent. If
demo logic leaks into the core, every new domain needs core changes, and the claim "works for any
agent" stops being true without anyone noticing.

## Decision

- The core (`apps/`, `packages/`) holds only domain-agnostic code.
- Reusable tool packs for real systems live in `connectors/`; demos live in `scenarios/`.
- Domain knowledge reaches the core as data: tool descriptors, check bundles and lessons.
- A lint step (`tooling/boundaries`) fails the build if core code imports a connector or scenario,
  depends on one, or contains a domain word.

## Consequences

- Adding a domain means adding a connector and, optionally, a scenario, with no core change.
- The core's tests use neutral fixtures, so they can't accidentally depend on demo behavior.
- The word list in the boundary check is a blunt instrument and may need an allow mechanism later
  if a generic term collides with it.
