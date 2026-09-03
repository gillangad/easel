import { getAbsoluteRect, getArtboardForNode, getAsset, getDescendantIds } from './model';
import { serializeDocument } from './persistence';
import type { DesignNode, DocumentModel, ExportFormat } from './types';

export type PreparedExport = {
  blob: Blob;
  fileName: string;
  format: ExportFormat;
  artboardId?: string;
  width?: number;
  height?: number;
  unsupported: string[];
};

export type RenderedSvg = {
  svg: string;
  width: number;
  height: number;
  unsupported: string[];
};

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function escapeHtml(value: string): string {
  return escapeXml(value);
}

function safeFilename(value: string): string {
  return value.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'easel-export';
}

function styleAttributes(node: DesignNode): string {
  const style = node.style;
  return `fill="${escapeXml(style.fill)}" fill-opacity="${style.opacity}" stroke="${escapeXml(style.borderColor)}" stroke-width="${style.borderWidth}" rx="${style.borderRadius}"`;
}

function textLines(content: string, width: number, fontSize: number): string[] {
  const maxChars = Math.max(4, Math.floor(width / Math.max(5, fontSize * 0.54)));
  return content.split('\n').flatMap((line) => {
    if (!line) return [''];
    const words = line.split(/\s+/);
    const result: string[] = [];
    let current = '';
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxChars && current) {
        result.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) result.push(current);
    return result;
  });
}

function renderText(node: DesignNode, x: number, y: number): string {
  const style = node.style;
  const lines = textLines(node.content ?? '', node.width, style.fontSize);
  const lineHeight = style.fontSize * style.lineHeight;
  const anchor = style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start';
  const textX = style.textAlign === 'center' ? x + node.width / 2 : style.textAlign === 'right' ? x + node.width : x;
  const tspans = lines.map((line, index) => `<tspan x="${textX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join('');
  return `<text x="${textX}" y="${y + style.fontSize}" text-anchor="${anchor}" fill="${escapeXml(style.color)}" font-family="${escapeXml(style.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.fontWeight}" letter-spacing="${style.letterSpacing}" opacity="${style.opacity}">${tspans}</text>`;
}

function nodeTransform(node: DesignNode, x: number, y: number): string {
  if (!node.rotation) return '';
  const cx = x + node.width / 2;
  const cy = y + node.height / 2;
  return ` transform="rotate(${node.rotation} ${cx} ${cy})"`;
}

export function renderArtboardSvg(document: DocumentModel, artboardId: string, scale = 1): RenderedSvg {
  const artboard = document.nodes[artboardId];
  if (!artboard || artboard.type !== 'artboard') throw new Error(`No artboard has the ID “${artboardId}”.`);
  const unsupported: string[] = [];
  const clipId = `clip-${escapeXml(artboard.id)}`;
  const artboardRect = getAbsoluteRect(document, artboard.id);
  const renderNode = (nodeId: string): string => {
    const node = document.nodes[nodeId];
    if (!node || node.hidden) return '';
    const rect = getAbsoluteRect(document, node.id);
    const x = rect.x - artboardRect.x;
    const y = rect.y - artboardRect.y;
    const transform = nodeTransform(node, x, y);
    let body = '';
    if (node.type === 'text') body = renderText(node, x, y);
    else if (node.type === 'image') {
      const asset = getAsset(document, node.image?.assetId);
      if (asset?.dataUrl.startsWith('data:image/')) body = `<image href="${escapeXml(asset.dataUrl)}" x="${x}" y="${y}" width="${node.width}" height="${node.height}" preserveAspectRatio="none" opacity="${node.style.opacity}"/>`;
      else {
        unsupported.push(`${node.name}: unsupported or missing image asset`);
        body = `<rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" ${styleAttributes({ ...node, style: { ...node.style, fill: '#ecece9' } })}/>`;
      }
    } else {
      body = `<rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" ${styleAttributes(node)}/>`;
    }
    const children = node.childIds.map(renderNode).join('');
    const clip = node.layout?.clipContent ? ` clip-path="url(#clip-${escapeXml(node.id)})"` : '';
    const clipDef = node.layout?.clipContent ? `<clipPath id="clip-${escapeXml(node.id)}"><rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="${node.style.borderRadius}"/></clipPath>` : '';
    if (node.type === 'text' || node.type === 'image' || node.type === 'rectangle') return `${clipDef}<g${transform}${clip}>${body}${children}</g>`;
    return `${clipDef}<g${transform}${clip}>${body}${children}</g>`;
  };
  const defs = `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${artboard.width}" height="${artboard.height}"/></clipPath></defs>`;
  const artboardFill = `<rect x="0" y="0" width="${artboard.width}" height="${artboard.height}" fill="${escapeXml(artboard.style.fill)}" fill-opacity="${artboard.style.opacity}"/>`;
  const children = artboard.childIds.map(renderNode).join('');
  const width = Math.round(artboard.width * scale);
  const height = Math.round(artboard.height * scale);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${artboard.width} ${artboard.height}">${defs}<g clip-path="url(#${clipId})">${artboardFill}${children}</g></svg>`;
  return { svg, width, height, unsupported: [...new Set(unsupported)].slice(0, 12) };
}

