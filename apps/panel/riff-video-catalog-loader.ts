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
};

const scopeKey = (scope: RiffVideoCatalogScope) => JSON.stringify([scope.ownerKey, scope.projectId ?? null]);

/**
 * Provider-free first-page loader shared by the standalone and Home bridges. The caller
 * supplies the authenticated owner boundary; only the validated bounded page is
 * retained or published.
 */
export function createRiffVideoCatalogLoader(
  read: (args: CatalogReadArguments) => Promise<unknown>,
  publish: (page: RiffVideoCatalogPage | undefined) => void,
) {
  let selectedScope: string | undefined;
  let epoch = 0;
  let page: RiffVideoCatalogPage | undefined;
  let attempted = false;

  const reset = () => {
    epoch++;
    selectedScope = undefined;
    page = undefined;
    attempted = false;
    publish(undefined);
  };

  const select = (scope: RiffVideoCatalogScope) => {
    const nextScope = scopeKey(scope);
    if (selectedScope === nextScope) return;
    epoch++;
    selectedScope = nextScope;
    page = undefined;
    attempted = false;
    publish(undefined);
  };

  const load = async (scope: RiffVideoCatalogScope) => {
    select(scope);
    if (page) {
      publish(structuredClone(page));
      return;
    }
    if (attempted) return;
    attempted = true;
    const requestEpoch = epoch;
    const requestScope = selectedScope;
    const args: CatalogReadArguments = {
      ...(scope.projectId ? { project_id: scope.projectId } : {}),
      sort: 'observed_at_desc',
      limit: 8,
    };
    try {
      const result = riffVideosStructuredOutput(await read(args));
      if (requestEpoch !== epoch || requestScope !== selectedScope) return;
      if (!result?.ok) {
        attempted = false;
        return;
      }
      page = result.data;
      publish(structuredClone(page));
    } catch {
      // Discovery retains its approved empty/current-page state on read failure.
      if (requestEpoch === epoch && requestScope === selectedScope) attempted = false;
    }
  };

  return { load, reset };
}
