import { describe, expect, it } from 'vitest';
import { createInitialDocument, createInitialState } from '../src/model';
import { deserializeEditorState, serializeEditorState } from '../src/persistence';

describe('File persistence', () => {
  it('seeds the Book Club Frames with exact targets, TBA details, bindings, and no reference Asset', () => {
    const document = createInitialDocument();
    expect(document.assets).toEqual({});
    expect(Object.values(document.assets).some((asset) => asset.originalName === 'book-club-reference.jpg')).toBe(false);
    expect(document.nodes.artboard_website.style.fill).toBe('#3b251c');
    expect(document.nodes.artboard_graphic.style.fill).toBe('#3b251c');
    expect(document.nodes.website_background.name).toBe('Website Background');
    expect(document.nodes.graphic_background.name).toBe('Graphic Background');
    expect(document.nodes.site_title).toEqual(expect.objectContaining({ name: 'Website Title', content: 'After Hours Book Club' }));
    expect(document.nodes.graphic_title).toEqual(expect.objectContaining({ name: 'Graphic Subtitle', content: 'Quiet books. Good company.' }));
    expect(document.nodes.graphic_tagline).toEqual(expect.objectContaining({ name: 'Graphic Secondary Line', content: 'Bring a friend.' }));
    expect(document.nodes.graphic_image).toEqual(expect.objectContaining({ name: 'Graphic Image Area', type: 'rectangle' }));
    const targetNames = ['Website Date', 'Website Time', 'Website Venue', 'Graphic Date', 'Graphic Time', 'Graphic Venue'];
    targetNames.forEach((name) => expect(Object.values(document.nodes).filter((node) => node.name === name)).toHaveLength(1));
    expect(targetNames.every((name) => Object.values(document.nodes).some((node) => node.name === name && node.content === 'TBA'))).toBe(true);
    const bindings = Object.values(document.nodes).filter((node) => node.binding).map((node) => `${node.name}:${node.binding?.key}`);
    expect(bindings).toEqual(expect.arrayContaining(['Website Date:event.date', 'Graphic Date:event.date', 'Website Time:event.time', 'Graphic Time:event.time', 'Website Venue:event.venue', 'Graphic Venue:event.venue']));
    expect(bindings).toHaveLength(6);
  });

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
    legacy.pages[0].name = 'Launch set';
    legacy.nodes.site_title.name = 'Event title';
    legacy.nodes.site_title.content = 'Make room for a new idea';
    delete legacy.nodes.site_tagline;
    const restored = deserializeEditorState(JSON.stringify({ version: 1, document: legacy }));
    expect(restored.document.name).toBe('Book Club');
    expect(restored.document.nodes.site_title.content).toContain('After Hours');
    expect(restored.document.nodes.graphic_title.content).toBe('Quiet books. Good company.');
    expect(restored.document.assets).toEqual({});
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
