import { describe, expect, it } from 'vitest';
import { dispatchCommand, tryDispatchCommand, validateDocumentModel } from '../src/commands';
import { createInitialState } from '../src/model';

describe('Easel commands', () => {
  it('creates Frames, inserts a hierarchy, and keeps undo/redo transactional', () => {
    const initial = createInitialState();
    const created = tryDispatchCommand(initial, { type: 'create-artboard', name: 'Mobile draft', preset: 'website-mobile', position: { x: 3000, y: 100 }, source: 'agent' });
    expect(created.error).toBeUndefined();
    expect(created.state.history).toHaveLength(1);
    const frameId = created.state.document.selection.primaryId;
    expect(frameId).toBeTruthy();
    const inserted = tryDispatchCommand(created.state, {
      type: 'insert-elements',
      frameId: frameId as string,
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

  it('skips locked Layers in regular agent updates and reports IDs', () => {
    const initial = createInitialState();
    const titleId = 'site_title';
    const locked = dispatchCommand(initial, { type: 'toggle-locked', ids: [titleId], locked: true, source: 'human' });
    const attempted = dispatchCommand(locked, { type: 'update-elements', updates: [{ id: titleId, content: 'Do not replace me' }], source: 'agent' });
    expect(attempted.document.nodes[titleId].content).toContain('After Hours');
    expect(attempted.lastAction?.skippedIds).toContain(titleId);
    const forced = dispatchCommand(attempted, { type: 'update-elements', updates: [{ id: titleId, content: 'Force reviewed copy' }], force: true, source: 'agent' });
    expect(forced.document.nodes[titleId].content).toBe('Force reviewed copy');
  });

  it('applies shared context across Website and Graphic Frames', () => {
    const initial = createInitialState();
    const updated = dispatchCommand(initial, { type: 'apply-context', values: [{ key: 'event.date', value: '20 October 2026' }, { key: 'event.time', value: '7:00 PM' }, { key: 'event.venue', value: 'North room' }], source: 'agent' });
    expect(updated.document.nodes.site_date.content).toBe('20 October 2026');
    expect(updated.document.nodes.graphic_date.content).toBe('20 October 2026');
    expect(updated.document.nodes.site_time.content).toBe('7:00 PM');
    expect(updated.document.nodes.graphic_time.content).toBe('7:00 PM');
    expect(updated.document.nodes.site_location.content).toBe('North room');
    expect(updated.document.nodes.graphic_location.content).toBe('North room');
    const manual = dispatchCommand(updated, { type: 'update-elements', updates: [{ id: 'site_date', content: 'Human revision' }], source: 'human' });
    expect(manual.document.nodes.site_date.binding?.key).toBe('event.date');
    expect(manual.document.nodes.site_date.binding?.sharedValue).toBe('20 October 2026');
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
    expect(deleted.state.document.nodes.site_kicker).toBeUndefined();
    expect(deleted.state.document.nodes.site_title).toBeUndefined();
  });

  it('reorders a Layer within its existing sibling list and respects locks', () => {
    const initial = createInitialState();
    const inserted = dispatchCommand(initial, { type: 'insert-elements', frameId: 'site_header', source: 'human', elements: [
      { type: 'text', name: 'First', width: 100, height: 20, content: 'First' },
      { type: 'text', name: 'Second', width: 100, height: 20, content: 'Second' },
      { type: 'text', name: 'Third', width: 100, height: 20, content: 'Third' },
    ] });
    const ids = inserted.document.nodes.site_header.childIds.slice(-3);
    const originalOrder = [...inserted.document.nodes.site_header.childIds];
    const reordered = dispatchCommand(inserted, { type: 'reorder-layer', id: ids[2], beforeId: ids[0], source: 'human' });
    expect(reordered.document.nodes.site_header.childIds.indexOf(ids[2])).toBeLessThan(reordered.document.nodes.site_header.childIds.indexOf(ids[0]));
    expect(reordered.lastAction?.changedIds).toEqual([ids[2]]);
    expect(dispatchCommand(reordered, { type: 'undo' }).document.nodes.site_header.childIds).toEqual(originalOrder);

    const locked = dispatchCommand(inserted, { type: 'toggle-locked', ids: [ids[2]], locked: true, source: 'human' });
    const skipped = dispatchCommand(locked, { type: 'reorder-layer', id: ids[2], beforeId: ids[0], source: 'human' });
    expect(skipped.document.nodes.site_header.childIds).toEqual(originalOrder);
    expect(skipped.lastAction?.skippedIds).toContain(ids[2]);
  });

  it('supports all first-class shapes and aspect-ratio-preserving asset placement', () => {
    const initial = createInitialState();
    const inserted = dispatchCommand(initial, { type: 'insert-elements', frameId: 'artboard_website', source: 'human', elements: [
      { type: 'rectangle', name: 'Rect', width: 100, height: 80 },
      { type: 'ellipse', name: 'Oval', width: 100, height: 80 },
      { type: 'line', name: 'Rule', width: 140, height: 4, style: { borderStyle: 'dashed' } },
      { type: 'arrow', name: 'Direction', width: 140, height: 24 },
      { type: 'polygon', name: 'Badge', width: 100, height: 100, shape: { sides: 8 } },
    ] });
    expect(Object.values(inserted.document.nodes).filter((node) => ['Rect', 'Oval', 'Rule', 'Direction', 'Badge'].includes(node.name))).toHaveLength(5);
    const polygon = Object.values(inserted.document.nodes).find((node) => node.name === 'Badge');
    expect(polygon?.shape?.sides).toBe(8);
    const withAsset = dispatchCommand(initial, { type: 'import-asset', asset: { id: 'asset_test', dataUrl: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22200%22%20height=%22100%22/%3E', originalName: 'test.svg', naturalWidth: 200, naturalHeight: 100, aspectRatio: 2, palette: [], sourceLabel: 'Test', createdAt: '2026-09-03T00:00:00.000Z' }, source: 'human' });
    const insertedWithAsset = dispatchCommand(withAsset, { type: 'insert-elements', frameId: 'artboard_website', source: 'human', elements: [{ type: 'rectangle', name: 'Asset host', width: 100, height: 80 }] });
    const asset = insertedWithAsset.document.assets.asset_test;
    const placed = dispatchCommand(insertedWithAsset, { type: 'place-asset', assetId: asset.id, frameId: 'artboard_website', position: { x: 40, y: 40 }, width: 200, source: 'human' });
    const image = Object.values(placed.document.nodes).find((node) => node.type === 'image' && node.parentId === 'artboard_website');
    expect(image?.height).toBeCloseTo(200 / asset.aspectRatio);
    expect(image?.parentId).toBe('artboard_website');
  });
});
