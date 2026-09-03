import { describe, expect, it } from 'vitest';
import { dispatchCommand, tryDispatchCommand, validateDocumentModel } from '../src/commands';
import { createInitialState } from '../src/model';

describe('document commands', () => {
  it('creates artboards, inserts a hierarchy, and keeps undo/redo transactional', () => {
    const initial = createInitialState();
    const created = tryDispatchCommand(initial, { type: 'create-artboard', name: 'Mobile draft', preset: 'website-mobile', position: { x: 3000, y: 100 }, source: 'agent' });
    expect(created.error).toBeUndefined();
    expect(created.state.history).toHaveLength(1);
    const artboardId = created.state.document.selection.primaryId;
    expect(artboardId).toBeTruthy();
    const inserted = tryDispatchCommand(created.state, {
      type: 'insert-elements',
      artboardId: artboardId as string,
      source: 'agent',
      elements: [{ type: 'frame', name: 'Stack', width: 300, height: 240, layout: { mode: 'flex-column', gap: 12, padding: 20 }, children: [{ type: 'text', name: 'Heading', width: 240, height: 50, content: 'Hello' }] }],
    });
    expect(inserted.error).toBeUndefined();
    const stack = Object.values(inserted.state.document.nodes).find((node) => node.name === 'Stack');
    expect(stack?.childIds).toHaveLength(1);
    const undone = dispatchCommand(inserted.state, { type: 'undo' });
    expect(Object.values(undone.document.nodes).some((node) => node.name === 'Stack')).toBe(false);
    const redone = dispatchCommand(undone, { type: 'redo' });
    expect(Object.values(redone.document.nodes).some((node) => node.name === 'Stack')).toBe(true);
  });

  it('skips locked nodes in regular agent updates and reports IDs', () => {
    const initial = createInitialState();
    const titleId = 'site_title';
    const locked = dispatchCommand(initial, { type: 'toggle-locked', ids: [titleId], locked: true, source: 'human' });
    const attempted = dispatchCommand(locked, { type: 'update-elements', updates: [{ id: titleId, content: 'Do not replace me' }], source: 'agent' });
    expect(attempted.document.nodes[titleId].content).toContain('Make room');
    expect(attempted.lastAction?.skippedIds).toContain(titleId);
    const forced = dispatchCommand(attempted, { type: 'update-elements', updates: [{ id: titleId, content: 'Force reviewed copy' }], force: true, source: 'agent' });
    expect(forced.document.nodes[titleId].content).toBe('Force reviewed copy');
  });

  it('applies context across both artboards while preserving direct-edit differences', () => {
    const initial = createInitialState();
    const updated = dispatchCommand(initial, { type: 'apply-context', values: [{ key: 'event.title', value: 'Shared event title' }, { key: 'event.date', value: '20 October 2026' }, { key: 'event.location', value: 'North room' }, { key: 'approved.heading', value: 'Approved line' }], source: 'agent' });
    expect(updated.document.nodes.site_title.content).toBe('Shared event title');
    expect(updated.document.nodes.poster_title.content).toBe('Shared event title');
    const manual = dispatchCommand(updated, { type: 'update-elements', updates: [{ id: 'site_title', content: 'Human revision' }], source: 'human' });
    expect(manual.document.nodes.site_title.binding?.key).toBe('event.title');
    expect(manual.document.nodes.site_title.binding?.sharedValue).toBe('Shared event title');
    const report = validateDocumentModel(manual.document, manual.lastAction);
    expect(report.counts['inconsistent-binding']).toBeGreaterThan(0);
  });

  it('preserves hierarchy when grouping and deleting an explicit subtree', () => {
    const initial = createInitialState();
    const grouped = tryDispatchCommand(initial, { type: 'group-elements', ids: ['site_kicker', 'site_title'], source: 'human' });
    expect(grouped.error).toBeUndefined();
    const frame = Object.values(grouped.state.document.nodes).find((node) => node.type === 'frame' && node.name === 'Group');
    expect(frame?.childIds).toEqual(expect.arrayContaining(['site_kicker', 'site_title']));
    const deleted = tryDispatchCommand(grouped.state, { type: 'delete-elements', ids: [frame?.id as string], source: 'agent' });
    expect(deleted.error).toBeUndefined();
    expect(deleted.state.document.nodes['site_kicker']).toBeUndefined();
    expect(deleted.state.document.nodes['site_title']).toBeUndefined();
  });
});
