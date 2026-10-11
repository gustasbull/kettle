export type StrictJsonObject = Record<string, unknown>;

function strictObject(value: unknown): StrictJsonObject | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) return;
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
    const keys = Reflect.ownKeys(item);
    if (keys.some(key => typeof key !== 'string' || !allowed.has(key))) return;
    if (keys.some(key => Object.getOwnPropertyDescriptor(item, key)?.enumerable !== true)) return;
    if (!required.every(key => Object.hasOwn(item, key))) return;
    if (optional.some(key => Object.hasOwn(item, key) && item[key] === undefined)) return;
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

function jsonValue(value: unknown, ancestors: Set<object>, depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 100 || ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = strictArrayValues(value); if (!entries) return false;
      return entries.every(entry => jsonValue(entry, ancestors, depth + 1));
    }
    const item = strictObject(value); if (!item) return false;
    const keys = Reflect.ownKeys(item);
    return keys.every(key => typeof key === 'string'
      && Object.getOwnPropertyDescriptor(item, key)?.enumerable === true
      && item[key] !== undefined && jsonValue(item[key], ancestors, depth + 1));
  } finally { ancestors.delete(value); }
}

function meta(value: unknown) {
  return !!strictObject(value) && jsonValue(value, new Set());
}

function annotations(value: unknown) {
  const item = strictObjectShape(value, [], ['audience', 'priority', 'lastModified']); if (!item) return false;
  if (item.audience !== undefined) {
    const audience = strictArrayValues(item.audience); if (!audience) return false;
    if (audience.some(role => role !== 'user' && role !== 'assistant')) return false;
  }
  if (item.priority !== undefined && (typeof item.priority !== 'number' || !Number.isFinite(item.priority))) return false;
  return item.lastModified === undefined || typeof item.lastModified === 'string';
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

function resourceContents(value: unknown) {
  const source = strictObject(value); if (!source) return false;
  const blob = Object.hasOwn(source, 'blob');
  const item = strictObjectShape(source, blob ? ['uri', 'blob'] : ['uri', 'text'], ['mimeType', '_meta']);
  return !!item && typeof item.uri === 'string' && typeof (blob ? item.blob : item.text) === 'string'
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
    return !!item && typeof item.data === 'string' && typeof item.mimeType === 'string' && shared(item);
  }
  if (source.type === 'resource_link') {
    const item = strictObjectShape(source, ['type', 'name', 'uri'],
      ['title', 'description', 'mimeType', 'annotations', 'size', 'icons', '_meta']);
    return !!item && typeof item.name === 'string' && typeof item.uri === 'string'
      && (item.title === undefined || typeof item.title === 'string')
      && (item.description === undefined || typeof item.description === 'string')
      && (item.mimeType === undefined || typeof item.mimeType === 'string')
      && (item.size === undefined || Number.isInteger(item.size) && Number(item.size) >= 0)
      && (item.icons === undefined || icons(item.icons)) && shared(item);
  }
  if (source.type === 'resource') {
    const item = strictObjectShape(source, ['type', 'resource'], ['annotations', '_meta']);
    return !!item && resourceContents(item.resource) && shared(item);
  }
  return false;
}

export function parseStrictCallToolResult(raw: unknown):
  { structuredContent: StrictJsonObject; isError: boolean } | undefined {
  try {
    const outer = strictObjectShape(raw, ['structuredContent'], ['content', 'isError', '_meta']);
    if (!outer || Object.hasOwn(outer, 'isError') && typeof outer.isError !== 'boolean'
      || Object.hasOwn(outer, '_meta') && !meta(outer._meta)) return;
    if (Object.hasOwn(outer, 'content')) {
      const content = strictArrayValues(outer.content); if (!content) return;
      if (content.some(block => !contentBlock(block))) return;
    }
    const structuredContent = strictObject(outer.structuredContent); if (!structuredContent) return;
    return { structuredContent, isError: outer.isError === true };
  } catch { return; }
}
