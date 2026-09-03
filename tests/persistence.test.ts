import { describe, expect, it } from 'vitest';
import { createInitialDocument } from '../src/model';
import { deserializeDocument, serializeDocument } from '../src/persistence';

describe('document persistence serialization', () => {
  it('round trips the normalized document and stable relationships', () => {
    const document = createInitialDocument();
    const restored = deserializeDocument(serializeDocument(document));
    expect(restored.id).toBe(document.id);
    expect(restored.pages[0].rootIds).toEqual(document.pages[0].rootIds);
    expect(restored.nodes.site_title.parentId).toBe(document.nodes.site_title.parentId);
    expect(restored.nodes.site_title.binding?.key).toBe('event.title');
  });

  it('rejects malformed JSON and missing document topology', () => {
    expect(() => deserializeDocument('{not json')).toThrow('valid JSON');
    expect(() => deserializeDocument(JSON.stringify({ document: { id: 'x' } }))).toThrow('valid Easel document');
  });
});
