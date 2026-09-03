import { describe, expect, it } from 'vitest';
import { renderArtboardSvg, renderStaticHtml } from '../src/exports';
import { createInitialDocument } from '../src/model';

describe('bounded export preparation', () => {
  it('renders editable nodes as escaped SVG and static HTML/CSS', () => {
    const document = createInitialDocument();
    document.nodes.site_title.content = '<unsafe> & text';
    const svg = renderArtboardSvg(document, 'artboard_website', 1);
    const html = renderStaticHtml(document, 'artboard_website');
    expect(svg.svg).toContain('&lt;unsafe&gt;');
    expect(svg.svg).not.toContain('<unsafe>');
    expect(html.html).toContain('data-node-type="artboard"');
    expect(html.html).toContain('&lt;unsafe&gt;');
  });
});
