import { describe, expect, it, vi } from 'vitest';
import { createInitialDocument, createInitialState } from '../src/model';
import { createToolBridge, registerWebMCPTools, TOOL_DEFINITIONS, toolSchemasAreStrict } from '../src/webmcp';
import type { EditorState } from '../src/types';

function makeHarness(initial = createInitialState(), withFeedback = false) {
  let state: EditorState = initial;
  const starts: string[][] = [];
  const completions: Array<{ token: string; ids: string[]; success: boolean; mutation: boolean }> = [];
  const bridge = createToolBridge({
    getState: () => state,
    commit: (next) => { state = next; },
    focus: async (ids) => ({ ok: true, message: 'focused', targetIds: ids }),
    capture: async (frameId, scale) => ({ ok: true, message: 'preview', snapshotId: 's1', frameId, scale, previewOpen: true }),
    export: async (frameIds, format, scale) => ({ ok: true, message: 'exported', format, scale, files: frameIds.map((frameId) => ({ frameId, fileName: 'out' })) }),
    ...(withFeedback ? {
      beginAgentWork: (ids: string[]) => { starts.push(ids); return `token-${starts.length}`; },
      completeAgentWork: (token: string, ids: string[], success: boolean, mutation: boolean) => { completions.push({ token, ids, success, mutation }); },
    } : {}),
  });
  return { bridge, getState: () => state, starts, completions };
}

