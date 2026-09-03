import { describe, expect, it } from 'vitest';
import { createInitialDocument, createInitialState } from '../src/model';
import { deserializeEditorState, serializeEditorState } from '../src/persistence';

describe('File persistence', () => {
  it('round-trips independent saved Files and the active File', () => {
    const state = createInitialState();
    const secondDocument = createInitialDocument();
    secondDocument.id = 'file_second';
    secondDocument.name = 'Second File';
    secondDocument.nodes.site_title.content = 'A separate draft';
    state.files.push({ id: 'file_second', name: 'Second File', document: secondDocument, updatedAt: secondDocument.updatedAt, open: false });

    const restored = deserializeEditorState(serializeEditorState(state));
    expect(restored.activeFileId).toBe('document_easel');
    expect(restored.files.map((file) => file.name)).toEqual(['Book Club', 'Second File']);
    expect(restored.files[1].open).toBe(false);
    expect(restored.files[1].document.nodes.site_title.content).toBe('A separate draft');
    expect(restored.document.name).toBe('Book Club');
    expect(restored.document.nodes.site_title.content).toContain('After Hours');
  });

  it('migrates only the untouched legacy starter record to the deterministic Book Club File', () => {
    const legacy = createInitialDocument();
    legacy.revision = 1;
    legacy.nodes.site_title.content = 'Make room for a new idea';
    delete legacy.nodes.site_tagline;
    const restored = deserializeEditorState(JSON.stringify({ version: 1, document: legacy }));
    expect(restored.document.name).toBe('Book Club');
    expect(restored.document.nodes.site_title.content).toContain('After Hours');
    expect(restored.document.nodes.site_tagline.content).toBe('Good books. Better conversations.');
  });

  it('preserves a user-edited legacy record instead of overwriting it', () => {
    const edited = createInitialDocument();
    edited.revision = 1;
    edited.nodes.site_title.content = 'My custom copy';
    delete edited.nodes.site_tagline;
    const restored = deserializeEditorState(JSON.stringify({ version: 1, document: edited }));
    expect(restored.document.nodes.site_title.content).toBe('My custom copy');
    expect(restored.document.nodes.site_tagline).toBeUndefined();
  });
});
