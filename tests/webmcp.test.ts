import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../src/model';
import { createToolBridge, registerWebMCPTools, TOOL_DEFINITIONS } from '../src/webmcp';
import type { EditorState } from '../src/types';

describe('WebMCP bridge', () => {
  it('exposes the exact focused surface with strict object schemas', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'inspect_document', 'inspect_selection', 'focus_for_inspection', 'capture_artboard', 'create_artboard', 'write_artboard', 'insert_elements', 'update_elements', 'duplicate_elements', 'delete_elements', 'bind_context_fields', 'apply_context_values', 'validate_document', 'export_artboards',
    ]);
    expect(TOOL_DEFINITIONS.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
  });

  it('invokes shared commands, bounds inspection, and returns recoverable errors', async () => {
    let state: EditorState = createInitialState();
    const bridge = createToolBridge({
      getState: () => state,
      commit: (next) => { state = next; },
      focus: async (ids) => ({ ok: true, message: 'focused', targetIds: ids }),
      capture: async (id, scale) => ({ ok: true, message: 'preview', snapshotId: 's1', artboardId: id, scale, previewOpen: true }),
      export: async (ids, format) => ({ ok: true, message: 'exported', format, files: ids.map((id) => ({ artboardId: id, fileName: 'out' })) }),
    });
    const inspected = await bridge.invoke('inspect_document', { maxNodes: 2, maxTextChars: 40 });
    expect(inspected.ok).toBe(true);
    expect(JSON.stringify(inspected).length).toBeLessThan(1500);
    const created = await bridge.invoke('create_artboard', { name: 'Tool board', preset: 'a4-portrait' });
    expect(created.ok).toBe(true);
    expect(state.lastAction?.source).toBe('agent');
    const invalid = await bridge.invoke('update_elements', { updates: [{ id: 'missing', content: 'x' }] });
    expect(invalid.ok).toBe(true);
    expect(invalid.failedIds).toContain('missing');
    const bad = await bridge.invoke('create_artboard', { name: 'Bad' });
    expect(bad.ok).toBe(false);
  });

  it('registers top-level tools and abort cleanup without duplicate definitions in one pass', async () => {
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
    expect(registrations).toHaveLength(14);
    expect(registrations.map((item) => item.definition.name)).toEqual(TOOL_DEFINITIONS.map((tool) => tool.name));
    result.cleanup();
    expect(registrations[0].signal?.aborted).toBe(true);
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  });
});
