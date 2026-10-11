import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { creatorReviewScript } from '../panel/generated/creator-review-bundle.ts';

export const CREATOR_REVIEW_URI = 'ui://kettle/creator-review-v2.html';
export const CREATOR_REVIEW_MIME = 'text/html;profile=mcp-app';
export const CREATOR_REVIEW_META = {
  'openai/ui': { availableDisplayModes: ['inline'] },
  ui: {
    prefersBorder: false,
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    permissions: {},
  },
};

/** Only a build-produced, static bundle belongs here; never interpolate tool data. */
export function creatorReviewHtml(script: string): string {
  // Prevent HTML's raw-text parser from recognizing script end tags or legacy
  // comment openers inside JavaScript strings. No server data enters this HTML.
  const safeScript = script.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Riff Creator DNA review</title></head>
<body><div id="root"><p role="status">Loading your Creator DNA review…</p></div>
<script>${safeScript}</script></body></html>`;
}

export function registerCreatorReviewResource(server: McpServer): void {
  server.registerResource('kettle-creator-review', CREATOR_REVIEW_URI, {
    title: 'Riff Creator DNA review',
    description: 'Read-only saved Riff Creator DNA review. Refresh after changes are saved in chat.',
    mimeType: CREATOR_REVIEW_MIME, _meta: CREATOR_REVIEW_META,
  }, async () => ({ contents: [{
    uri: CREATOR_REVIEW_URI, mimeType: CREATOR_REVIEW_MIME,
    text: creatorReviewHtml(creatorReviewScript), _meta: CREATOR_REVIEW_META,
  }] }));
}
