# Trajectory

Record a person's growth path — all of one's potential lives in the
conversations with AI.

A local Vite dev tool (vitest-ui shaped): reads local AI conversation exports
(DeepSeek today, coding-agent CLI logs and more as plugin adapters) and renders
an activity heatmap, time-of-day profile, session search, a document-flow
reading view with variant switching, and a growth timeline. Everything stays
on the machine.

## Quick start

```bash
pnpm install
./scripts/init-data-dir.sh   # symlink data/ to the local data repo (or ln -s manually)
pnpm dev
```

Open the printed address (default http://localhost:5173). Data lives in
`data/<group>/<source>/` — e.g. `web/deepseek/` (official export:
`conversations.json` + `user.json`), `local/<tool>-<user>/` (coding-agent
session logs; SQLite databases or JSONL trees depending on the tool).

## Architecture

Dependency direction is one-way: `domain ← adapters ← app ← routes/components`.

```
plugins/trajectory-data.ts   # vite plugin: filesystem only — manifests, bytes, read-only
                             # sqlite queries, watch -> HMR
src/
├── domain/                  # layer 0 — zero dependencies (no react/jotai/vite/node)
│   ├── model/               #   Trajectory aggregate: message tree (truth) + activePath
│   ├── ports/               #   SourceAdapter / Sanitizer / DataHost contracts
│   └── services/            #   turn-builder (analytics read model), document-view
│                            #   (reading read model), growth-analytics, topics
├── adapters/                # layer 1 — external implementations
│   ├── sources/             #   one directory per source format + registry
│   ├── sanitize/            #   regex sanitizer (prepared, off by default)
│   └── topics/              #   curated keyword dictionary
├── app/                     # layer 2 — jotai world + ingest pipeline
│   ├── ingest.ts            #   parse -> sanitize -> invariants -> deep freeze
│   ├── derive.ts            #   lightweight list rows / palette text / topics
│   └── stores/              #   data (loading), detail (variants), growth, sessions, theme
└── routes/ components/      # layer 3 — UI (antfu-style tokens live in index.css)
```

### Key domain decisions

- **The message tree is the truth; Turn and DocumentView are read models.**
  The tree keeps every branch (question rewrites and regenerations both map to
  variants); `activePath` follows the audited export semantics (last child per
  fork). Top-level forks are children of a virtual root.
- **Multi-source merged index.** `TrajectoryId = ${sourceId}:${rawId}` is
  namespaced at the domain level; every recognized source loads in parallel
  into one list, and providers appear only as colored dots on data.
- **Immutability.** The ingest pipeline deep-freezes its output (a React
  Compiler memo precondition); everything that "changes" is a pure function
  returning new values.
- **Two-level citation resolution** (DeepSeek): turn search window first, then
  the session registry, else a degraded plain marker — content is never lost.
- **Diagnostics, not crashes.** Unknown fragment kinds land in an `unknown`
  bucket, invariant violations collect into `diagnostics`, and one broken
  conversation never takes down its source.

### Adding a source

1. Drop the export into `data/<group>/<source>/`.
2. Create `src/adapters/sources/<source>/` implementing `SourceAdapter`
   (`detect` claims the manifest, `parse` maps raw shapes to the domain —
   isomorphic pure functions, bytes via `fetchFile`, structured reads via
   `querySqlite` for SQLite databases).
3. Register one line in `src/adapters/sources/index.ts`.

The vite plugin discovers directories automatically; an unclaimed directory
shows up as unrecognized instead of crashing. Agent-conversation adapters
share conventions in `src/adapters/sources/local/`: noise filtering, tool
output truncation, and title fallback from the first real user prompt.

### Redaction (hooked, not armed)

The `Sanitizer` port sits in the ingest pipeline (after the adapter, before
the store). `PersonaProfile` carries no plaintext PII by construction — the
adapter masks it at the type boundary. `createRegexSanitizer` is ready for
text masking when the share feature lands.

## Interaction

| Keys         | Action                                        |
| ------------ | --------------------------------------------- |
| `⌘K`         | command palette (title + first prompt search) |
| `j` / `k`    | move across the session list                  |
| heatmap cell | filter sessions by that day's turn activity   |

## Development

```bash
pnpm dev      # local dev
pnpm build    # tsc -b + vite build
pnpm lint     # oxlint
pnpm fmt      # oxfmt
```

Stack: Vite 8 · React 19 (React Compiler) · TanStack Router (file routes) ·
Jotai 3 · Tailwind CSS 4 · shiki (lazy dual-theme highlighting) ·
react-markdown · better-sqlite3 (read-only, in the dev-server plugin).