function inlineCss(node: DesignNode, x: number, y: number, relative = true): string {
  const style = node.style;
  const position = relative ? `position:absolute;left:${x}px;top:${y}px;` : 'position:relative;';
  const layout = node.layout;
  const justifyContent = layout?.justifyContent === 'start' ? 'flex-start' : layout?.justifyContent === 'end' ? 'flex-end' : layout?.justifyContent;
  const alignItems = layout?.alignItems === 'start' ? 'flex-start' : layout?.alignItems === 'end' ? 'flex-end' : layout?.alignItems;
  const layoutCss = layout && layout.mode !== 'free'
    ? `display:flex;flex-direction:${layout.mode === 'flex-row' ? 'row' : 'column'};gap:${layout.gap}px;padding:${layout.padding}px;align-items:${alignItems};justify-content:${justifyContent};`
    : '';
  return `${position}width:${node.width}px;height:${node.height}px;box-sizing:border-box;background:${style.fill};opacity:${style.opacity};border:${style.borderWidth}px solid ${style.borderColor};border-radius:${style.borderRadius}px;color:${style.color};font-family:${style.fontFamily};font-size:${style.fontSize}px;font-weight:${style.fontWeight};line-height:${style.lineHeight};letter-spacing:${style.letterSpacing}px;text-align:${style.textAlign};overflow:${layout?.clipContent ? 'hidden' : 'visible'};transform:rotate(${node.rotation}deg);${layoutCss}`;
}

export function renderStaticHtml(document: DocumentModel, artboardId: string): { html: string; unsupported: string[] } {
  const artboard = document.nodes[artboardId];
  if (!artboard || artboard.type !== 'artboard') throw new Error(`No artboard has the ID “${artboardId}”.`);
  const unsupported: string[] = [];
  const renderNode = (nodeId: string): string => {
    const node = document.nodes[nodeId];
    if (!node || node.hidden) return '';
    const parent = node.parentId ? document.nodes[node.parentId] : undefined;
    const parentUsesFlow = Boolean(parent?.layout && parent.layout.mode !== 'free');
    const style = inlineCss(node, parentUsesFlow ? 0 : node.x, parentUsesFlow ? 0 : node.y, !parentUsesFlow);
    const children = node.childIds.map(renderNode).join('');
    if (node.type === 'text') return `<p data-node-id="${escapeHtml(node.id)}" style="${style};white-space:pre-wrap;margin:0;">${escapeHtml(node.content ?? '')}</p>${children}`;
    if (node.type === 'image') {
      const asset = getAsset(document, node.image?.assetId);
      if (!asset?.dataUrl.startsWith('data:image/')) unsupported.push(`${node.name}: unsupported or missing image asset`);
      const source = asset?.dataUrl.startsWith('data:image/') ? asset.dataUrl : '';
      return `<img data-node-id="${escapeHtml(node.id)}" src="${escapeHtml(source)}" alt="${escapeHtml(node.image?.alt ?? node.name)}" style="${style};object-fit:fill;"/>${children}`;
    }
    const tag = node.type === 'artboard' ? 'main' : 'div';
    return `<${tag} data-node-id="${escapeHtml(node.id)}" data-node-type="${node.type}" style="${style}">${children}</${tag}>`;
  };
  const children = artboard.childIds.map(renderNode).join('');
  const artboardStyle = inlineCss(artboard, 0, 0, false);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(artboard.name)}</title><style>html,body{margin:0;background:#fff}body{min-width:${artboard.width}px}main[data-node-id]{overflow:hidden;}</style></head><body><main data-node-id="${escapeHtml(artboard.id)}" data-node-type="artboard" style="${artboardStyle}">${children}</main></body></html>`;
  return { html, unsupported: [...new Set(unsupported)].slice(0, 12) };
}

function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

export async function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') throw new Error('PNG rendering is unavailable in this browser.');
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const loaded = new Image();
      loaded.onload = () => resolve(loaded);
      loaded.onerror = () => reject(new Error('The artboard contains an image or style the PNG renderer cannot read.'));
      loaded.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create a PNG surface.');
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not prepare a PNG.')), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareArtboardExport(document: DocumentModel, artboardId: string, format: ExportFormat, scale = 1): Promise<PreparedExport> {
  const artboard = document.nodes[artboardId];
  if (!artboard || artboard.type !== 'artboard') throw new Error(`No artboard has the ID “${artboardId}”.`);
  const baseName = safeFilename(artboard.name);
  if (format === 'json') {
    return { blob: new Blob([serializeDocument(document)], { type: 'application/json;charset=utf-8' }), fileName: `${baseName || 'document'}.json`, format, artboardId, unsupported: [] };
  }
  if (format === 'html') {
    const rendered = renderStaticHtml(document, artboardId);
    return { blob: new Blob([rendered.html], { type: 'text/html;charset=utf-8' }), fileName: `${baseName}.html`, format, artboardId, width: artboard.width, height: artboard.height, unsupported: rendered.unsupported };
  }
  const rendered = renderArtboardSvg(document, artboardId, format === 'png' ? scale : 1);
  if (format === 'svg') return { blob: svgBlob(rendered.svg), fileName: `${baseName}.svg`, format, artboardId, width: rendered.width, height: rendered.height, unsupported: rendered.unsupported };
  return { blob: await svgToPngBlob(rendered.svg, rendered.width, rendered.height), fileName: `${baseName}-${scale}x.png`, format, artboardId, width: rendered.width, height: rendered.height, unsupported: rendered.unsupported };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function snapshotId(): string {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `snapshot-${stamp}-${random}`;
}

export function getExportableNodeCount(document: DocumentModel, artboardId: string): number {
  return getDescendantIds(document, artboardId).length;
}

export function getExportableArtboard(document: DocumentModel, nodeId: string): DesignNode | undefined {
  return getArtboardForNode(document, nodeId);
}
