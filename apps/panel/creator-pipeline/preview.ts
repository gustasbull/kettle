import { mountCreatorPipeline, type RiffCreatorDisplayMode } from './index.ts';
import { pipelineFixture, scenarioNames, type Scenario } from './fixtures.ts';
const mode = document.querySelector<HTMLSelectElement>('#mode')!;
const view = mountCreatorPipeline(document.querySelector<HTMLElement>('#review')!, {
  displayMode: 'fullscreen',
  sendPrompt: async () => ({ status: 'sent', message: 'Local preview handoff only.' }),
  requestFullscreen: async () => { mode.value = 'fullscreen'; view.setDisplayMode('fullscreen'); return { status: 'sent', message: 'Opened fullscreen preview.' }; },
});
const scenario = document.querySelector<HTMLSelectElement>('#scenario')!;
for (const name of scenarioNames) scenario.add(new Option(name, name));
const params = new URLSearchParams(location.search);
if (scenarioNames.includes(params.get('scenario') as Scenario)) scenario.value = params.get('scenario')!;
const render = () => view.render(pipelineFixture(scenario.value as Scenario));
scenario.addEventListener('change', render);
mode.value = params.get('mode') === 'inline' ? 'inline' : 'fullscreen';
mode.addEventListener('change', () => view.setDisplayMode(mode.value as RiffCreatorDisplayMode));
view.setDisplayMode(mode.value as RiffCreatorDisplayMode);
const theme = document.querySelector<HTMLSelectElement>('#theme')!;
theme.value = params.get('theme') === 'dark' ? 'dark' : 'light';
const setTheme = () => { document.documentElement.style.colorScheme = theme.value; };
theme.addEventListener('change', setTheme);
setTheme(); render();
