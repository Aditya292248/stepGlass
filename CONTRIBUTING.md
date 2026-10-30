# Contributing to Stepglass

Thanks for helping. This guide covers setup, the checks your change must pass, and how we review.

## Setup

1. Install Node.js 24 (`.nvmrc`), pnpm 10 (`corepack enable`), and Docker.
2. Install dependencies and start Postgres:

   ```bash
   pnpm install
   cp .env.example .env
   docker compose up -d
   ```

## Everyday commands

| Command                        | What it does                                           |
| ------------------------------ | ------------------------------------------------------ |
| `pnpm lint`                    | Biome lint/format check, then the layer-boundary check |
| `pnpm format`                  | Apply Biome formatting and safe fixes                  |
| `pnpm typecheck`               | Type-check every package                               |
| `pnpm test`                    | Run every package's Vitest suite                       |
| `pnpm --filter <package> test` | Run one package's tests                                |

CI runs `lint`, `typecheck` and `test` on every pull request.

## Architecture rules

- **Layers.** `apps/` and `packages/` are the domain-agnostic core. Domain code lives in
  `connectors/` (reusable tool packs) and `scenarios/` (demos). The core must not import or depend
  on either, and must not contain domain words; `tooling/boundaries` enforces this.
- **Evidence.** A tool reporting success is never proof of a business outcome. Changes are labeled
  verified, reported or unknown, and missing evidence yields `unknown`, never `pass`.
- **Checks decide, AI explains.** Check results come only from the deterministic engine. Recorded
  trace text must never change a check result or trigger a tool.
- **Tests use real dependencies.** Integration tests run against real Postgres. Only LLM calls may
  be stubbed.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(checks): add value
  assertions`, `fix(api): reject oversized batches`, `docs: …`, `chore: …`, `ci: …`, `test: …`.
- Keep each commit focused; it should build and pass tests on its own.
- Keep pull requests small (roughly 300–600 changed lines, excluding lockfiles) and describe what
  changed, why, and how you tested it. The PR template walks through this.
- Don't hand-merge `pnpm-lock.yaml`; rebase and run `pnpm install` instead.

## Reporting issues

Use the issue templates for bugs and feature requests. Report security vulnerabilities privately as
described in [SECURITY.md](SECURITY.md), never in a public issue.
