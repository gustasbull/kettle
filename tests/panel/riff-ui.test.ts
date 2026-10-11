import assert from 'node:assert/strict';
import test from 'node:test';

import { riffLockup, riffSymbol } from '../../apps/panel/riff-ui/brand.ts';
import { formatRiffDate, safeHttpUrl } from '../../apps/panel/riff-ui/dom.ts';
import { riffBaseStyles } from '../../apps/panel/riff-ui/styles.ts';

class TestElement {
  readonly attributes = new Map<string, string>();
  readonly children: TestElement[] = [];
  constructor(readonly tagName: string) {}
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  append(...children: TestElement[]) { this.children.push(...children); }
}

class TestDocument {
  createElementNS(_namespace: string, tagName: string) { return new TestElement(tagName); }
}

function descendants(node: TestElement): TestElement[] {
  return [node, ...node.children.flatMap(descendants)];
}

test('Riff vector helpers preserve the supplied single-colour Paper masters', () => {
  const document = new TestDocument() as unknown as Document;
  const lockup = riffLockup(document) as unknown as TestElement;
  const symbol = riffSymbol(document) as unknown as TestElement;

  assert.equal(lockup.getAttribute('viewBox'), '0 0 176 64');
  assert.equal(lockup.getAttribute('preserveAspectRatio'), 'xMinYMid meet');
  assert.equal(lockup.getAttribute('role'), 'img');
  assert.equal(lockup.getAttribute('aria-label'), 'Riff');
  assert.equal(symbol.getAttribute('viewBox'), '0 0 64 64');
  assert.equal(symbol.getAttribute('role'), 'img');
  assert.equal(symbol.getAttribute('aria-label'), 'Riff');

  const lockupMarks = descendants(lockup).filter((node) => ['path', 'circle'].includes(node.tagName));
  const symbolMarks = descendants(symbol).filter((node) => node.tagName === 'path');
  assert.equal(lockupMarks.length, 6);
  assert.equal(symbolMarks.length, 2);
  assert.deepEqual(new Set([...lockupMarks, ...symbolMarks].map((node) => node.getAttribute('fill'))), new Set(['currentColor']));
  assert.ok(symbolMarks.some((node) => node.getAttribute('d')?.startsWith('M10 0H35C53 0 62 9 62 24')));
});

test('Riff DOM helpers keep unknown dates explicit and URLs credential-free', () => {
  assert.equal(formatRiffDate(null), 'Unknown');
  assert.equal(formatRiffDate('not-a-date'), 'Unknown');
  assert.equal(formatRiffDate('2026-10-10T12:30:00Z'), '10 Oct 2026');
  assert.equal(safeHttpUrl('https://example.com/video?id=7'), 'https://example.com/video?id=7');
  assert.equal(safeHttpUrl('http://example.com/path'), 'http://example.com/path');
  assert.equal(safeHttpUrl('https://user:secret@example.com/private'), undefined);
  assert.equal(safeHttpUrl('javascript:alert(1)'), undefined);
  assert.equal(safeHttpUrl('not a url'), undefined);
});

test('Riff base styles map Paper tokens to host variables and protect constrained layouts', () => {
  assert.match(riffBaseStyles, /--riff-canvas:\s*var\(--color-background-secondary,\s*#F4F5F7\)/);
  assert.match(riffBaseStyles, /--riff-surface:\s*var\(--color-background-primary,\s*#FFFFFF\)/);
  assert.match(riffBaseStyles, /--riff-ink:\s*var\(--color-text-primary,\s*#242426\)/);
  assert.match(riffBaseStyles, /--riff-muted:\s*var\(--color-text-secondary,\s*#6D6D72\)/);
  assert.match(riffBaseStyles, /--riff-primary:\s*#3865F8/);
  assert.match(riffBaseStyles, /--riff-space-tight:\s*8px/);
  assert.match(riffBaseStyles, /--riff-space-section:\s*24px/);
  assert.match(riffBaseStyles, /--riff-radius-surface:\s*18px/);
  assert.match(riffBaseStyles, /overflow-wrap:\s*anywhere/);
  assert.match(riffBaseStyles, /:focus-visible/);
  assert.match(riffBaseStyles, /@container\s+riff-app\s+\(max-width:\s*320px\)/);
  assert.match(riffBaseStyles, /@media\s+\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(riffBaseStyles, /@media\s+\(forced-colors:\s*active\)/);
});
