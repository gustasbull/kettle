import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OpenAIUiResourceMetadata } from '@openai/mcp-extensions/server';
import { riffHomeScript, riffHomeFingerprint } from '../panel/generated/riff-home-bundle.ts';

export const RIFF_HOME_URI = 'ui://riff/home-v3.html';
export const RIFF_HOME_V2_URI = 'ui://riff/home-v2.html';
export const RIFF_HOME_LEGACY_URI = 'ui://riff/home-v1.html';
export const RIFF_HOME_MIME = 'text/html;profile=mcp-app';
const openaiUi = {
  availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen',
} satisfies OpenAIUiResourceMetadata;
export const RIFF_HOME_META = {
  'openai/ui': openaiUi,
  ui: {
    prefersBorder: false,
    // Home owns the full creator flow after a user starts or reopens work, so
    // it needs the same narrow, contract-validated TikTok cover-image policy
    // as the standalone creator result resource.
    csp: {
      connectDomains: [],
      resourceDomains: ['https://tiktokcdn.com', 'https://*.tiktokcdn.com'],
      frameDomains: [], baseUriDomains: [],
    },
    permissions: {},
  },
};

export function riffHomeHtml(script: string, fingerprint?: {resource_version:string;bundle_version:string}): string {
  const safeScript = script.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const version = fingerprint && /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(fingerprint.resource_version)
    && /^sha256:[a-f0-9]{64}$/.test(fingerprint.bundle_version)
    ? `<meta name="riff-bundle-version" content="${fingerprint.bundle_version}" data-resource-version="${fingerprint.resource_version}">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${version}<meta name="viewport" content="width=device-width,initial-scale=1"><title>Riff Home</title></head><body><div id="root"><p role="status">Loading Riff Home…</p></div><script>${safeScript}</script></body></html>`;
}
export const RIFF_HOME_DOCUMENT = riffHomeHtml(riffHomeScript, riffHomeFingerprint);

export function registerRiffHomeResource(server: McpServer): void {
  const register = (name: string, uri: string) => server.registerResource(name, uri, {
    description: 'Riff Home for creator input, discovery shortcuts, and honest saved-work handoffs.',
    mimeType: RIFF_HOME_MIME, _meta: RIFF_HOME_META,
  }, async () => ({ contents: [{
    uri, mimeType: RIFF_HOME_MIME, text: RIFF_HOME_DOCUMENT, _meta: RIFF_HOME_META,
  }] }));
  register('riff-home', RIFF_HOME_URI);
  // Existing ChatGPT turns keep the resource URI from their original tool
  // result. Preserve compatibility aliases while v3 becomes the cache key.
  register('riff-home-v2-compat', RIFF_HOME_V2_URI);
  register('riff-home-v1-compat', RIFF_HOME_LEGACY_URI);
}
