import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { projectReviewScript } from '../panel/generated/project-review-bundle.ts';

export const PROJECT_REVIEW_URI = 'ui://kettle/project-review-v1.html';
export const PROJECT_REVIEW_MIME = 'text/html;profile=mcp-app';
export const PROJECT_REVIEW_META = {
  'openai/ui': { availableDisplayModes: ['inline'] },
  ui: {
    prefersBorder: false,
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    permissions: {},
  },
};

/** Only a build-produced, static bundle belongs here; never interpolate tool data. */
export function projectReviewHtml(script: string): string {
  // Prevent HTML's raw-text parser from recognizing script end tags or legacy
  // comment openers inside JavaScript strings. No server data enters this HTML.
  const safeScript = script.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Riff project brief</title></head>
<body><div id="root"><p role="status">Loading your project brief…</p></div>
<script>${safeScript}</script></body></html>`;
}

export function registerProjectReviewResource(server: McpServer): void {
  server.registerResource('kettle-project-review', PROJECT_REVIEW_URI, {
    title: 'Riff project brief',
    description: 'Read-only saved Riff project brief. Refresh after changes are saved in chat.',
    mimeType: PROJECT_REVIEW_MIME, _meta: PROJECT_REVIEW_META,
  }, async () => ({ contents: [{
    uri: PROJECT_REVIEW_URI, mimeType: PROJECT_REVIEW_MIME,
    text: projectReviewHtml(projectReviewScript), _meta: PROJECT_REVIEW_META,
  }] }));
}
