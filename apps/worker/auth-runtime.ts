import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { IdentityVerifier } from '../../packages/application/operations.ts';
import { observed, type CreatorLatencyObserver } from '../../packages/application/creator-observability.ts';
import {
  createMcpJwtVerifier,
  createWebsiteSessionVerifier,
  discover,
  validateConfig,
  type AuthConfig,
  type AuthMetadata,
  type IdentityResolver,
} from '../../packages/auth/index.ts';

const DEFAULT_CACHE_TTL_MILLISECONDS = 5 * 60 * 1_000;
const DEFAULT_MAX_CACHE_ENTRIES = 4;

export interface RemoteAuthInputs {
  /** Issuer-bound metadata validated by `discover`. */
  metadata: AuthMetadata;
  /** Public-key resolver. Its internal JWKS cache contains no bearer or account data. */
  verificationKey: JWTVerifyGetKey;
}

interface RemoteAuthInputsCacheOptions {
  ttlMilliseconds?: number;
  maxEntries?: number;
  now?: () => number;
}

interface RemoteAuthInputsCache {
  get(config: AuthConfig, fetcher?: typeof fetch, telemetry?: CreatorLatencyObserver): Promise<RemoteAuthInputs>;
}

/**
 * Bounded isolate-local cache for issuer metadata and public verification keys.
 * It deliberately excludes bearer tokens, resolved identities, database
 * credentials, and account state.
 */
export function createRemoteAuthInputsCache(
  options: RemoteAuthInputsCacheOptions = {},
  defaultTelemetry?: CreatorLatencyObserver,
): RemoteAuthInputsCache {
  const ttlMilliseconds = options.ttlMilliseconds ?? DEFAULT_CACHE_TTL_MILLISECONDS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(ttlMilliseconds) || ttlMilliseconds <= 0
    || !Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new Error('Invalid remote auth cache bounds');
  }
  const entries = new Map<string, {
    expiresAt: number;
    value: Promise<RemoteAuthInputs>;
  }>();

  return {
    get(rawConfig, fetcher = fetch, requestTelemetry) {
      const telemetry = requestTelemetry ?? defaultTelemetry;
      const config = validateConfig(rawConfig);
      const timestamp = now();
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= timestamp) entries.delete(key);
      }
      const cacheKey = JSON.stringify([config.issuer, config.resource]);
      const existing = entries.get(cacheKey);
      if (existing) {
        telemetry?.record({ stage: 'auth_metadata', clock: 'monotonic', status: 'ok',
          duration_ms: 0, cache_state: 'hit' });
        return existing.value;
      }

      const value = observed(telemetry,
        { stage: 'auth_metadata', clock: 'monotonic', cache_state: 'miss', endpoint: 'auth_discovery' },
        () => discover(config, fetcher)).then((metadata) => ({
        metadata,
        verificationKey: createRemoteJWKSet(new URL(metadata.jwks_uri), {
          timeoutDuration: 5_000,
          cacheMaxAge: ttlMilliseconds,
        }),
      }));
      const entry = { expiresAt: timestamp + ttlMilliseconds, value };
      entries.set(cacheKey, entry);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      // Discovery failures are fail-closed for this request but are not cached;
      // a later request can recover from a transient issuer outage.
      void value.catch(() => {
        if (entries.get(cacheKey) === entry) entries.delete(cacheKey);
      });
      return value;
    },
  };
}

const remoteAuthInputs = createRemoteAuthInputsCache();

/**
 * Share one verification result across the HTTP gate and the selected tool in
 * a single request graph. A new graph gets a new wrapper and therefore checks
 * identity revocation again. Only the first bearer is memoized, keeping the
 * request-local cache bounded even if this helper is misused.
 */
export function memoizeVerifierForRequest(verifier: IdentityVerifier): IdentityVerifier {
  let credential: string | undefined;
  let result: ReturnType<IdentityVerifier['verify']> | undefined;
  return {
    verify(candidate) {
      if (result && candidate === credential) return result;
      if (result) return verifier.verify(candidate);
      credential = candidate;
      result = Promise.resolve().then(() => verifier.verify(candidate));
      return result;
    },
  };
}

function lazyVerifierForRequest(
  config: AuthConfig,
  resolve: IdentityResolver,
  cache: RemoteAuthInputsCache,
  policy: 'mcp' | 'website',
  telemetry?: CreatorLatencyObserver,
): IdentityVerifier {
  let verifier: Promise<IdentityVerifier> | undefined;
  const lazy: IdentityVerifier = {
    async verify(token) {
      verifier ??= cache.get(config, fetch, telemetry).then(({ verificationKey }) => policy === 'mcp'
        ? createMcpJwtVerifier(config, resolve, verificationKey)
        : createWebsiteSessionVerifier(config, resolve, verificationKey));
      return observed(telemetry,
        { stage: 'auth_jwks', clock: 'monotonic', endpoint: 'auth_jwks' },
        () => verifier!.then(value => value.verify(token)));
    },
  };
  return memoizeVerifierForRequest(lazy);
}

export function createMcpVerifierForRequest(
  config: AuthConfig,
  resolve: IdentityResolver,
  cache: RemoteAuthInputsCache = remoteAuthInputs,
  telemetry?: CreatorLatencyObserver,
): IdentityVerifier {
  return lazyVerifierForRequest(config, resolve, cache, 'mcp', telemetry);
}

export function createWebsiteVerifierForRequest(
  config: AuthConfig,
  resolve: IdentityResolver,
  cache: RemoteAuthInputsCache = remoteAuthInputs,
  telemetry?: CreatorLatencyObserver,
): IdentityVerifier {
  return lazyVerifierForRequest(config, resolve, cache, 'website', telemetry);
}
