import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { creatorPipelineScript } from '../panel/generated/creator-pipeline-bundle.ts';

export const CREATOR_PIPELINE_URI = 'ui://kettle/creator-pipeline-v3.html';
export const CREATOR_PIPELINE_V2_URI = 'ui://kettle/creator-pipeline-v2.html';
export const CREATOR_PIPELINE_MIME = 'text/html;profile=mcp-app';
export const CREATOR_PIPELINE_META = {
  'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'fullscreen' },
  ui: {
    prefersBorder: false,
    csp: {
      connectDomains: [],
      // The Paper discovery and analysis frames can render provider-observed
      // TikTok cover images. No scripts, API calls, frames, or arbitrary image
      // origins are permitted by this resource.
      resourceDomains: ['https://tiktokcdn.com', 'https://*.tiktokcdn.com'],
      frameDomains: [], baseUriDomains: [],
    },
    permissions: {},
  },
};

/** Only a build-produced, static bundle belongs here; never interpolate tool data. */
export function creatorPipelineHtml(script: string): string {
  // Prevent HTML's raw-text parser from recognizing script end tags or legacy
  // comment openers inside JavaScript strings. No server data enters this HTML.
  const safeScript = script.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Riff creator workflow</title></head>
<body><div id="root"><p role="status">Loading your Riff creator workflow…</p></div>
<script>${safeScript}</script></body></html>`;
}

export function registerCreatorPipelineResource(server: McpServer): void {
  const register = (name: string, uri: string) => server.registerResource(name, uri, {
      title: 'Riff creator workflow',
      description: 'Read-only saved Riff creator jobs, ideas and filming variants. Status refresh never starts paid work.',
      mimeType: CREATOR_PIPELINE_MIME, _meta: CREATOR_PIPELINE_META,
    }, async () => ({ contents: [{
      uri, mimeType: CREATOR_PIPELINE_MIME,
      text: creatorPipelineHtml(creatorPipelineScript), _meta: CREATOR_PIPELINE_META,
    }] }));
  register('kettle-creator-pipeline', CREATOR_PIPELINE_URI);
  register('kettle-creator-pipeline-v2-compat', CREATOR_PIPELINE_V2_URI);
}
