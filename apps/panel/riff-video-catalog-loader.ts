import {
  riffDiscoveryCatalogStructuredOutput,
  type RiffVideoCatalogPage,
} from './creator-pipeline-validation.ts';

export type RiffVideoCatalogScope = {
  /** A trusted, bridge-owned identity boundary. Never populate this from tool input. */
  ownerKey: string;
  projectId?: string;
};

export type RiffVideoCatalogState =
  | { status: 'loading'; page?: RiffVideoCatalogPage }
  | { status: 'ready'; page: RiffVideoCatalogPage }
  | { status: 'empty'; page: RiffVideoCatalogPage }
  | { status: 'error'; message: string; retryable: boolean; page?: RiffVideoCatalogPage };

type CatalogReadArguments = {
  project_id?: string;
  role: 'discovered_reference';
  sort: 'observed_at_desc';
  limit: 8;
};

const scopeKey = (scope: RiffVideoCatalogScope) => JSON.stringify([scope.ownerKey, scope.projectId ?? null]);
const clonePage = (page: RiffVideoCatalogPage | undefined) => page ? structuredClone(page) : undefined;

/**
 * Provider-free first-page loader shared by the standalone and Home bridges.
 * Reads are explicit, bounded, role-filtered, and isolated by a trusted owner scope.
 */
export function createRiffVideoCatalogLoader(
  read: (args: CatalogReadArguments) => Promise<unknown>,
  publish: (state: RiffVideoCatalogState) => void,
) {
  let selectedScope: string | undefined;
  let selected: RiffVideoCatalogScope | undefined;
  let epoch = 0;
  let page: RiffVideoCatalogPage | undefined;
  let state: RiffVideoCatalogState | undefined;
  let pending = false;

  const emit = (next: RiffVideoCatalogState) => {
    state = structuredClone(next);
    publish(structuredClone(next));
  };

  const reset = () => {
    epoch++;
    selectedScope = undefined;
    selected = undefined;
    page = undefined;
    state = undefined;
    pending = false;
    emit({ status: 'loading' });
  };

  const select = (scope: RiffVideoCatalogScope) => {
    const nextScope = scopeKey(scope);
    if (selectedScope === nextScope) return false;
    epoch++;
    selectedScope = nextScope;
    selected = { ...scope };
    page = undefined;
    state = undefined;
    pending = false;
    emit({ status: 'loading' });
    return true;
  };

  const request = async (scope: RiffVideoCatalogScope, force: boolean) => {
    const changed = select(scope);
    if (!changed && pending) return;
    if (!changed && !force && state && state.status !== 'loading' && state.status !== 'error') {
      publish(structuredClone(state));
      return;
    }
    if (!changed && !force && state?.status === 'error') return;

    pending = true;
    if (!changed) emit({ status: 'loading', ...(page ? { page: clonePage(page)! } : {}) });
    const requestEpoch = epoch;
    const requestScope = selectedScope;
    const args: CatalogReadArguments = {
      ...(scope.projectId ? { project_id: scope.projectId } : {}),
      role: 'discovered_reference',
      sort: 'observed_at_desc',
      limit: 8,
    };
    try {
      const result = riffDiscoveryCatalogStructuredOutput(await read(args));
      if (requestEpoch !== epoch || requestScope !== selectedScope) return;
      pending = false;
      if (!result?.ok) {
        const unavailable = result?.error.code === 'UNAVAILABLE';
        emit({
          status: 'error',
          message: unavailable
            ? 'Saved reference videos are temporarily unavailable.'
            : 'Saved reference videos could not be loaded.',
          retryable: result?.error.retryable ?? true,
          ...(page ? { page: clonePage(page)! } : {}),
        });
        return;
      }
      const candidate = result.data;
      page = structuredClone(candidate);
      emit(page.cards.length ? { status: 'ready', page: clonePage(page)! } : { status: 'empty', page: clonePage(page)! });
    } catch {
      if (requestEpoch !== epoch || requestScope !== selectedScope) return;
      pending = false;
      emit({
        status: 'error',
        message: 'Saved reference videos could not be loaded.',
        retryable: true,
        ...(page ? { page: clonePage(page)! } : {}),
      });
    }
  };

  const load = (scope: RiffVideoCatalogScope) => request(scope, false);
  const retry = (scope = selected) => scope ? request(scope, true) : Promise.resolve();

  return { load, retry, reset };
}
