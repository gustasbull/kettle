export type StrictJsonObject = Record<string, unknown>;
export type StrictCallToolResult = {
  structuredContent: StrictJsonObject;
  isError?: boolean;
};

function strictObject(value: unknown): StrictJsonObject | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => !('value' in descriptor) || !descriptor.enumerable)) return;
  return value as StrictJsonObject;
}

export function strictObjectShape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): StrictJsonObject | undefined {
  try {
    const item = strictObject(value); if (!item) return;
    const allowed = new Set([...required, ...optional]);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string' || !allowed.has(key))) return;
    if (!required.every(key => Object.hasOwn(descriptors, key))) return;
    if (optional.some(key => Object.hasOwn(descriptors, key) && descriptors[key]?.value === undefined)) return;
    return item;
  } catch { return; }
}

function strictArrayValues(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor) || lengthDescriptor.enumerable
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return;
  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) return;
  const result = new Array<unknown>(length);
  let sawLength = false;
  for (const key of keys) {
    if (key === 'length') { sawLength = true; continue; }
    if (typeof key !== 'string') return;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) return;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return;
    result[index] = descriptor.value;
  }
  return sawLength ? result : undefined;
}

const STRICT_JSON_MAX_DEPTH = 100;
const STRICT_JSON_MAX_NODES = 10_000;
const STRICT_JSON_MAX_KEYS = 20_000;
const STRICT_JSON_MAX_STRING_CODE_UNITS = 1_048_576;
const STRICT_JSON_MAX_STRING_UTF8_BYTES = 1_048_576;
const STRICT_JSON_MAX_TOTAL_UTF8_BYTES = 4_194_304;

type JsonSnapshot = {
  source: object;
  array: boolean;
  prototype: object | null;
  descriptors: Map<PropertyKey, PropertyDescriptor>;
  keys: PropertyKey[];
};
type JsonCopyContext = {
  nodes: number;
  keys: number;
  bytes: number;
  ancestors: Set<object>;
  snapshots: JsonSnapshot[];
};

function descriptorAt(descriptors: Map<PropertyKey, PropertyDescriptor>, key: PropertyKey): PropertyDescriptor | undefined {
  return descriptors.get(key);
}

function utf8Bytes(value: string, maximum: number): number | undefined {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4; index += 1;
    } else bytes += 3;
    if (bytes > maximum) return;
  }
  return bytes;
}

function countString(value: string, context: JsonCopyContext) {
  if (value.length > STRICT_JSON_MAX_STRING_CODE_UNITS) return false;
  const remaining = Math.min(STRICT_JSON_MAX_STRING_UTF8_BYTES,
    STRICT_JSON_MAX_TOTAL_UTF8_BYTES - context.bytes);
  if (remaining < 0) return false;
  const bytes = utf8Bytes(value, remaining); if (bytes === undefined) return false;
  context.bytes += bytes;
  return true;
}

function captureJsonSnapshot(value: object, context: JsonCopyContext): JsonSnapshot | undefined {
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype)) return;
  const descriptors = new Map<PropertyKey, PropertyDescriptor>();
  let keys: PropertyKey[];
  let valueKeyCount: number;
  if (array) {
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (!length || !('value' in length) || length.enumerable
      || !Number.isSafeInteger(length.value) || length.value < 0
      || length.value > STRICT_JSON_MAX_KEYS - context.keys) return;
    keys = Reflect.ownKeys(value);
    if (keys.length !== length.value + 1 || !keys.includes('length')) return;
    descriptors.set('length', length);
    valueKeyCount = length.value;
  } else {
    keys = Reflect.ownKeys(value);
    valueKeyCount = keys.length;
    if (valueKeyCount > STRICT_JSON_MAX_KEYS - context.keys) return;
  }
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor) return;
    descriptors.set(key, descriptor);
  }
  context.keys += valueKeyCount;
  const snapshot = { source: value, array, prototype, descriptors, keys };
  context.snapshots.push(snapshot);
  return snapshot;
}

