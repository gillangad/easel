import { describe, expect, it } from 'vitest';
import { clampLeftPanelWidth, createInitialDocument, DEFAULT_PANELS, getAncestorIds, getLeftPanelBounds, normalizePanels } from '../src/model';

describe('left panel sizing', () => {
  it('uses the requested default, minimum, and maximum bounds', () => {
    expect(DEFAULT_PANELS.leftWidth).toBe(244);
    expect(clampLeftPanelWidth(100, 1200)).toBe(200);
    expect(clampLeftPanelWidth(999, 1200)).toBe(420);
  });

  it('caps the panel at forty percent and remains safe on narrow viewports', () => {
    expect(getLeftPanelBounds(600)).toEqual({ minimum: 200, maximum: 240 });
    expect(clampLeftPanelWidth(420, 600)).toBe(240);
    expect(getLeftPanelBounds(400)).toEqual({ minimum: 160, maximum: 160 });
    expect(clampLeftPanelWidth(200, 400)).toBe(160);
  });

  it('normalizes persisted panel state from older records', () => {
    expect(normalizePanels({ leftOpen: false, rightOpen: true })).toEqual({ leftOpen: false, rightOpen: true, leftWidth: 244 });
    expect(normalizePanels({ leftWidth: 999 })).toEqual({ leftOpen: true, rightOpen: true, leftWidth: 420 });
  });

  it('seeds the Canvas with named Frames and stable Layer ancestry', () => {
    const document = createInitialDocument();
    expect(document.pages[0].rootIds.map((id) => document.nodes[id].name)).toEqual(['Website', 'Graphic']);
    expect(getAncestorIds(document, 'site_title')).toEqual(['artboard_website']);
    expect(getAncestorIds(document, 'site_wordmark')).toEqual(['site_header', 'artboard_website']);
  });
});
