import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OpenAIUiResourceMetadata } from '@openai/mcp-extensions/server';
import { riffHomeScript } from '../panel/generated/riff-home-bundle.ts';

export const RIFF_HOME_URI = 'ui://riff/home-v2.html';
export const RIFF_HOME_LEGACY_URI = 'ui://riff/home-v1.html';
export const RIFF_HOME_MIME = 'text/html;profile=mcp-app';
const openaiUi = {
  availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen',
} satisfies OpenAIUiResourceMetadata;
export const RIFF_HOME_META = {
  'openai/ui': openaiUi,
  ui: {
    prefersBorder: false,
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    permissions: {},
  },
};

export function riffHomeHtml(script: string): string {
  const safeScript = script.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Riff Home</title></head><body><div id="root"><p role="status">Loading Riff Home…</p></div><script>${safeScript}</script></body></html>`;
}

export function registerRiffHomeResource(server: McpServer): void {
  const register = (name: string, uri: string) => server.registerResource(name, uri, {
    description: 'Riff Home for creator input, discovery shortcuts, and honest saved-work handoffs.',
    mimeType: RIFF_HOME_MIME, _meta: RIFF_HOME_META,
  }, async () => ({ contents: [{
    uri, mimeType: RIFF_HOME_MIME, text: riffHomeHtml(riffHomeScript), _meta: RIFF_HOME_META,
  }] }));
  register('riff-home', RIFF_HOME_URI);
  // Existing ChatGPT turns keep the resource URI from their original tool
  // result. Preserve one compatibility alias while v2 becomes the cache key.
  register('riff-home-v1-compat', RIFF_HOME_LEGACY_URI);
}