function unchangedJsonSnapshot(snapshot: JsonSnapshot) {
  if (Array.isArray(snapshot.source) !== snapshot.array
    || Object.getPrototypeOf(snapshot.source) !== snapshot.prototype) return false;
  if (snapshot.array) {
    const beforeLength = descriptorAt(snapshot.descriptors, 'length');
    const afterLength = Object.getOwnPropertyDescriptor(snapshot.source, 'length');
    if (!sameDataDescriptor(beforeLength, afterLength)) return false;
  }
  const keys = Reflect.ownKeys(snapshot.source);
  if (keys.length !== snapshot.keys.length
    || keys.some((key, index) => key !== snapshot.keys[index])) return false;
  for (const key of snapshot.keys) {
    const before = descriptorAt(snapshot.descriptors, key);
    const after = Object.getOwnPropertyDescriptor(snapshot.source, key);
    if (!sameDataDescriptor(before, after)) return false;
  }
  return true;
}

function sameDataDescriptor(before: PropertyDescriptor | undefined, after: PropertyDescriptor | undefined) {
  return !!before && !!after && 'value' in before && 'value' in after
    && before.enumerable === after.enumerable && before.configurable === after.configurable
    && before.writable === after.writable && Object.is(before.value, after.value);
}

function preflightStrictJsonValue(value: unknown, context: JsonCopyContext, depth: number): boolean {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return countString(value, context);
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > STRICT_JSON_MAX_DEPTH
    || context.nodes >= STRICT_JSON_MAX_NODES || context.ancestors.has(value)) return false;
  context.nodes += 1;
  context.ancestors.add(value);
  try {
    const snapshot = captureJsonSnapshot(value, context); if (!snapshot) return false;
    if (snapshot.array) {
      const length = descriptorAt(snapshot.descriptors, 'length');
      if (!length || !('value' in length) || length.enumerable
        || !Number.isSafeInteger(length.value) || length.value < 0
        || snapshot.keys.length !== length.value + 1) return false;
      for (let index = 0; index < length.value; index += 1) {
        const key = String(index);
        const descriptor = descriptorAt(snapshot.descriptors, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined
          || !preflightStrictJsonValue(descriptor.value, context, depth + 1)) return false;
      }
      return true;
    }
    for (const key of snapshot.keys) {
      if (typeof key !== 'string' || !countString(key, context)) return false;
      const descriptor = descriptorAt(snapshot.descriptors, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined
        || !preflightStrictJsonValue(descriptor.value, context, depth + 1)) return false;
    }
    return true;
  } finally { context.ancestors.delete(value); }
}

/** Admit only descriptor-safe JSON that can cross the platform's immutable serialization boundary. */
export function cloneStrictJsonObject(raw: unknown): StrictJsonObject | undefined {
  try {
    const context: JsonCopyContext = { nodes: 0, keys: 0, bytes: 0, ancestors: new Set(), snapshots: [] };
    if (!preflightStrictJsonValue(raw, context, 0)) return;
    // Check children before parents so a nested trap that mutates an ancestor is observed.
    for (let index = context.snapshots.length - 1; index >= 0; index -= 1) {
      if (!unchangedJsonSnapshot(context.snapshots[index]!)) return;
    }
    // Reflection cannot identify every transparent Proxy; the platform clone is the trust boundary.
    if (typeof globalThis.structuredClone !== 'function') return;
    const cloned = globalThis.structuredClone(raw);
    return strictObject(cloned);
  } catch { return; }
}

function meta(value: unknown) {
  return !!strictObject(value);
}

const isoDateTime = /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function annotations(value: unknown) {
  const item = strictObjectShape(value, [], ['audience', 'priority', 'lastModified']); if (!item) return false;
  if (item.audience !== undefined) {
    const audience = strictArrayValues(item.audience); if (!audience) return false;
    if (audience.some(role => role !== 'user' && role !== 'assistant')) return false;
  }
  if (item.priority !== undefined && (typeof item.priority !== 'number' || !Number.isFinite(item.priority)
    || item.priority < 0 || item.priority > 1)) return false;
  return item.lastModified === undefined || typeof item.lastModified === 'string' && isoDateTime.test(item.lastModified);
}

