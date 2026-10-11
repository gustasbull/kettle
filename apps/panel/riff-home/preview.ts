import { mountRiffHome } from './index.ts';
import { riffHomeFixture } from './fixtures.ts';

const root = document.getElementById('root');
if (root) {
  const view = mountRiffHome(root, async () => ({ status: 'sent', message: 'Preview handoff sent.' }));
  view.render(riffHomeFixture);
}
