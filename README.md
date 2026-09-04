# Easel

Easel is a local-first React + TypeScript canvas for structured visual editing. A person and a host agent use the same normalized model, undoable commands, persistence, validation, and export paths.

## Run locally

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The included `vercel.json` and `public/_headers` add:

- `Origin-Agent-Cluster: ?1`
- `Permissions-Policy: tools=(self)`

## Product surface

- A calm light/dark shell with a persistent Layers toggle, sidebar File selector, resizable left panel, vertical tool rail, canvas, and contextual Inspector drawer.
- Independent saved Files with exact File switching, rename, New File, local IndexedDB persistence, and local-storage fallback.
- Each File contains a Canvas with Website and Graphic Frames, plus nested Frames, text, shapes, images, bindings, visibility, and lock state.
- Human editing for selection, shift multi-select, pan, zoom, Fit Canvas, frame creation, rectangle/ellipse/line/arrow/polygon/text tools, move, resize, rotate, opacity, stroke, fill, typography, layout, grouping, ordering, hide, lock, copy/paste, and undo/redo.
- An Assets tab with search, upload, paste, source labels, thumbnails, preview-only selection, and drag placement into an exact Frame. Assets remain local data URLs with bounded metadata and aspect-ratio-preserving placement.
- Deterministic Book Club starter content: `After Hours Book Club`, `Good books. Better conversations.`, `September 18 · 7:00 PM`, `The Reading Room`, and `Join the next gathering`, with shared `event.title`, `event.tagline`, `event.date`, `event.location`, and `event.image` bindings.
- PNG preview/capture, SVG export, static HTML/CSS export, and JSON export. Static HTML is an export artifact, not production application code.

## Website mock-up Tools

When `document.modelContext.registerTool` is available, Easel registers these strict tools:

1. `inspect_document`
2. `open_file`
3. `inspect_assets`
4. `focus_for_inspection`
5. `capture_frame`
6. `create_frame`
7. `write_frame`
8. `insert_elements`
9. `update_elements`
10. `annotate_elements`
11. `duplicate_elements`
12. `delete_elements`
13. `bind_context_fields`
14. `apply_context_values`
15. `import_and_place_asset`
16. `validate_document`
17. `export_frames`

Inputs use explicit File, Canvas, Frame, Layer, Asset, binding, geometry, style, layout, and shape fields with `additionalProperties: false`. Semantic updates accept one exact target per patch; ambiguous and missing targets return bounded candidate details. Inspection is filterable, paginated, and bounded. Mutations return the active File, stable IDs, changed/skipped/failed IDs, action labels, actual values, result bounds, and revision metadata. Registration owns one `AbortController` and aborts all handlers during cleanup.

The shared command layer is the source of truth for both human and agent actions. Locked Layers and locked ancestors are protected by default. Replace, update, duplicate, delete, and context application require explicit force behavior where supported.

## Connector orchestration

The canvas does not authenticate to external systems or fetch remote data. A host agent can read approved structured facts from its connected sources and pass selected values into Easel. A typical flow is:

1. Inspect the active File or selection.
2. Read an approved source through the host connector.
3. Bind semantic fields such as `event.title`, `event.date`, or `event.location`.
4. Apply a typed value batch with `apply_context_values`.
5. Validate, focus, capture, or export the selected Frames.

Credentials and connector policy stay outside this shell; the visual result remains deterministic and inspectable.

## Architecture

- `src/types.ts` defines the normalized File, Canvas, Frame, Layer, Asset, binding, viewport, history, and result types.
- `src/model.ts` provides IDs, defaults, starter content, hierarchy traversal, absolute layout calculation, semantic matching, and viewport helpers.
- `src/commands.ts` implements validation, lock semantics, transactional mutations, undo/redo snapshots, selection, layout, shapes, assets, bindings, ordering, and validation.
- `src/App.tsx` is the human editor and DOM renderer for the normalized model.
- `src/webmcp.ts` defines the strict tool surface, runtime parsing, bounded summaries, File switching, feedback, registration, and abort cleanup.
- `src/persistence.ts` stores versioned File records in IndexedDB with a local-storage fallback and migrates only the old untouched seed.
- `src/exports.ts` renders PNG/SVG/static HTML and JSON with local assets.

## Demo path

1. Start the dev server; the seeded Book Club File opens with Website and Graphic Frames visible together.
2. Use the Layers tab to select a Frame or Layer, then edit its content and appearance in Inspector.
3. Use the Assets tab to inspect the original starter illustration, upload or paste a local image, and drag it into a Frame.
4. Choose Shapes for rectangle, ellipse, line, arrow, or polygon placement; edit polygon sides and strokes in Inspector.
5. Open Files to create, rename, switch, close, import, or reset the active File.
6. Use a host that supports Website mock-up Tools to inspect, annotate, bind, apply context, validate, capture, and export through the same model.

## Notes and limitations

- Persistence is local to the browser profile; there is no server-side File store.
- External connector access is host-provided and intentionally outside this static app.
- Local image data URLs can make a File large; imports are bounded to small assets.
- Static HTML export preserves supported structured styles and flow layout and reports unsupported or missing local assets.

Released under the MIT License; see [LICENSE](LICENSE).