describe('Website mock-up Tool bridge', () => {
  it('exposes the focused File/Frame surface with strict object schemas', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'inspect_document', 'open_file', 'inspect_assets', 'focus_for_inspection', 'capture_frame', 'create_frame', 'write_frame', 'insert_elements', 'update_elements', 'annotate_elements', 'duplicate_elements', 'delete_elements', 'bind_context_fields', 'apply_context_values', 'import_and_place_asset', 'validate_document', 'export_frames',
    ]);
    expect(toolSchemasAreStrict()).toBe(true);
    const updateSchema = TOOL_DEFINITIONS.find((tool) => tool.name === 'update_elements')?.inputSchema as { properties?: { updates?: { items?: { oneOf?: unknown[] } } } };
    expect(updateSchema.properties?.updates?.items?.oneOf).toHaveLength(2);
  });

  it('inspects the active File with a public Canvas and Frame vocabulary', async () => {
    const harness = makeHarness();
    const result = await harness.bridge.invoke('inspect_document', { maxFrames: 2, maxLayers: 4 });
    expect(result.ok).toBe(true);
    expect(result.file).toEqual(expect.objectContaining({ fileId: 'document_easel', fileName: 'After Hours Book Club', frameCount: 2 }));
    expect(result.canvas).toEqual({ id: 'canvas', name: 'Canvas' });
    expect(result.frames).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'artboard_website', name: 'Website', type: 'frame' }),
      expect.objectContaining({ id: 'artboard_graphic', name: 'Graphic', type: 'frame' }),
    ]));
    expect(JSON.stringify(result)).not.toContain('pageId');
    expect(JSON.stringify(result)).not.toContain('artboardName');
  });

  it('resolves an exact semantic target and returns actual changed values', async () => {
    const harness = makeHarness();
    const result = await harness.bridge.invoke('update_elements', {
      updates: [{ target: { frameName: 'Website', name: 'Website Title', type: 'text' }, content: 'A new\nheadline', style: { fontSize: 64 } }],
    });
    expect(result.ok).toBe(true);
    expect(result.changedIds).toEqual(['site_title']);
    expect(result.changed).toEqual([expect.objectContaining({
      id: 'site_title',
      values: expect.objectContaining({ content: 'A new\nheadline', style: { fontSize: 64 } }),
    })]);
    expect(harness.getState().document.nodes.site_title.content).toBe('A new\nheadline');
    expect(harness.getState().document.nodes.site_title.style.fontSize).toBe(64);
  });

  it('uses the Frame name to disambiguate identical Layer names', async () => {
    const initial = createInitialState();
    initial.document.nodes.graphic_title.name = 'Event title';
    const harness = makeHarness(initial);
    const result = await harness.bridge.invoke('update_elements', {
      updates: [{ target: { frameName: 'Graphic', name: 'Event title', type: 'text' }, content: 'Graphic headline' }],
    });
    expect(result.ok).toBe(true);
    expect(result.changedIds).toEqual(['graphic_title']);
    expect(harness.getState().document.nodes.graphic_title.content).toBe('Graphic headline');
  });

  it('returns actionable ambiguity and zero-match errors without partial writes', async () => {
    const initial = createInitialState();
    initial.document.nodes.site_title.name = 'Event title';
    initial.document.nodes.graphic_title.name = 'Event title';
    const harness = makeHarness(initial);
    const ambiguous = await harness.bridge.invoke('update_elements', { updates: [{ target: { name: 'Event title', type: 'text' }, content: 'Should not apply' }] });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error?.code).toBe('AMBIGUOUS_TARGET');
    expect(ambiguous.error?.details).toEqual(expect.objectContaining({ matchCount: 2, candidates: expect.any(Array) }));
    expect(harness.getState().document.nodes.site_title.content).toContain('After Hours');
    expect(harness.getState().document.nodes.graphic_title.content).toContain('Quiet books');

    const missing = await harness.bridge.invoke('update_elements', { updates: [{ target: { frameName: 'Website', name: 'Missing Layer', type: 'text' }, content: 'No match' }] });
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe('NOT_FOUND');
    expect(missing.error?.details).toEqual(expect.objectContaining({ matchCount: 0, candidates: expect.any(Array) }));
  });

  it('keeps direct ID updates compatible and reports actual fields', async () => {
    const harness = makeHarness();
    const result = await harness.bridge.invoke('update_elements', { updates: [{ id: 'site_title', name: 'Hero title', style: { color: '#123456' } }] });
    expect(result.ok).toBe(true);
    expect(result.changedIds).toEqual(['site_title']);
    expect(result.changed).toEqual([expect.objectContaining({ values: expect.objectContaining({ name: 'Hero title', style: { color: '#123456' } }) })]);
  });

  it('lets an update explicitly dismiss addressed annotations in the same transaction', async () => {
    const initial = createInitialState();
    const harness = makeHarness(initial);
    const annotation = await harness.bridge.invoke('annotate_elements', { nodeId: 'site_title', action: 'add', text: 'Review this title.' });
    const id = annotation.annotation && typeof annotation.annotation === 'object' && 'id' in annotation.annotation ? annotation.annotation.id as string : '';
    const updated = await harness.bridge.invoke('update_elements', { updates: [{ id: 'site_title', content: 'Reviewed title', annotationIds: [id] }] });

    expect(updated.ok).toBe(true);
    expect(updated.removedAnnotationIds).toEqual([id]);
    expect(harness.getState().document.nodes.site_title.annotations).toBeUndefined();
    const undone = await harness.bridge.invoke('update_elements', { history: { action: 'undo', steps: 1 } });
    expect(undone.ok).toBe(true);
    expect(harness.getState().document.nodes.site_title.content).toBe('After Hours Book Club');
    expect(harness.getState().document.nodes.site_title.annotations).toEqual([{ id, text: 'Review this title.', resolved: false }]);
  });

  it('supports filtered, pageable Frame inspection and selection scope', async () => {
    const harness = makeHarness();
    const first = await harness.bridge.invoke('inspect_document', { scope: 'frame', frameName: 'Website', type: 'text', maxLayers: 2, maxTextChars: 40 });
    const firstLayers = (first.layers as Array<{ id: string }> | undefined) ?? [];
    expect(first.ok).toBe(true);
    expect(first.totalMatches).toBeGreaterThan(2);
    expect(firstLayers).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    const second = await harness.bridge.invoke('inspect_document', { scope: 'frame', frameName: 'Website', type: 'text', maxLayers: 2, offset: first.nextOffset });
    const secondLayers = (second.layers as Array<{ id: string }> | undefined) ?? [];
    expect(second.ok).toBe(true);
    expect(secondLayers[0]?.id).not.toBe(firstLayers[0]?.id);

    const state = harness.getState();
    state.document.selection = { ids: ['site_title'], primaryId: 'site_title' };
    const selection = await harness.bridge.invoke('inspect_document', { scope: 'selection' });
    const selectionLayers = (selection.layers as Array<{ id: string }> | undefined) ?? [];
    expect(selection.ok).toBe(true);
    expect(selectionLayers.map((layer) => layer.id)).toEqual(['site_title']);
  });

  it('keeps oversized inspection results bounded while preserving continuation metadata', async () => {
    const harness = makeHarness();
    const result = await harness.bridge.invoke('inspect_document', { detail: 'full', maxLayers: 80, maxTextChars: 600 });
    const layers = (result.layers as Array<{ id: string }> | undefined) ?? [];
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2200);
    expect(result.ok).toBe(true);
    expect(result.resultTruncated).toBe(true);
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(layers[0]?.id).toBeTruthy();
  });

  it('bridges agent feedback lifecycle and target reveal IDs around mutations', async () => {
    const harness = makeHarness(createInitialState(), true);
    const result = await harness.bridge.invoke('update_elements', { updates: [{ target: { frameName: 'Website', bindingKey: 'event.date', type: 'text' }, content: 'Updated by agent' }] });
    expect(result.ok).toBe(true);
    expect(harness.starts[0]).toEqual(expect.arrayContaining(['site_date', 'artboard_website']));
    expect(harness.completions).toHaveLength(1);
    expect(harness.completions[0]).toEqual(expect.objectContaining({ success: true, mutation: true }));
    expect(harness.completions[0].ids).toEqual(expect.arrayContaining(['site_date', 'artboard_website']));
  });

  it('creates Frames, inspects starter Assets, and places an imported Asset', async () => {
    const harness = makeHarness();
    const created = await harness.bridge.invoke('create_frame', { name: 'Poster', preset: 'graphic', position: { x: 1800, y: 120 } });
    expect(created.ok).toBe(true);
    expect(created.createdIds).toHaveLength(1);
    expect(created.frame).toEqual(expect.objectContaining({ id: expect.any(String), name: 'Poster' }));
    expect(harness.getState().lastAction?.source).toBe('agent');

    const assets = await harness.bridge.invoke('inspect_assets', { source: 'Drive' });
    expect(assets.ok).toBe(true);
    expect(assets.assets).toEqual([]);

    const svg = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22720%22%20height=%22360%22%3E%3Crect%20width=%22720%22%20height=%22360%22%20fill=%22%23000%22/%3E%3C/svg%3E';
    const placed = await harness.bridge.invoke('import_and_place_asset', { data: svg, filename: 'import.svg', mimeType: 'image/svg+xml', target: { frameName: 'Website' }, position: { x: 30, y: 40 }, width: 200 });
    expect(placed.ok).toBe(true);
    expect(placed.assetId).toBeTruthy();
    expect(placed.layerId).toBeTruthy();
    expect(placed.bounds).toEqual(expect.objectContaining({ x: 30, y: 40, width: 200, height: 100 }));
    expect(placed.frame).toEqual(expect.objectContaining({ id: 'artboard_website', name: 'Website', type: 'frame' }));
    const image = harness.getState().document.nodes[placed.layerId as string];
    expect(image?.type).toBe('image');
    expect(image?.parentId).toBe('artboard_website');
  });

  it('opens an exact saved File and keeps records independent', async () => {
    const initial = createInitialState();
    const secondDocument = createInitialDocument();
    secondDocument.id = 'file_second';
    secondDocument.name = 'Second File';
    secondDocument.nodes.site_title.content = 'Second copy';
    initial.files.push({ id: 'file_second', name: 'Second File', document: secondDocument, updatedAt: secondDocument.updatedAt, open: true });
    const harness = makeHarness(initial);
    const result = await harness.bridge.invoke('open_file', { fileName: 'Second File' });
    expect(result.ok).toBe(true);
    expect(result.file).toEqual(expect.objectContaining({ fileId: 'file_second', fileName: 'Second File' }));
    expect(harness.getState().activeFileId).toBe('file_second');
    expect(harness.getState().document.nodes.site_title.content).toBe('Second copy');
    expect(harness.getState().files.find((file) => file.id === 'document_easel')?.document.nodes.site_title.content).toContain('After Hours');
  });

  it('applies bindings, validates, exports, and returns recoverable input errors', async () => {
    const harness = makeHarness();
    const bound = await harness.bridge.invoke('bind_context_fields', { bindings: [{ target: { frameName: 'Website', name: 'Website Venue', type: 'text' }, key: 'event.venue' }] });
    expect(bound.ok).toBe(true);
    const applied = await harness.bridge.invoke('apply_context_values', { values: [{ key: 'event.date', value: '18 September' }, { key: 'event.time', value: '7:00 PM' }, { key: 'event.venue', value: 'The Annex' }] });
    expect(applied.ok).toBe(true);
    expect(harness.getState().document.nodes.site_location.content).toBe('The Annex');
    expect(harness.getState().document.nodes.graphic_location.content).toBe('The Annex');
    const validation = await harness.bridge.invoke('validate_document', {});
    expect(validation.ok).toBe(true);
    expect(validation.file).toEqual(expect.objectContaining({ fileName: 'After Hours Book Club' }));
    const exported = await harness.bridge.invoke('export_frames', { frameIds: ['artboard_website'], format: 'svg', scale: 2 });
    expect(exported.ok).toBe(true);
    expect(exported.frameIds).toEqual(['artboard_website']);
    expect(exported.format).toBe('svg');
    expect(exported.files).toEqual(expect.arrayContaining([expect.objectContaining({ frameId: 'artboard_website', fileName: 'out' })]));

    const invalidExport = await harness.bridge.invoke('export_frames', { frameIds: ['site_title'], format: 'svg' });
    expect(invalidExport.ok).toBe(false);
    expect(invalidExport.error?.code).toBe('NOT_A_FRAME');

    const invalid = await harness.bridge.invoke('update_elements', { updates: [{ id: 'missing', content: 'x' }] });
    expect(invalid.ok).toBe(true);
    expect(invalid.failedIds).toContain('missing');
    const bad = await harness.bridge.invoke('create_frame', { name: 'Bad' });
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('INVALID_INPUT');
  });

  it('registers all top-level tools and abort cleanup without duplicates', async () => {
    const registrations: Array<{ definition: Record<string, unknown>; signal?: AbortSignal }> = [];
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { modelContext: { registerTool: vi.fn(async (definition: Record<string, unknown>, options?: { signal?: AbortSignal }) => { registrations.push({ definition, signal: options?.signal }); }) } } });
    let state: EditorState = createInitialState();
    const result = await registerWebMCPTools({
      getState: () => state,
      commit: (next) => { state = next; },
      focus: async (ids) => ({ ok: true, message: 'focused', targetIds: ids }),
      capture: async () => ({ ok: true }),
      export: async () => ({ ok: true }),
    });
    expect(result.registered).toBe(true);
    expect(registrations).toHaveLength(17);
    expect(registrations.map((item) => item.definition.name)).toEqual(TOOL_DEFINITIONS.map((tool) => tool.name));
    result.cleanup();
    expect(registrations[0].signal?.aborted).toBe(true);
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  });
});
