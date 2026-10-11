import { mountRiffHome } from './index.ts';
import { riffHomeFixture } from './fixtures.ts';

const root = document.getElementById('root');
if (root) {
  const action = async () => ({ status: 'sent' as const, message: 'Preview action completed.' });
  const view = mountRiffHome(root, { start: action, send: action, upload: action, showWelcome: action });
  view.render(riffHomeFixture);
}
