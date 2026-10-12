import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('plugins/riff');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;

test('Riff is a portable, mixed-auth Agent Plugins package with complete assets', async () => {
  const manifest = await json(resolve(root, 'plugin.json'));
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.name, 'riff');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, '0.1.5', 'the fail-open Home and account-aware welcome recovery invalidate the installed package cache');
  assert.equal(manifest.extensions['com.openai'].onboardingSkill, './skills/setup/SKILL.md');
  const ui = manifest.extensions['com.openai'].interface;
  assert.equal(ui.displayName, 'Riff');
  assert.equal(ui.shortDescription, 'Plan videos worth filming');
  assert.ok(ui.shortDescription.length <= 30);
  assert.equal(ui.brandColor, '#3865F8');
  assert.ok(Array.isArray(ui.defaultPrompt) && ui.defaultPrompt.length > 0 && ui.defaultPrompt.length <= 3);
  assert.deepEqual([ui.logo, ui.composerIcon], ['./assets/logo.svg', './assets/composer-icon.svg']);
  for (const asset of [ui.logo, ui.composerIcon, manifest.extensions['com.openai'].onboardingSkill]) {
    assert.ok((await stat(resolve(root, asset))).isFile(), asset);
  }
  assert.ok(!('skills' in manifest) && !('mcpServers' in manifest) && !('apps' in manifest));

  const mcp = await json(resolve(root, 'mcp.json'));
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(mcp.mcpServers.riff, {
    type: 'streamable-http',
    url: 'https://kettle-stage2-development.g-baltramiejunas.workers.dev/mcp',
    extensions: { 'com.openai': { auth: {
      type: 'mixed',
      client: { mode: 'dcr' },
      resource: 'https://kettle-stage2-development.g-baltramiejunas.workers.dev/mcp',
      baseScopes: ['openid', 'offline_access'],
      defaultScopes: [],
    } } },
  });
  assert.equal(mcp.mcpServers.riff.extensions['com.openai'].auth.resource, mcp.mcpServers.riff.url);
  const packageText = `${JSON.stringify(manifest)}\n${JSON.stringify(mcp)}`;
  assert.doesNotMatch(packageText, /clientSecret|service.role|api[_-]?key|bearer\s+[a-z0-9]/i);

  for (const file of ['logo.svg', 'composer-icon.svg']) {
    const svg = await readFile(resolve(root, 'assets', file), 'utf8');
    assert.match(svg, /viewBox="0 0 (?:64|96) (?:64|96)"/);
    assert.match(svg, /fill="currentColor"/);
    assert.doesNotMatch(svg, /<(?:text|image)\b|xlink:href|fill="#[0-9A-Fa-f]/);
  }
});

test('Riff setup skill is narrowly triggered and keeps onboarding/account/provider claims honest', async () => {
  const skill = await readFile(resolve(root, 'skills/setup/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: setup\ndescription: .+\n---/);
  assert.match(skill, /installation|setup|connection|first use/i);
  const home = skill.indexOf('Call `open_riff`');
  assert.ok(home > 0, 'Home must trigger OAuth and open the independently usable app surface');
  assert.match(skill, /strict, coherent successful.*data\.account\.onboarding_seen_at.*null.*show_riff_welcome.*same originating response/is);
  assert.match(skill, /Never call `mark_riff_onboarding_seen` from the model/i);
  assert.match(skill, /onboarding_seen_at.*set.*do not call `show_riff_welcome` unless.*explicitly asks to replay/is);
  assert.match(skill, /failed, malformed, or omits the marker.*do not infer first use/is);
  assert.match(skill, /onboarding_seen_at.*null/i);
  assert.match(skill, /Start → Find → Make/);
  assert.match(skill, /explicit user request|explicit user action/i);
  assert.match(skill, /conversation|conversational/i);
  assert.match(skill, /complete only when.*inline welcome app confirms.*explicit completion write/is);
  assert.match(skill, /attach.*ChatGPT/i);
  assert.match(skill, /never.*(?:uploaded|upload receipt)/i);
  assert.match(skill, /recent work only from `list_riff_work`/i);
  assert.match(skill,
    /claim (?:Save|save), (?:Undo|undo), or (?:Filmed|filmed).*only after.*`set_riff_work_state`.*strict.*success.*receipt.*authoritative.*reconcil/is,
    'Save, Undo, and Filmed claims require both a strict write receipt and authoritative job reconciliation');
  assert.match(skill, /otherwise.*(?:unconfirmed|failure)/i,
    'an unverified work-state write must remain explicitly unconfirmed');
  assert.doesNotMatch(skill, /current tools do not expose those writes/i);
  assert.match(skill, /fetch|spend/i);
  assert.match(skill, /unavailable/i);

  const agent = await readFile(resolve(root, 'skills/setup/agents/openai.yaml'), 'utf8');
  assert.match(agent, /default_prompt: "Use \$setup/);
  assert.match(agent, /transport: "streamable_http"/);
  assert.match(agent, /url: "https:\/\/kettle-stage2-development\.g-baltramiejunas\.workers\.dev\/mcp"/);
  assert.match(agent, /brand_color: "#3865F8"/);

  const marketplace = await json(resolve('.agents/plugins/marketplace.json'));
  assert.equal(marketplace.name, 'riff-local');
  assert.deepEqual(marketplace.plugins, [{
    name: 'riff', source: { source: 'local', path: './plugins/riff' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Creativity',
  }]);
});