function icons(value: unknown) {
  const values = strictArrayValues(value); if (!values) return false;
  for (const icon of values) {
    const item = strictObjectShape(icon, ['src'], ['mimeType', 'sizes', 'theme']);
    if (!item || typeof item.src !== 'string') return false;
    if (item.mimeType !== undefined && typeof item.mimeType !== 'string') return false;
    if (item.theme !== undefined && item.theme !== 'light' && item.theme !== 'dark') return false;
    if (item.sizes !== undefined) {
      const sizes = strictArrayValues(item.sizes); if (!sizes || sizes.some(size => typeof size !== 'string')) return false;
    }
  }
  return true;
}

function base64(value: unknown) {
  if (typeof value !== 'string') return false;
  try { atob(value); return true; } catch { return false; }
}

function resourceContents(value: unknown) {
  const source = strictObject(value); if (!source) return false;
  const blob = Object.hasOwn(source, 'blob');
  const item = strictObjectShape(source, blob ? ['uri', 'blob'] : ['uri', 'text'], ['mimeType', '_meta']);
  return !!item && typeof item.uri === 'string' && (blob ? base64(item.blob) : typeof item.text === 'string')
    && (item.mimeType === undefined || typeof item.mimeType === 'string')
    && (item._meta === undefined || meta(item._meta));
}

function contentBlock(value: unknown) {
  const source = strictObject(value); if (!source || typeof source.type !== 'string') return false;
  const shared = (item: StrictJsonObject) =>
    (item.annotations === undefined || annotations(item.annotations))
    && (item._meta === undefined || meta(item._meta));
  if (source.type === 'text') {
    const item = strictObjectShape(source, ['type', 'text'], ['annotations', '_meta']);
    return !!item && typeof item.text === 'string' && shared(item);
  }
  if (source.type === 'image' || source.type === 'audio') {
    const item = strictObjectShape(source, ['type', 'data', 'mimeType'], ['annotations', '_meta']);
    return !!item && base64(item.data) && typeof item.mimeType === 'string' && shared(item);
  }
  if (source.type === 'resource_link') {
    const item = strictObjectShape(source, ['type', 'name', 'uri'],
      ['title', 'description', 'mimeType', 'annotations', 'size', 'icons', '_meta']);
    return !!item && typeof item.name === 'string' && typeof item.uri === 'string'
      && (item.title === undefined || typeof item.title === 'string')
      && (item.description === undefined || typeof item.description === 'string')
      && (item.mimeType === undefined || typeof item.mimeType === 'string')
      && (item.size === undefined || typeof item.size === 'number' && Number.isFinite(item.size))
      && (item.icons === undefined || icons(item.icons)) && shared(item);
  }
  if (source.type === 'resource') {
    const item = strictObjectShape(source, ['type', 'resource'], ['annotations', '_meta']);
    return !!item && resourceContents(item.resource) && shared(item);
  }
  return false;
}

export function isBusinessResultFlagCoherent(result: StrictCallToolResult, succeeded: boolean) {
  return result.isError === undefined || result.isError === !succeeded;
}

export function parseStrictCallToolResult(raw: unknown): StrictCallToolResult | undefined {
  try {
    const canonical = cloneStrictJsonObject(raw); if (!canonical) return;
    const outer = strictObjectShape(canonical, ['structuredContent'], ['content', 'isError', '_meta']);
    if (!outer || Object.hasOwn(outer, 'isError') && typeof outer.isError !== 'boolean'
      || Object.hasOwn(outer, '_meta') && !meta(outer._meta)) return;
    if (Object.hasOwn(outer, 'content')) {
      const content = strictArrayValues(outer.content); if (!content) return;
      if (content.some(block => !contentBlock(block))) return;
    }
    const structuredContent = strictObject(outer.structuredContent); if (!structuredContent) return;
    return Object.hasOwn(outer, 'isError')
      ? { structuredContent, isError: outer.isError as boolean }
      : { structuredContent };
  } catch { return; }
}
