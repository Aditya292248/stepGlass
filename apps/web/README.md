# @stepglass/web

The review UI: a page per recorded run showing what the agent did, why, and which checks passed.
Vite, React 19, TanStack Router and Query, Tailwind CSS v4.

The shell currently renders from typed fixtures in `src/fixtures/`; it makes no API calls yet.

## Develop

```bash
pnpm install
pnpm --filter @stepglass/schema build   # the app imports its types from dist/
pnpm --filter @stepglass/web dev        # http://localhost:5173
```

```bash
pnpm --filter @stepglass/web test       # Vitest + Testing Library on jsdom
pnpm --filter @stepglass/web typecheck
pnpm --filter @stepglass/web build      # static files in apps/web/dist
```

## Design tokens

Colours are CSS variables in `src/styles.css`, mapped to Tailwind colour names (`bg-raised`,
`text-muted`, `border-border`, ...). Components use only these names, so a theme is just another
set of values.

| Token     | Used for                                    |
| --------- | ------------------------------------------- |
| `surface` | Page background                             |
| `raised`  | Cards, selected rows, inputs                |
| `border`  | Dividers and outlines                       |
| `text`    | Primary text                                |
| `muted`   | Secondary text, labels, placeholders        |
| `accent`  | Focus rings, links, interactive highlights  |
| `pass`    | Passed checks, verified evidence            |
| `fail`    | Failed checks, missing evidence, over limit |
| `warn`    | Agent claims, approval thresholds           |
| `unknown` | Unknown outcomes and evidence               |

Fonts are self-hosted through `@fontsource-variable`: Inter (`font-sans`) for text and JetBrains
Mono (`font-mono`) for data such as IDs, tool names and numbers.

## Themes

Dark is the default. With no saved choice the app follows `prefers-color-scheme`; the theme toggle
saves an explicit choice in `localStorage` (`stepglass:theme`) and sets `data-theme` on `<html>`.
If storage is unavailable the choice applies until the page is reloaded.
