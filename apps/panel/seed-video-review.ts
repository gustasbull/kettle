import type { CreatorDnaView } from '../../packages/contracts/creator-operations.ts';
import { creatorReviewStyles } from './creator-loop/styles.ts';

type SeedReview = NonNullable<CreatorDnaView['seed_review']>;
const accessMessages: Record<SeedReview['access_basis'], string> = {
  video_access_reported: 'Lightreel reports access to the video. Riff has not independently verified that access.',
  transcript_or_caption_only: 'Lightreel reports transcript or caption access only. Visual details are not verified.',
  unavailable: 'Lightreel reports that the video was unavailable. No video access is established.',
  unknown: 'Lightreel did not establish its access to the video. Video access is unverified.',
};

export const seedVideoAccessMessage = (basis: SeedReview['access_basis']) => accessMessages[basis];

/** Static, inert provider summary. This describes only the supplied video, not profile-wide DNA. */
export function seedVideoReview(doc: Document, review: SeedReview): HTMLElement {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className = '') => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const wrapper = el('div', undefined, 'kettle-creator');
  wrapper.style.marginTop = '16px';
  const card = el('section', undefined, 'kc-card kc-stack');
  card.setAttribute('aria-label', 'Lightreel review of supplied video');
  card.append(el('h3', 'Lightreel review of supplied video'),
    el('p', 'This review concerns the supplied video only. Profile-wide Creator DNA is shown separately.', 'kc-meta'));
  if (review.origin === 'fixture') card.append(el('p', 'Fictional test review. This is not live provider evidence.', 'kc-notice'));
  card.append(el('p', seedVideoAccessMessage(review.access_basis), 'kc-notice'), el('p', review.summary, 'kc-text'));
  let href: string | undefined;
  if (review.origin === 'live') {
    try {
      const url = new URL(review.url);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) href = url.href;
    } catch { /* Invalid links remain inert. */ }
  }
  if (href) {
    const link = el('a', 'Open supplied video (new tab)', 'kc-source');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
    link.dataset.focus = 'seed-video-source'; card.append(link);
  }
  card.append(el('p', review.origin === 'fixture' ? `Fictional source: ${review.url}` : review.url, 'kc-meta'),
    el('p', `Retrieved: ${review.retrieved_at.replace('T', ' ').replace(/Z$/, ' UTC')}`, 'kc-meta'));
  if (review.limitations.length) {
    card.append(el('h4', 'Review limitations'));
    const list = el('ul'); review.limitations.forEach(value => list.append(el('li', value, 'kc-text'))); card.append(list);
  }
  wrapper.append(el('style', creatorReviewStyles), card);
  return wrapper;
}
