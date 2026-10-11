import {
  riffVideosStructuredOutput,
  type RiffVideoCatalogPage,
} from './creator-pipeline-validation.ts';

export type RiffVideoCatalogScope = {
  /** A trusted, bridge-owned identity boundary. Never populate this from tool input. */
  ownerKey: string;
  projectId?: string;
};

type CatalogReadArguments = {
  project_id?: string;
  sort: 'observed_at_desc';
  limit: 8;
  cursor?: string;
};

const scopeKey = (scope: RiffVideoCatalogScope) => JSON.stringify([scope.ownerKey, scope.projectId ?? null]);

/**
 * Provider-free pager shared by the standalone and Home bridges. The caller
 * supplies the authenticated owner boundary; only validated read pages are
 * retained or published.
 */
export function createRiffVideoCatalogLoader(
  read: (args: CatalogReadArguments) => Promise<unknown>,
  publish: (page: RiffVideoCatalogPage | undefined) => void,
) {
  let selectedScope: string | undefined;
  let epoch = 0;
  let page: RiffVideoCatalogPage | undefined;
  let attempted = new Set<string>();

  const reset = () => {
    epoch++;
    selectedScope = undefined;
    page = undefined;
    attempted = new Set();
    publish(undefined);
  };

  const select = (scope: RiffVideoCatalogScope) => {
    const nextScope = scopeKey(scope);
    if (selectedScope === nextScope) return;
    epoch++;
    selectedScope = nextScope;
    page = undefined;
    attempted = new Set();
    publish(undefined);
  };

  const load = async (scope: RiffVideoCatalogScope, cursor?: string) => {
    select(scope);
    if (!cursor && page) {
      publish(structuredClone(page));
      return;
    }
    if (cursor && page?.next_cursor !== cursor) return;
    const requestKey = cursor ?? 'first-page';
    if (attempted.has(requestKey)) return;
    attempted.add(requestKey);
    const requestEpoch = epoch;
    const requestScope = selectedScope;
    const args: CatalogReadArguments = {
      ...(scope.projectId ? { project_id: scope.projectId } : {}),
      sort: 'observed_at_desc',
      limit: 8,
      ...(cursor ? { cursor } : {}),
    };
    try {
      const result = riffVideosStructuredOutput(await read(args));
      if (!result?.ok || requestEpoch !== epoch || requestScope !== selectedScope) return;
      if (cursor && page?.next_cursor !== cursor) return;
      if (!cursor) page = result.data;
      else {
        const known = new Set(page!.cards.map(card => card.id));
        page = {
          ...result.data,
          cards: [...page!.cards, ...result.data.cards.filter(card => !known.has(card.id))],
        };
      }
      publish(structuredClone(page));
    } catch {
      // Discovery retains its approved empty/current-page state on read failure.
    }
  };

  return { load, reset };
}
