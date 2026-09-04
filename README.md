# Easel

Easel is a collaborative canvas for website mock-ups, posters, and graphics. You and your agent edit the same design through WebMCP, using context from your connected apps. Human and agent actions share the same document model, validation, undo history, and export paths.

**Try it:** [easel-design.vercel.app](https://easel-design.vercel.app/) — no Easel account required.

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

- A light/dark shell with a sidebar File selector, resize-to-collapse left panel, reopen button, header theme toggle, vertical tool rail, canvas, and contextual Inspector drawer.
- Independent saved Files with exact File switching, rename, New File, local IndexedDB persistence, and local-storage fallback.
- Each File contains a Canvas with Website and Graphic Frames, plus nested Frames, text, shapes, images, bindings, visibility, and lock state.
- Human editing for selection, shift multi-select, pan, zoom, Fit Canvas, frame creation, rectangle/ellipse/line/arrow/polygon/text tools, move, resize, rotate, opacity, stroke, fill, typography, layout, grouping, ordering, hide, lock, copy/paste, and undo/redo.
- An Assets tab with search, upload, paste, source labels, thumbnails, preview-only selection, and drag placement into an exact Frame. Assets remain local data URLs with bounded metadata and aspect-ratio-preserving placement.
- Book Club starter content includes a Website mock-up and Graphic, `Date TBA`, `Time TBA`, and `Venue TBA`, plus an empty Graphic Image Area. The poster starts with `Quiet books. Good company.` and `Bring a friend.` Shared `event.date`, `event.time`, and `event.venue` bindings connect the corresponding details across both Frames.
- Selection-aware agent edits and layer-attached annotations with optional text. An agent can identify addressed annotations in its update; successful edits remove those notes in the same undoable transaction.
- Images placed into a designated image area fill its exact bounds with centered, aspect-ratio-preserving cover cropping. Freely placed images retain contain behavior.
- PNG preview/capture, SVG export, static HTML/CSS export, and JSON export. Static HTML is an export artifact, not production application code.

## WebMCP tools

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
3. Use shared semantic fields such as `event.date`, `event.time`, and `event.venue` (already bound in the starter File).
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

## Testing and demo walkthrough

Open the live URL in a WebMCP-capable host. The recorded demo uses Codex's in-app browser. An ordinary browser supports manual editing, but agent actions require a host/runtime that can discover and invoke WebMCP tools.

1. The starter Book Club File contains a Website mock-up and matching Graphic. Select Website Title in Layers, then ask: “Increase this title's font size by five pixels.”
2. Ask: “Change both frame backgrounds to the same light warm beige.” Inspect the changes or undo them, and try moving or resizing a layer yourself.
3. Activate Annotate and choose a paragraph on the canvas or in Layers. Ask the agent to shorten the marked paragraph. Annotation text is optional.
4. Upload or paste an image into Assets and drag it into a Frame, or ask the agent to import and place an accessible image into Graphic Image Area.
5. Select the Graphic and export it as PNG. Website frames are mock-ups; static HTML export is not a functioning website application.

### Optional connected-context demo

These steps use your own authorized host plugins, not credentials stored in Easel. The creator's private demo documents are not publicly shared and are not required for basic testing.

- **Notion:** Read an event brief and apply its date, time, and venue to the corresponding shared fields in both Frames.
- **Google Drive:** Retrieve an accessible photograph, add it to Assets, and place it into Graphic Image Area.
- **Gmail:** Read an event-feedback email and apply its requested changes. The recorded example changes the subtitle to `Stories worth staying up for.` and removes `Bring a friend.`

Files and imported assets are local to your browser profile. Judges do not share the creator's working File. Use the File selector to create, rename, or switch Files. Undo/redo is available for edits; there is no dedicated demo-reset action.

## Notes and limitations

- Persistence is local to the browser profile; there is no server-side File store.
- External connector access is host-provided and intentionally outside this static app.
- Local image data URLs can make a File large; imports are bounded to small assets.
- Static HTML export preserves supported structured styles and flow layout and reports unsupported or missing local assets.

Released under the MIT License; see [LICENSE](LICENSE).
