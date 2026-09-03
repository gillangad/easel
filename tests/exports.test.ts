import { describe, expect, it } from 'vitest';
import { renderArtboardSvg, renderStaticHtml } from '../src/exports';
import { createInitialDocument, makeNode } from '../src/model';

describe('bounded export preparation', () => {
  it('renders editable nodes as escaped SVG and static HTML/CSS', () => {
    const document = createInitialDocument();
    document.nodes.site_title.content = '<unsafe> & text';
    const svg = renderArtboardSvg(document, 'artboard_website', 1);
    const html = renderStaticHtml(document, 'artboard_website');
    expect(svg.svg).toContain('&lt;unsafe&gt;');
    expect(svg.svg).not.toContain('<unsafe>');
    expect(html.html).toContain('data-node-type="frame"');
    expect(html.html).toContain('&lt;unsafe&gt;');
  });

  it('exports first-class shape vectors with bounded polygon sides', () => {
    const document = createInitialDocument();
    const polygon = makeNode({ id: 'test_polygon', type: 'polygon', name: 'Badge', pageId: 'page_canvas', parentId: 'artboard_website', x: 40, y: 40, width: 120, height: 120, shape: { sides: 5 }, style: { fill: '#d9c7b8', borderColor: '#171717', borderWidth: 2 } });
    document.nodes[polygon.id] = polygon;
    document.nodes.artboard_website.childIds.push(polygon.id);
    const svg = renderArtboardSvg(document, 'artboard_website', 1);
    expect(svg.svg).toContain('<polygon');
    expect(svg.svg).toContain('points=');
  });
});
