import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OpenAIUiResourceMetadata } from '@openai/mcp-extensions/server';
import { riffOnboardingScript, riffOnboardingFingerprint } from '../panel/generated/riff-onboarding-bundle.ts';

export const RIFF_ONBOARDING_URI = 'ui://riff/onboarding-v1.html';
export const RIFF_ONBOARDING_MIME = 'text/html;profile=mcp-app';
const openaiUi = {
  availableDisplayModes: ['inline'], preferredDisplayMode: 'inline',
} satisfies OpenAIUiResourceMetadata;
export const RIFF_ONBOARDING_META = {
  'openai/ui': openaiUi,
  ui: {
    prefersBorder: false,
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    permissions: {},
  },
};

export function riffOnboardingHtml(script: string, fingerprint?: {resource_version:string;bundle_version:string}): string {
  const safeScript = script.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const version = fingerprint && /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(fingerprint.resource_version) && /^sha256:[a-f0-9]{64}$/.test(fingerprint.bundle_version)
    ? `<meta name="riff-bundle-version" content="${fingerprint.bundle_version}" data-resource-version="${fingerprint.resource_version}">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${version}<meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to Riff</title></head><body><div id="root"><p role="status">Welcome to Riff. Loading your guide…</p></div><script>${safeScript}</script></body></html>`;
}

export function registerRiffOnboardingResource(server: McpServer): void {
  server.registerResource('riff-onboarding', RIFF_ONBOARDING_URI, {
    description: 'A three-step introduction to starting, finding, and making with Riff.',
    mimeType: RIFF_ONBOARDING_MIME, _meta: RIFF_ONBOARDING_META,
  }, async () => ({ contents: [{
    uri: RIFF_ONBOARDING_URI, mimeType: RIFF_ONBOARDING_MIME,
    text: riffOnboardingHtml(riffOnboardingScript, riffOnboardingFingerprint), _meta: RIFF_ONBOARDING_META,
  }] }));
}
