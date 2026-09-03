import { describe, expect, it } from 'vitest';
import { createInitialDocument, createInitialState } from '../src/model';
import { deserializeEditorState, serializeEditorState } from '../src/persistence';

describe('File persistence', () => {
  it('seeds the After Hours Book Club Frames with the dark palette, exact targets, bindings, and no reference Asset', () => {
    const document = createInitialDocument();
    expect(document.name).toBe('After Hours Book Club');
    expect(document.assets).toEqual({});
    expect(Object.values(document.assets).some((asset) => asset.originalName === 'book-club-reference.jpg')).toBe(false);
    expect(document.nodes.artboard_website.style.fill).toBe('#4A3328');
    expect(document.nodes.artboard_graphic.style.fill).toBe('#4A3328');
    expect(document.nodes.website_background.style.fill).toBe('#4A3328');
    expect(document.nodes.graphic_background.style.fill).toBe('#4A3328');
    expect(document.nodes.website_background.name).toBe('Website Background');
    expect(document.nodes.graphic_background.name).toBe('Graphic Background');
    expect(document.nodes.site_title).toEqual(expect.objectContaining({ name: 'Website Title', content: 'After Hours Book Club' }));
    expect(document.nodes.graphic_title).toEqual(expect.objectContaining({ name: 'Graphic Subtitle', content: 'Quiet books. Good company.' }));
    expect(document.nodes.graphic_tagline).toEqual(expect.objectContaining({ name: 'Graphic Secondary Line', content: 'Bring a friend.' }));
    expect(document.nodes.graphic_image).toEqual(expect.objectContaining({ name: 'Graphic Image Area', type: 'rectangle', hidden: false, width: 416, height: 194 }));
    expect(document.nodes.graphic_image_hint).toEqual(expect.objectContaining({ name: 'Graphic placeholder hint', hidden: false }));
    const targetNames = ['Website Date', 'Website Time', 'Website Venue', 'Graphic Date', 'Graphic Time', 'Graphic Venue'];
    targetNames.forEach((name) => expect(Object.values(document.nodes).filter((node) => node.name === name)).toHaveLength(1));
    expect(document.nodes.site_date.content).toBe('Date TBA');
    expect(document.nodes.site_time.content).toBe('Time TBA');
    expect(document.nodes.site_location.content).toBe('Venue TBA');
    expect(document.nodes.graphic_date.content).toBe('Date TBA');
    expect(document.nodes.graphic_time.content).toBe('Time TBA');
    expect(document.nodes.graphic_location.content).toBe('Venue TBA');
    expect(document.nodes.site_date.binding).toEqual(expect.objectContaining({ key: 'event.date', sharedValue: 'Date TBA' }));
    expect(document.nodes.site_time.binding).toEqual(expect.objectContaining({ key: 'event.time', sharedValue: 'Time TBA' }));
    expect(document.nodes.site_location.binding).toEqual(expect.objectContaining({ key: 'event.venue', sharedValue: 'Venue TBA' }));
    expect(document.nodes.graphic_date.binding).toEqual(expect.objectContaining({ key: 'event.date', sharedValue: 'Date TBA' }));
    expect(document.nodes.graphic_time.binding).toEqual(expect.objectContaining({ key: 'event.time', sharedValue: 'Time TBA' }));
    expect(document.nodes.graphic_location.binding).toEqual(expect.objectContaining({ key: 'event.venue', sharedValue: 'Venue TBA' }));
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
    expect(restored.files.map((file) => file.name)).toEqual(['After Hours Book Club', 'Second File']);
    expect(restored.files[1].open).toBe(false);
    expect(restored.files[1].document.nodes.site_title.content).toBe('A separate draft');
    expect(restored.document.name).toBe('After Hours Book Club');
    expect(restored.document.nodes.site_title.content).toContain('After Hours');
  });

  it('migrates only the untouched legacy starter record to the deterministic After Hours Book Club File', () => {
    const legacy = createInitialDocument();
    legacy.revision = 1;
    legacy.pages[0].name = 'Launch set';
    legacy.nodes.site_title.name = 'Event title';
    legacy.nodes.site_title.content = 'Make room for a new idea';
    delete legacy.nodes.site_tagline;
    const restored = deserializeEditorState(JSON.stringify({ version: 1, document: legacy }));
    expect(restored.document.name).toBe('After Hours Book Club');
    expect(restored.document.nodes.site_title.content).toBe('After Hours Book Club');
    expect(restored.document.nodes.graphic_title.content).toBe('Quiet books. Good company.');
    expect(restored.document.assets).toEqual({});
  });

  it('migrates the untouched dark Book Club seed without overwriting edited files', () => {
    const legacy = createInitialDocument();
    legacy.name = 'Book Club';
    legacy.revision = 1;
    legacy.nodes.artboard_website.style.fill = '#3b251c';
    legacy.nodes.artboard_graphic.style.fill = '#3b251c';
    legacy.nodes.website_background.style.fill = '#3b251c';
    legacy.nodes.graphic_background.style.fill = '#3b251c';
    legacy.nodes.site_title.content = 'After Hours Book Club';
    legacy.nodes.graphic_title.content = 'Quiet books. Good company.';
    legacy.nodes.graphic_tagline.content = 'Bring a friend.';
    const restored = deserializeEditorState(JSON.stringify({ version: 2, document: legacy }));
    expect(restored.document.name).toBe('After Hours Book Club');
    expect(restored.document.nodes.website_background.style.fill).toBe('#4A3328');
    expect(restored.document.nodes.graphic_image.hidden).toBe(false);
    expect(restored.files[0].name).toBe('After Hours Book Club');

    legacy.nodes.site_title.content = 'A real edited draft';
    const preserved = deserializeEditorState(JSON.stringify({ version: 2, document: legacy }));
    expect(preserved.document.nodes.site_title.content).toBe('A real edited draft');
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
