const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function accessibleLogo(document: Document, viewBox: string): SVGSVGElement {
  return svgNode(document, 'svg', {
    xmlns: SVG_NS,
    viewBox,
    preserveAspectRatio: 'xMinYMid meet',
    role: 'img',
    'aria-label': 'Riff',
    focusable: 'false',
    class: 'riff-logo',
  });
}

function appendSymbolPaths(document: Document, parent: SVGElement) {
  parent.append(
    svgNode(document, 'path', {
      'fill-rule': 'evenodd',
      d: 'M10 0H35C53 0 62 9 62 24C62 35 56 42 47 45H19V64H0V10C0 4 4 0 10 0ZM22 13C20 12 19 13 19 15V33C19 35 20 36 22 35L39 26C42 25 42 23 39 22L22 13Z',
      fill: 'currentColor',
    }),
    svgNode(document, 'path', {
      d: 'M27 49H48L62 64H40Z',
      fill: 'currentColor',
    }),
  );
}

/** Exact single-colour symbol master from the live Riff Paper brand board. */
export function riffSymbol(document: Document): SVGSVGElement {
  const svg = accessibleLogo(document, '0 0 64 64');
  const group = svgNode(document, 'g', {});
  appendSymbolPaths(document, group);
  svg.append(group);
  return svg;
}

/** Exact single-colour lockup master from the live Riff Paper brand board. */
export function riffLockup(document: Document): SVGSVGElement {
  const svg = accessibleLogo(document, '0 0 176 64');
  const symbol = svgNode(document, 'g', { transform: 'scale(.921875 1)' });
  appendSymbolPaths(document, symbol);
  const wordmark = svgNode(document, 'g', { transform: 'translate(29 10)' });
  wordmark.append(
    svgNode(document, 'path', { d: 'M40 18H53V54H40Z', fill: 'currentColor' }),
    svgNode(document, 'circle', { cx: '46.5', cy: '6.5', r: '6.5', fill: 'currentColor' }),
    svgNode(document, 'path', { d: 'M66 54V30H59V18H66V16C66 5 72 0 83 0H96V12H86C81 12 79 14 79 18H93V30H79V54Z', fill: 'currentColor' }),
    svgNode(document, 'path', { d: 'M107 54V30H100V18H107V16C107 5 113 0 124 0H137V12H127C122 12 120 14 120 18H134V30H120V54Z', fill: 'currentColor' }),
  );
  svg.append(symbol, wordmark);
  return svg;
}

