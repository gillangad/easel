# Easel

Easel is a local-first React + TypeScript design canvas for structured, agent-directed visual editing. It keeps a normalized document model behind a DOM-first renderer, so a person and a WebMCP-capable agent use the same undoable command layer.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal. Production checks are available with:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The included `vercel.json` and `public/_headers` add the WebMCP-related response headers:

- `Origin-Agent-Cluster: ?1`
- `Permissions-Policy: tools=(self)`

## Product surface

- Light and dark themes with a compact top bar, pages/layers panel, tool rail, pasteboard, and contextual inspector.
- Pages and artboards with website, mobile, poster, A4, and custom sizing presets.
- Manual selection, multi-select, pan, zoom, fit, rectangle/text/image tools, drag, resize, rotate, inline text editing, duplicate, delete, copy/paste, grouping, reordering, alignment, distribution, hide, and lock controls.
- Local image upload and image paste. Image files are stored in the document as local data URLs with metadata and a small palette.
- Context bindings for text and image fields. A binding records a semantic key, source label, last update time, and shared value.
- Browser-side IndexedDB persistence with a local-storage fallback, document JSON import/export, and bounded undo/redo history.
- PNG preview/capture, SVG export, static HTML/CSS export, and document JSON export. Exported HTML is a static artifact, not production application code.

## WebMCP tools

When `document.modelContext.registerTool` is available, the app registers exactly these tools:

1. `inspect_document`
2. `inspect_selection`
3. `focus_for_inspection`
4. `capture_artboard`
5. `create_artboard`
6. `write_artboard`
7. `insert_elements`
8. `update_elements`
9. `duplicate_elements`
10. `delete_elements`
11. `bind_context_fields`
12. `apply_context_values`
13. `validate_document`
14. `export_artboards`

The schemas are object-shaped with explicit fields and `additionalProperties: false`. Runtime parsing repeats the important bounds before dispatching. Mutating tools return stable IDs, changed/skipped/failed IDs, action labels, and the resulting revision. Read and mutation responses are bounded so inspection output does not grow without limit. Registration owns one `AbortController`; cleanup aborts all registered handlers.

The shared action layer is the source of truth for both surfaces. Locked nodes and locked ancestors are protected by default. Replace, update, duplicate, delete, and context application require an explicit `force` field to override protection where supported.

## Connector orchestration

The canvas deliberately does not authenticate to external systems or fetch remote data. A host agent can read structured facts from connected workspace, calendar, mail, or messaging sources, normalize those facts, and pass only the selected values into the canvas. A typical flow is:

1. Inspect the document or selection.
2. Read an approved source through the host's connector.
3. Bind semantic fields such as `event.title`, `event.date`, or `event.location`.
4. Apply a typed value batch with `apply_context_values`.
5. Validate the document, focus the relevant artboard, and capture or export it.

This keeps credentials and connector policy outside the page while making the visual result deterministic and inspectable.

## Architecture

- `src/types.ts` defines the normalized document, node, asset, binding, viewport, history, and tool result types.
- `src/model.ts` provides IDs, defaults, seeded example content, hierarchy traversal, absolute layout calculation, and viewport helpers.
- `src/commands.ts` implements validation, lock semantics, one-transaction mutations, undo/redo snapshots, selection, layout, binding, and document validation.
- `src/App.tsx` is the manual editor and DOM renderer. It renders the same normalized model that tools mutate.
- `src/webmcp.ts` defines the exact tool surface, strict runtime parsing, bounded summaries, registration, and abort cleanup.
- `src/persistence.ts` stores versioned document JSON in IndexedDB with fallback storage.
- `src/exports.ts` renders PNG/SVG/static HTML and document JSON without relying on screenshot-based editing.

## Demo path

1. Start the dev server and keep the seeded `Launch set` document.
2. Select `Event title` in the layers panel and edit its text or typography in the inspector.
3. Open `More` to preview the current artboard, change theme, or start a blank document.
4. Add an artboard with the Artboard tool, then add text/rectangles or paste a local image.
5. Use the layer lock controls to see protected edits report skipped IDs.
6. Use a WebMCP-capable host to inspect, bind, apply context, validate, and export through the same document.

## Notes and limitations

- Persistence is local to the browser profile; there is no server-side document store.
- External connector access is host-provided and intentionally outside this static page.
- Image uploads are local data URLs, so very large images increase document size.
- Static HTML export preserves the supported structured styles and flow layout; it reports unsupported or missing image assets in export metadata.
- The browser capability used for automated QA may not expose live WebMCP invocation even though registration and invocation behavior are covered by the test suite.

Released under the MIT License; see [LICENSE](LICENSE).
