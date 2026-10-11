import type { CreatorJobStatusView, CreatorJobView, PipelineReference } from '../../../packages/contracts/creator-pipeline.ts';
import type { CreatorDnaView } from '../../../packages/contracts/creator-operations.ts';
import type { RiffVideoCard } from '../../../packages/contracts/riff-videos.ts';
import type { RiffVideoCatalogState } from '../riff-video-catalog-loader.ts';
import { mountRiffMenu, type RiffMenuAccount, type RiffMenuRecent } from '../riff-shell/menu.ts';
import { riffSymbol } from '../riff-ui/brand.ts';
import { safeHttpUrl, type RiffActionResult, type RiffPanelAction } from '../riff-ui/dom.ts';
import { riffBaseStyles } from '../riff-ui/styles.ts';
import { creatorPipelineStyles } from './styles.ts';

export type RiffCreatorDisplayMode = 'inline' | 'fullscreen';
export type RiffDiscoveryLibrary = 'videos' | 'hooks' | 'showcases' | 'ctas';
type RecommendationResult = Extract<NonNullable<CreatorJobView['result']>, { kind: 'recommendations' }>;
type ScriptResult = Extract<NonNullable<CreatorJobView['result']>, { kind: 'scripts' }>;
type PaperDimension = NonNullable<NonNullable<CreatorDnaView['seed_review']>['dimensions']>[number]['dimension'];
export type RiffDiscoverySelection = {
  job: CreatorJobView;
  batch: RecommendationResult['batch'];
  idea: RecommendationResult['batch']['ideas'][number];
  library: RiffDiscoveryLibrary;
  filter: string;
  intent: string;
};
export type RiffStudioExploreIntent = {
  source: 'studio';
  part: 'full' | 'hook' | 'main_content' | 'cta';
  library: RiffDiscoveryLibrary;
  prompt: string;
  currentScriptUnchanged: true;
};
export type RiffCatalogProposal = {
  card: RiffVideoCard;
  library: RiffDiscoveryLibrary;
  filter: string;
  intent: string;
  studioExplore?: RiffStudioExploreIntent;
};

export function riffCatalogProposalHandoff(proposal:RiffCatalogProposal):string {
  const context=proposal.studioExplore;
  if(!context)return proposal.intent;
  const expected:Record<RiffStudioExploreIntent['part'],RiffDiscoveryLibrary>={full:'videos',hook:'hooks',main_content:'showcases',cta:'ctas'};
  if(context.source!=='studio'||context.currentScriptUnchanged!==true||expected[context.part]!==context.library
    ||context.library!==proposal.library||!context.prompt.trim()||context.prompt.length>1_000)return proposal.intent;
  const part={full:'full video',hook:'hook',main_content:'main content',cta:'CTA'}[context.part];
  return `${proposal.intent}\n\nStudio context (${part} → ${context.library}): ${context.prompt} Treat this as an unsaved proposal; do not claim the reference was selected or written.`;
}

const discoveryLibraries = [['videos', 'Videos'], ['hooks', 'Hooks'], ['showcases', 'Product showcases'], ['ctas', 'CTAs']] as const;
const discoveryLibraryViews = {
  videos: {
    title: 'Find your next breakout idea.', copy: 'Explore viral formats picked for you. Find your angle. Make it yours.',
    filters: ['For you', 'Quick demos', 'Before / after', 'How-to', 'Reactions', 'Challenges'], action: 'Make it mine', quote: false,
  },
  hooks: {
    title: 'Stop the scroll.', copy: 'Find a hook that grabs attention. Make it sound like you.',
    filters: ['For you', 'Questions', 'Bold claims', 'Visual hooks', 'Problems', 'Storytelling'], action: 'Use this hook', quote: true,
  },
  showcases: {
    title: 'Make your product stand out.', copy: 'Turn your product’s best benefit into a video worth watching.',
    filters: ['For you', 'Quick demos', 'Before / after', 'Unboxing', 'Tutorials', 'Screen recordings'], action: 'Use this showcase', quote: false,
  },
  ctas: {
    title: 'Turn views into action.', copy: 'Give viewers a reason to save, share, follow, or try your product.',
    filters: ['For you', 'Save', 'Comment', 'Follow', 'Share', 'Try it'], action: 'Use this CTA', quote: true,
  },
} as const;
export type CreatorPipelineOptions = {
  displayMode?: RiffCreatorDisplayMode;
  sendPrompt?: RiffPanelAction;
  requestFullscreen?: () => Promise<RiffActionResult>;
  startRecommendations?: (context: { job: CreatorJobView; dna: CreatorDnaView }) => Promise<RiffActionResult>;
  makeMine?: (context: RiffDiscoverySelection) => Promise<RiffActionResult>;
  proposeCatalogReference?: (context: RiffCatalogProposal) => Promise<RiffActionResult>;
  onCatalogRetry?: () => void;
  setVariantState?: (context: {
    job: CreatorJobView;
    scripts: ScriptResult['scripts'];
    variant: ScriptResult['scripts']['variants'][number];
    state: 'saved' | 'filmed';
  }) => Promise<RiffActionResult>;
  onDiscoveryOpen?: (scope:{projectId?:string}) => void;
  embeddedChrome?:boolean;
  menu?: {
    account?: RiffMenuAccount;
    recents?: RiffMenuRecent[];
    onHome?: () => void;
    onOpenRecent?: (recent:RiffMenuRecent) => void;
    onCreate?: () => void;
    onAccountSettings?: () => void | RiffActionResult | Promise<void | RiffActionResult>;
    onSupport?: () => void | RiffActionResult | Promise<void | RiffActionResult>;
    onFeedback?: () => void | RiffActionResult | Promise<void | RiffActionResult>;
    onRequestTheme?: () => void | RiffActionResult | Promise<void | RiffActionResult>;
  };
};
export type CreatorPipelinePresentation={status?:CreatorJobStatusView;sourceUrl?:string};

export const creatorLoadingVariants = {
  fetchVideo:{title:'Fetching your video',subtitle:'Opening your link and loading the available video details.',activity:'Loading the video and its captions…',done:'Link received',next:'Analyzing next',preview:'video',sourceTitle:'Your video',sourceCopy:'Loading your linked video…'},
  analyzeVideo:{title:'Analyzing your video',subtitle:'Reviewing the opening, delivery and call to action.',activity:'Analyzing hooks and pacing…',done:'Video fetched',next:'Preparing your analysis',preview:'video',sourceTitle:'Your video',sourceCopy:'Hook · Content · Pacing · Voice · CTA'},
  profile:{title:'Getting to know your profile',subtitle:'Loading available posts and performance from your profile.',activity:'Fetching your recent videos…',done:'Profile found',next:'Analyzing your content',preview:'profile'},
  product:{title:'Understanding your product',subtitle:'Turning your description into an editable brief.',activity:'Identifying your audience and key benefit…',done:'Description received',next:'Preparing your brief',preview:'none'},
  discovery:{title:'Finding videos for your next idea',subtitle:'Looking through relevant creators, videos and formats.',activity:'Comparing hooks and product showcases…',done:'Your brief is ready',next:'Choosing matching references',preview:'references'},
} as const;
const scriptLoading={title:'Building your filming variants',subtitle:'Turning your selected direction into a film-ready script.',activity:'Preparing your script…',done:'Direction received',next:'Building Studio',preview:'none'} as const;

const unavailable: RiffPanelAction = async () => ({
  status: 'unsupported', message: 'Continue with this request in the ChatGPT composer.',
});

/** Pure presentation plus explicit host handoffs. It never fetches, saves, retries, or starts provider work. */
export function mountCreatorPipeline(root: HTMLElement, options: CreatorPipelineOptions = {}): {
  render(job: CreatorJobView, presentation?:CreatorPipelinePresentation): void;
  setCatalogState(state:RiffVideoCatalogState):void;
  showCatalog(library?:RiffDiscoveryLibrary,scope?:{accountWide?:boolean;projectId?:string},studioExplore?:RiffStudioExploreIntent):void;
  leaveCatalog():void;
  setNotice(message:string):void;
  setDisplayMode(mode: RiffCreatorDisplayMode): void;
  dispose(): void;
} {
  const doc = root.ownerDocument;
  const sendPrompt = options.sendPrompt ?? unavailable;
  const requestFullscreen = options.requestFullscreen ?? (async () => ({
    status: 'unsupported' as const, message: 'Open this result fullscreen from ChatGPT to continue.',
  }));
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className = '') => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svg = (width: number, height: number, viewBox: string, className = '') => {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('width', String(width)); node.setAttribute('height', String(height));
    node.setAttribute('viewBox', viewBox); node.setAttribute('aria-hidden', 'true');
    if (className) node.setAttribute('class', className);
    return node;
  };
  const path = (parent: SVGElement, d: string, attributes: Record<string, string>) => {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); node.setAttribute('d', d);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    parent.append(node); return parent;
  };
  const playIcon = (studio = false) => {
    const node = svg(studio ? 18 : 12, studio ? 20 : 12, studio ? '0 0 18 20' : '0 0 12 12');
    return path(node, studio ? 'M3 2L16 10L3 18Z' : 'M3 1 11 6 3 11Z', { fill: '#FFFFFF' });
  };
  const eyeIcon = (color = '#544276') => {
    const node = svg(14, 14, '0 0 24 24');
    path(node, 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', { fill: 'none', stroke: color, 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '3');
    circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', color); circle.setAttribute('stroke-width', '1.8');
    node.append(circle); return node;
  };
  const heartIcon = () => path(svg(14, 14, '0 0 24 24'), 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z', {
    fill: 'none', stroke: '#544276', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const saveIcon = (color = '#9A762C') => path(svg(14, 14, '0 0 16 18'), 'M3 2h10v14l-5-3-5 3Z', {
    fill: 'none', stroke: color, 'stroke-width': '1.5', 'stroke-linejoin': 'round',
  });
  const peopleIcon = () => {
    const node = svg(14, 14, '0 0 24 24');
    const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '9'); circle.setAttribute('cy', '8'); circle.setAttribute('r', '3');
    circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', '#7960B4'); circle.setAttribute('stroke-width', '1.8');
    node.append(circle);
    path(node, 'M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5', {
      fill: 'none', stroke: '#7960B4', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    return node;
  };
  const trendIcon = () => path(svg(12, 12, '0 0 24 24'), 'm3 17 6-6 4 3 8-10M15 4h6v6', {
    fill: 'none', stroke: '#174D2A', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const copyIcon = () => {
    const node = svg(16, 16, '0 0 24 24');
    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '8'); rect.setAttribute('y', '8'); rect.setAttribute('width', '12'); rect.setAttribute('height', '13'); rect.setAttribute('rx', '2');
    rect.setAttribute('fill', 'none'); rect.setAttribute('stroke', '#35578B'); rect.setAttribute('stroke-width', '1.7');
    node.append(rect);
    path(node, 'M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3', {
      fill: 'none', stroke: '#35578B', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    return node;
  };
  const spinnerIcon = () => {
    const node = svg(16, 16, '0 0 24 24', 'riff-loading-spinner');
    path(node, 'M20 12a8 8 0 1 1-8-8', { fill: 'none', stroke: '#3865F8', 'stroke-width': '2', 'stroke-linecap': 'round', opacity: '.2' });
    path(node, 'M12 4a8 8 0 0 1 8 8', { fill: 'none', stroke: '#3865F8', 'stroke-width': '2', 'stroke-linecap': 'round' });
    return node;
  };
  const checkIcon = () => path(svg(13, 13, '0 0 24 24'), 'm5 12 4 4L19 6', {
    fill: 'none', stroke: '#5B8B6B', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const arrowIcon = (direction: 'previous' | 'next') => path(svg(18, 18, '0 0 24 24'), direction === 'previous'
    ? 'M19 12H5m7-7-7 7 7 7' : 'M5 12h14m-7-7 7 7-7 7', {
    fill: 'none', stroke: '#294F94', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const bookmarkIcon = () => path(svg(16, 18, '0 0 16 18'), 'M3 2h10v14l-5-3-5 3Z', {
    fill: 'none', stroke: '#294F94', 'stroke-width': '1.5',
  });
  const bulbIcon = () => path(svg(13, 13, '0 0 24 24'), 'M9 18h6M10 21h4M9 15c0-2-3-3-3-7a6 6 0 0 1 12 0c0 4-3 5-3 7v1H9z', {
    fill: 'none', stroke: '#9A762C', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const tiktokIcon = () => {
    const node=svg(12,12,'0 0 24 24');
    path(node,'M13 4h3c.5 2.1 1.8 3.5 4 4v3a9 9 0 0 1-4-1v6a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V4Z',{fill:'none',stroke:'#25F4EE','stroke-width':'3'});
    path(node,'M15 3h3c.4 2.1 1.7 3.5 4 4v3a9 9 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V3Z',{fill:'none',stroke:'#FE2C55','stroke-width':'3'});
    return path(node,'M14 3h3c.4 2.4 1.7 3.8 4 4v3a9 9 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V3Z',{fill:'#FFFFFF'});
  };
  const instagramIcon=()=>{
    const node=svg(14,14,'0 0 24 24');
    const rect=doc.createElementNS('http://www.w3.org/2000/svg','rect');rect.setAttribute('x','4');rect.setAttribute('y','4');rect.setAttribute('width','16');rect.setAttribute('height','16');rect.setAttribute('rx','5');rect.setAttribute('fill','none');rect.setAttribute('stroke','#fff');rect.setAttribute('stroke-width','2');node.append(rect);
    const circle=doc.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','12');circle.setAttribute('cy','12');circle.setAttribute('r','3.5');circle.setAttribute('fill','none');circle.setAttribute('stroke','#fff');circle.setAttribute('stroke-width','2');node.append(circle);
    const dot=doc.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx','17.5');dot.setAttribute('cy','6.5');dot.setAttribute('r','1');dot.setAttribute('fill','#fff');node.append(dot);return node;
  };

  const style = el('style'); style.textContent = riffBaseStyles + creatorPipelineStyles;
  const wrapper = el('div', undefined, 'riff-app riff-pipeline riff-menu-scope');
  wrapper.dataset.embedded=String(options.embeddedChrome===false);
  const chrome=el('header',undefined,'riff-pipeline__chrome');const trail=el('div',undefined,'riff-pipeline__chrome-trail');
  const menuHost=el('span');
  const brand=el('span',undefined,'riff-pipeline__brand');const symbol=riffSymbol(doc);symbol.setAttribute('aria-hidden','true');symbol.removeAttribute('aria-label');symbol.removeAttribute('role');brand.append(symbol,el('span','Riff'));
  const separator=el('span','/','riff-pipeline__separator');const location=el('span','Analysis','riff-pipeline__location');trail.append(menuHost,brand,separator,location);chrome.append(trail);
  chrome.hidden=options.embeddedChrome===false;
  const surface = el('section', undefined, 'riff-pipeline__surface');
  surface.setAttribute('aria-label', 'Riff creator workflow');
  const content = el('div', undefined, 'riff-pipeline__content');
  const status = el('p', '', 'riff-pipeline__status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  surface.append(content, status); wrapper.append(chrome,surface); root.replaceChildren(style, wrapper);

  let disposed = false;
  let mode: RiffCreatorDisplayMode = options.displayMode ?? 'inline';
  let current: CreatorJobView | undefined;
  let currentStatus:CreatorJobStatusView|undefined;
  let catalogState:RiffVideoCatalogState={status:'loading'};
  let sourceUrl:string|undefined;
  let showingCatalog=false;
  let screenKind='';
  let identity: string | undefined;
  let ideaIndex = 0;
  let discoveryLibrary: RiffDiscoveryLibrary = 'videos';
  let discoveryFilter = 'For you';
  let studioTab = 0;
  let catalogIndex=0;
  let catalogActiveId:string|undefined;
  let catalogScopeKey:string|undefined;
  let studioExplore:RiffStudioExploreIntent|undefined;
  const leaveCatalog=()=>{showingCatalog=false;studioExplore=undefined;};

  const enterDiscovery=(loadCatalog=false,projectId?:string,explicit=false)=>{
    screenKind='discovery';
    if(!loadCatalog)return;
    const nextScope=projectId??'account';
    const scopeChanged=catalogScopeKey!==nextScope;
    if(scopeChanged){
      const changingKnownScope=catalogScopeKey!==undefined;
      catalogScopeKey=nextScope;if(changingKnownScope)catalogState={status:'loading'};
      catalogIndex=0;catalogActiveId=undefined;studioExplore=undefined;
      if(changingKnownScope){discoveryLibrary='videos';discoveryFilter='For you';}
    }
    if(scopeChanged||explicit)options.onDiscoveryOpen?.(projectId?{projectId}:{});
  };
  const menu=options.embeddedChrome===false?undefined:mountRiffMenu(menuHost,{
    account:options.menu?.account,recents:options.menu?.recents??[],activeRoute:'analysis',
    onNavigate(route){
      if(route==='discover'){
        discoveryLibrary='videos';discoveryFilter='For you';catalogIndex=0;catalogActiveId=undefined;studioExplore=undefined;
        enterDiscovery(true,current?.project_id,true);renderCatalogDiscovery();return;
      }
      leaveCatalog();
      if(options.menu?.onHome)options.menu.onHome();
      else void runMenu(()=>sendPrompt('Open Riff Home in this app so I can start or resume work.'));
    },
    onOpenRecent(recent){
      leaveCatalog();
      if(options.menu?.onOpenRecent)options.menu.onOpenRecent(recent);
      else void runMenu(()=>sendPrompt(`Open my saved Riff work, “${recent.title}”.`));
    },
    onCreate(){
      leaveCatalog();
      if(options.menu?.onCreate)options.menu.onCreate();
      else void runMenu(()=>sendPrompt('Start a fresh Riff video from Home without changing the saved work currently open.'));
    },
    onClose(){ /* Closing the local drawer preserves the open workflow. */ },
    onAccountSettings:options.menu?.onAccountSettings??(()=>sendPrompt('Open my Riff account settings in ChatGPT. Do not claim a setting changed until the host confirms it.')),
    onSupport:options.menu?.onSupport??(()=>sendPrompt('I need support with Riff. Show the available support handoff.')),
    onFeedback:options.menu?.onFeedback??(()=>sendPrompt('I want to give feedback about Riff through the available ChatGPT handoff.')),
    onRequestTheme:options.menu?.onRequestTheme??(()=>sendPrompt('Open ChatGPT appearance settings. Riff follows the host theme and cannot change ChatGPT’s theme itself.')),
  });

  const setStatus = (text: string) => { if (status.textContent !== text) status.textContent = text; };
  const title = (text: string, className = '') => {
    const group = el('div', undefined, `riff-title${className ? ` ${className}` : ''}`);
    const heading = el('h1', text); heading.tabIndex = -1; group.append(heading); return { group, heading };
  };
  const button = (label: string, className: string, handler: () => void, focus: string) => {
    const control = el('button', label, className); control.type = 'button'; control.dataset.focus = focus;
    control.addEventListener('click', handler); return control;
  };
  const run = async (action: () => Promise<RiffActionResult>, menuFeedback = false) => {
    if (menuFeedback) status.dataset.menuFeedback = 'true'; else delete status.dataset.menuFeedback;
    setStatus('Working…');
    try { setStatus((await action()).message); }
    catch { setStatus('Continue in the ChatGPT composer.'); }
  };
  const runMenu = (action: () => Promise<RiffActionResult>) => run(action, true);
  const actions = (...controls: HTMLButtonElement[]) => {
    const group = el('div', undefined, 'riff-actions'); group.append(...controls); return group;
  };
  const formatMetric = (value: number) => new Intl.NumberFormat('en', { notation: value >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
  const screen = (kind: string) => { content.className = `riff-pipeline__content riff-paper-screen riff-paper--${kind}`; };
  const safeLink = (url: string | undefined, label: string, className: string) => {
    const href = url ? safeHttpUrl(url) : undefined;
    const node = href ? el('a', undefined, className) : el('div', undefined, className);
    if (node instanceof doc.defaultView!.HTMLAnchorElement) {
      node.href = href!; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.referrerPolicy = 'no-referrer';
      node.setAttribute('aria-label', label);
    }
    return node;
  };
  const mediaImage = (url: string | undefined, alt: string, className: string) => {
    const src = url ? safeHttpUrl(url) : undefined;
    if (!src) return undefined;
    const image = el('img', undefined, className); image.src = src; image.alt = alt;
    image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    image.addEventListener('error',()=>image.remove(),{once:true});
    return image;
  };
  const metric = (label: string, value: number, kind: 'views' | 'likes' | 'saves' = 'views') => {
    const chip = el('div', undefined, `riff-metric riff-metric--${kind}`);
    const icon = el('span', undefined, 'riff-metric__icon'); icon.append(kind === 'likes' ? heartIcon() : kind === 'saves' ? saveIcon() : eyeIcon('#3567DB'));
    const copy = el('span', undefined, 'riff-metric__copy'); copy.append(el('strong', formatMetric(value)), el('small', label));
    chip.append(icon, copy); return chip;
  };
  const discoveryIntent = (library: RiffDiscoveryLibrary, filter: string, ideaTitle: string) => {
    const selection = `“${ideaTitle}”`;
    if (library === 'videos') {
      return `Use ${selection} as the complete video direction for my next Riff video. Shape the adaptation around the “${filter}” preference, my creator context, and cited references, then draft filmable options for me to choose from.`;
    }
    if (library === 'hooks') {
      return `Use ${selection} as inspiration for the hook of my current Riff video. Draft only an opening adapted to the “${filter}” preference, preserve the existing main content and CTA, and show the proposal in chat without claiming it was saved.`;
    }
    if (library === 'showcases') {
      return `Use ${selection} as inspiration for the product showcase in my current Riff video. Draft only the main-content demonstration adapted to the “${filter}” preference, preserve the existing hook and CTA, and show the proposal in chat without claiming it was saved.`;
    }
    return `Use ${selection} as inspiration for the CTA of my current Riff video. Draft only the ending adapted to the “${filter}” preference, preserve the existing hook and main content, and show the proposal in chat without claiming it was saved.`;
  };
  const catalogProposalIntent = (card:RiffVideoCard,library:RiffDiscoveryLibrary,filter:string) => {
    const source=`the saved Riff reference at ${card.canonical_url}`;
    if(library==='videos')return `Use ${source} to propose a complete video direction adapted to the “${filter}” lens. Keep this as a ChatGPT proposal only; do not claim it was selected or saved in Riff.`;
    if(library==='hooks')return `Use ${source} to propose only a hook adapted to the “${filter}” lens. Preserve the current main content and CTA, and do not claim the proposal was selected or saved in Riff.`;
    if(library==='showcases')return `Use ${source} to propose only a main-content product showcase adapted to the “${filter}” lens. Preserve the current hook and CTA, and do not claim the proposal was selected or saved in Riff.`;
    return `Use ${source} to propose only a CTA adapted to the “${filter}” lens. Preserve the current hook and main content, and do not claim the proposal was selected or saved in Riff.`;
  };

  function renderPending(job: CreatorJobView,statusView?:CreatorJobStatusView) {
    screen('pending');
    const progress=statusView?.progress??job.progress;
    const stage=statusView?.stage??job.stage;
    content.dataset.stage=stage;
    const scan = job.kind === 'scan';
    const recommendations = job.kind === 'recommendations';
    const profileScan = scan && job.source_kind === 'profile';
    const loading = scan && job.source_kind === 'video'
      ? (stage==='building_analysis'||stage==='saving'?creatorLoadingVariants.analyzeVideo:creatorLoadingVariants.fetchVideo)
      : profileScan ? creatorLoadingVariants.profile : scan ? {
      title: 'Fetching your creator content', subtitle: 'Opening your link and loading the available creator details.',
      activity: 'Loading the available creator content…', done: 'Link received', next: 'Analyzing next',
      preview:'video',sourceTitle: 'Your creator link', sourceCopy: 'Loading your creator content…',
    } as const : recommendations ? creatorLoadingVariants.discovery : scriptLoading;
    const card = el('section', undefined, 'riff-loading-card');
    const intro = el('div', undefined, 'riff-loading-intro'); const heading = el('h1', loading.title); heading.tabIndex = -1;
    intro.append(heading, el('p', loading.subtitle)); card.append(intro);
    if (loading.preview==='references') {
      const strip = el('div', undefined, 'riff-loading-references'); strip.setAttribute('aria-label', 'Matching reference videos');
      const references=progress.kind==='recommendations'?progress.references:[];
      for (let index = 0; index < 7; index += 1) {
        const reference=references[index];
        const slot=safeLink(reference?.url,`Open matching reference ${index+1}`,'riff-loading-reference');
        const preview=mediaImage(reference?.thumbnail_url,'Matching reference video','riff-media-image');if(preview)slot.append(preview);
        strip.append(slot);
      }
      card.append(strip);
    } else if (loading.preview==='profile') {
      const strip = el('div', undefined, 'riff-loading-references riff-loading-profile');
      strip.setAttribute('aria-label', 'Loading profile and recent videos');
      const scanProgress=progress.kind==='scan'?progress:undefined;
      const avatar=el('span',undefined,'riff-loading-profile__avatar');
      const avatarImage=mediaImage(scanProgress?.profile?.avatar_url,'Creator profile photo','riff-media-image');if(avatarImage)avatar.append(avatarImage);
      strip.append(avatar);
      for (let index = 0; index < 6; index += 1) {
        const video=scanProgress?.videos[index];
        const slot=safeLink(video?.url,`Open recent video ${index+1}`,'riff-loading-reference');
        const preview=mediaImage(video?.thumbnail_url,'Recent creator video','riff-media-image');if(preview)slot.append(preview);
        strip.append(slot);
      }
      card.append(strip);
    } else if (loading.preview==='video') {
      const video = el('div', undefined, 'riff-loading-video');
      const scanProgress=progress.kind==='scan'?progress:undefined;
      const first=scanProgress?.videos[0];
      const submitted=(stage==='accepted'||stage==='reviewing_video')?sourceUrl:undefined;
      const media=safeLink(first?.url??submitted,'Open submitted video','riff-loading-video__media');
      const preview=mediaImage(first?.thumbnail_url,'Submitted video preview','riff-media-image');if(preview)media.append(preview);
      video.append(media);
      const copy = el('span', undefined, 'riff-loading-video__copy'); copy.append(el('strong', loading.sourceTitle), el('span', loading.sourceCopy));
      video.append(copy); card.append(video);
    }
    const progressGroup = el('div', undefined, 'riff-loading-progress');
    const activity = el('div', undefined, 'riff-loading-activity'); activity.append(spinnerIcon(), el('span', loading.activity));
    const progressBar = el('div', undefined, 'riff-progress'); progressBar.setAttribute('role', 'progressbar'); progressBar.setAttribute('aria-label', loading.activity);
    const footer = el('div', undefined, 'riff-loading-footer'); const complete = el('span', undefined, 'riff-loading-complete');
    complete.append(checkIcon(), el('span', loading.done)); footer.append(complete, el('span', loading.next));
    progressGroup.append(activity, progressBar, footer); card.append(progressGroup); content.append(card);
    const limitations=progress.limitations;
    setStatus(limitations.length?limitations.join(' '):(statusView?.state??job.state) === 'queued' ? 'Queued.' : 'In progress.'); return heading;
  }

  function renderFailure(state:'failed'|'needs_reconciliation',limitations:readonly string[]=[]) {
    screen('failure');
    const headingText = state === 'needs_reconciliation' ? 'This outcome needs review.' : 'This workflow could not finish.';
    const card = el('section', undefined, 'riff-loading-card riff-recovery-card');
    const intro = el('div', undefined, 'riff-loading-intro'); const heading = el('h1', headingText); heading.tabIndex = -1;
    intro.append(heading, el('p', 'Continue from the Riff conversation in ChatGPT.')); card.append(intro); content.append(card);
    setStatus(limitations.length?`${limitations.join(' ')} ${headingText}`:headingText); return heading;
  }

  function renderSavedResultRetrieval(){
    screen('failure');
    const card=el('section',undefined,'riff-loading-card riff-recovery-card');
    const intro=el('div',undefined,'riff-loading-intro');const heading=el('h1','Loading the saved result.');heading.tabIndex=-1;
    intro.append(heading,el('p','The workflow finished. Riff is retrieving the saved result.'));card.append(intro);content.append(card);
    setStatus('The workflow finished. Retrieving its saved result.');return heading;
  }

  const analysisDimensions: Array<[string, PaperDimension, CreatorDnaView['claims'][number]['dimension'][]]> = [
    ['Hook', 'hook', ['hooks']], ['Content', 'content', ['topics', 'formats']],
    ['Style & pacing', 'style_pacing', ['duration', 'pacing']], ['Voice & language', 'voice_language', []],
    ['Script', 'script', ['structure']], ['CTA', 'cta', ['cta']],
  ];
  const assessmentLabels = {
    working_well: 'Working well', needs_attention: 'Needs attention', needs_rework: 'Needs rework', unknown: 'Limited',
  } as const;

  function analysisRows(dna: CreatorDnaView) {
    const stack = el('section', undefined, 'riff-analysis-rows'); stack.setAttribute('aria-label', 'Analysis dimensions');
    for (const [label, paperDimension] of analysisDimensions) {
      const assessment = dna.seed_review!.dimensions!.find(item => item.dimension === paperDimension)!;
      const row = el('article', undefined, `riff-analysis-row${assessment ? ` riff-analysis-row--${assessment.status.replace('_', '-')}` : ''}`);
      const head = el('div', undefined, 'riff-analysis-row__head'); head.append(el('h2', label));
      const statusLabel = assessment ? assessmentLabels[assessment.status] : '';
      if (statusLabel) head.append(el('span', statusLabel, 'riff-analysis-row__status'));
      row.append(head);
      const recommendation=assessment.recommendation?.trim();
      const advice=recommendation&&recommendation.toLocaleLowerCase()!==assessment.summary.trim().toLocaleLowerCase()
        ? `${assessment.summary.trim()} ${recommendation}`:assessment.summary;
      const body = el('div', undefined, 'riff-analysis-row__body');body.append(el('p',advice));row.append(body);
      stack.append(row);
    }
    return stack;
  }

  function renderVideoAnalysis(job: CreatorJobView & { result: { kind: 'scan'; dna: CreatorDnaView } }) {
    const dna = job.result.dna;
    screen('analysis');
    const { group, heading } = title('Unlock your video’s viral potential.', 'riff-analysis-title'); content.append(group);
    const card = el('section', undefined, 'riff-analysis-card');
    const media = el('div', undefined, 'riff-analysis-media');
    const review = dna.seed_review!;
    const frame = safeLink(review.url, 'Open supplied video', 'riff-analysis-video');
    const evidence = dna.evidence.find(item => item.url === review.url);
    const preview = mediaImage(evidence?.thumbnail_url, 'Video preview', 'riff-media-image'); if (preview) frame.append(preview);
    const play = el('span', undefined, 'riff-play'); play.append(playIcon()); frame.append(play); media.append(frame);
    if(evidence?.duration_seconds!==null&&evidence?.duration_seconds!==undefined){
      const seconds=Math.round(evidence.duration_seconds);const duration=el('span',`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,'riff-analysis-duration');frame.append(duration);
    }
    if (evidence?.metrics?.views !== null && evidence?.metrics?.views !== undefined) media.append(metric('Views', evidence.metrics.views));
    if (evidence?.metrics?.likes !== null && evidence?.metrics?.likes !== undefined) media.append(metric('Likes', evidence.metrics.likes, 'likes'));
    if (evidence?.metrics?.saves !== null && evidence?.metrics?.saves !== undefined) media.append(metric('Saves', evidence.metrics.saves, 'saves'));
    const detail = el('div', undefined, 'riff-analysis-detail'); detail.append(analysisRows(dna));
    const explore = () => void run(() => options.startRecommendations
      ? options.startRecommendations({ job, dna })
      : sendPrompt('Use the completed Riff analysis to explore viral formats that fit this creator. Do not start new provider work without my explicit confirmation.'));
    detail.append(actions(
      button('Rework this video', 'riff-button riff-button--primary', () => void run(() => sendPrompt('Use the completed Riff video analysis to help me rework this video. Ask what I want to change before drafting, and stay grounded in the analyzed content.')), 'rework-video'),
      button('Explore viral formats', 'riff-button', explore, 'explore-formats'),
    ));
    card.append(media, detail); content.append(card); setStatus('Video analysis shown.'); return heading;
  }

  function renderPartialVideoAnalysis(job: CreatorJobView & { result: { kind: 'scan'; dna: CreatorDnaView } }) {
    const dna = job.result.dna;
    screen('partial-analysis');
    const card = el('section', undefined, 'riff-partial-analysis-card');
    const copy = el('div', undefined, 'riff-partial-analysis-copy');
    const heading = el('h1', 'We could read the words, not the visuals.'); heading.tabIndex = -1;
    copy.append(
      heading,
      el('p', 'We can help with the wording. Upload the video file in chat for feedback on the shots and pacing.'),
    );
    card.append(
      copy,
      actions(button(
        'Work on the script',
        'riff-button riff-button--primary riff-partial-analysis-action',
        () => void run(() => sendPrompt('Use Riff to help me work on the script for the supplied creator video, grounded only in the available transcript or captions. Do not make claims about shots or pacing.')),
        'work-on-script',
      )),
    );
    content.append(card); setStatus('Script feedback available.'); return heading;
  }

  function renderLimitedVideoAnalysis() {
    screen('partial-analysis');
    const card=el('section',undefined,'riff-partial-analysis-card');const copy=el('div',undefined,'riff-partial-analysis-copy');
    const heading=el('h1','This video analysis is limited.');heading.tabIndex=-1;
    copy.append(heading,el('p','A complete visual review is not available for this video. Try another link or upload the video in chat.'));
    card.append(copy);content.append(card);setStatus('Complete video analysis unavailable.');return heading;
  }

  function renderProfileAnalysis(job: CreatorJobView & { result: { kind: 'scan'; dna: CreatorDnaView } }) {
    const dna = job.result.dna;
    const summary = dna.profile_summary;
    const platform=dna.profile.platform;
    const instagram=platform==='instagram';
    const profileAnalysis=dna.profile_analysis;
    screen('profile');
    const { group, heading } = title(instagram?'Turn your best results into more reach.':'Turn what’s working into your next breakout.', 'riff-analysis-title'); content.append(group);
    const shell = el('section', undefined, 'riff-profile-shell');
    const profile = el('section', undefined, 'riff-profile-card');
    const portrait = el('div', undefined, 'riff-profile-portrait');
    const avatar = el('div', undefined, 'riff-profile-avatar');
    const avatarImage = mediaImage(summary?.avatar_url, summary?.display_name ? `${summary.display_name} profile photo` : 'Creator profile photo', 'riff-media-image');
    if (avatarImage) avatar.append(avatarImage); else avatar.append(instagram?instagramIcon():tiktokIcon());
    const badge = el('span', undefined, `riff-profile-platform riff-profile-platform--${platform}`); badge.append(instagram?instagramIcon():tiktokIcon()); avatar.append(badge);
    portrait.append(avatar);
    const profileMetric = (label: string, value: string|number, kind:'followers'|'views'|'engagement') => {
      const chip = el('div', undefined, `riff-profile-metric riff-profile-metric--${kind}`);
      const icon = el('span', undefined, 'riff-profile-metric__icon'); icon.append(kind==='followers'?peopleIcon():kind==='views'?eyeIcon('#3567DB'):heartIcon());
      const copy = el('span', undefined, 'riff-profile-metric__copy'); copy.append(el('strong', typeof value==='number'?formatMetric(value):value), el('small', label));
      chip.append(icon, copy); return chip;
    };
    if (summary?.follower_count !== null && summary?.follower_count !== undefined) portrait.append(profileMetric('Followers', summary.follower_count,'followers'));
    const observed=profileAnalysis?.performance?.observed_views;
    if(observed)portrait.append(profileMetric('Views',observed.value,'views'));
    const engagement=profileAnalysis?.performance?.engagement_rate;
    if(engagement)portrait.append(profileMetric('Engagement',`${new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(engagement.percent)}%`,'engagement'));
    const identityBlock = el('div', undefined, 'riff-profile-identity');
    identityBlock.append(el('strong', summary?.display_name ?? dna.profile.native_id));
    if (summary?.handle) identityBlock.append(el('span', `@${summary.handle.replace(/^@/, '')}`));
    portrait.append(identityBlock);
    profile.append(portrait);
    const noun=instagram?(dna.coverage.unique_videos===1?'Instagram Reel':'Instagram Reels'):(dna.coverage.unique_videos===1?'TikTok video':'TikTok videos');
    profile.append(el('p', `${dna.coverage.unique_videos} ${noun} reviewed`, 'riff-profile-reviewed'));
    const evidenceById=new Map(dna.evidence.map(item=>[item.observation_id,item]));
    const top=(profileAnalysis?.top_content??[]).map(item=>evidenceById.get(item.observation_id)).filter((item):item is CreatorDnaView['evidence'][number]=>Boolean(item));
    if (top.length) {
      const group = el('section', undefined, 'riff-profile-top'); group.append(el('h2', instagram?'Top Reels':'Top videos'));
      const videos = el('div', undefined, 'riff-profile-videos');
      top.forEach(item => {
        const media = safeLink(item.url, 'Open top video', 'riff-profile-video');
        const preview = mediaImage(item.thumbnail_url, 'Top video preview', 'riff-media-image'); if (preview) media.append(preview);
        const badge = el('span', undefined, 'riff-profile-video__metric'); badge.append(eyeIcon('#FFFFFF'), el('span', formatMetric(item.metrics!.views!)));
        media.append(badge); videos.append(media);
      });
      group.append(videos); profile.append(group);
    }
    const analysis = el('section', undefined, 'riff-profile-analysis');
    const findings=profileAnalysis?.findings;
    if(findings){
      const claims=new Map(dna.claims.map(claim=>[claim.id,claim.statement]));
      const findingBand=(kind:'working'|'improvement',label:string,statusText:string)=>{
        const finding=findings[kind];const insight=el('article',undefined,`riff-profile-insight riff-profile-insight--${kind}`);
        const head=el('header');head.append(el('h2',label),el('span',statusText));const body=el('div',undefined,'riff-profile-insight__body');
        body.append(el('p',claims.get(finding.claim_id)!),el('p',finding.evidence_summary),el('p',finding.recommendation));insight.append(head,body);return insight;
      };
      analysis.append(findingBand('working','What’s working','Working well'),findingBand('improvement','What to improve','Needs attention'));
      const next = el('article', undefined, 'riff-profile-next');const nextHead=el('header');nextHead.append(el('h2', 'Your next move'));
      const nextBody=el('div',undefined,'riff-profile-next__body');nextBody.append(el('strong',findings.next_move.title),el('p',findings.next_move.rationale));
      nextBody.append(button('Find my next breakout idea', 'riff-button riff-button--primary', () => void run(() => options.startRecommendations
        ? options.startRecommendations({ job, dna })
        : sendPrompt('Use the completed Riff analysis to explore viral formats that fit this creator. Do not start new provider work without my explicit confirmation.')), 'explore-formats'));
      next.append(nextHead,nextBody);analysis.append(next);
    }
    shell.append(profile, analysis); content.append(shell);
    setStatus('Creator analysis shown.'); return heading;
  }

  function renderAnalysis(job: CreatorJobView & { result: { kind: 'scan'; dna: CreatorDnaView } }) {
    const dna = job.result.dna;
    const isVideo=job.source_kind==='video';
    if (isVideo&&dna.seed_review?.access_basis === 'transcript_or_caption_only') return renderPartialVideoAnalysis(job);
    if (mode === 'inline') {
      content.className = 'riff-pipeline__content riff-inline-result';
      const headingText = isVideo ? 'Video analysis' : 'Creator analysis';
      const { group, heading } = title(headingText); content.append(group, actions(
        button('Open analysis', 'riff-button riff-button--primary', () => void run(requestFullscreen), 'open-analysis'),
        button('Explore viral formats', 'riff-button', () => void run(() => options.startRecommendations
          ? options.startRecommendations({ job, dna })
          : sendPrompt('Use the completed Riff analysis to explore viral formats that fit this creator. Do not start new provider work without my explicit confirmation.')), 'explore-formats'),
      ));
      setStatus(`${headingText} ready.`); return heading;
    }
    if(!isVideo)return renderProfileAnalysis(job);
    const dimensions=dna.seed_review?.dimensions;
    const complete=dna.seed_review?.access_basis==='video_access_reported'&&dimensions?.length===6&&new Set(dimensions.map(item=>item.dimension)).size===6;
    return complete?renderVideoAnalysis(job):renderLimitedVideoAnalysis();
  }

  const referenceFor = (idea: RecommendationResult['batch']['ideas'][number], references: Map<string, PipelineReference>) =>
    idea.reference_ids.map(id => references.get(id)).find((reference): reference is PipelineReference => Boolean(reference));

  function renderDiscovery(job: CreatorJobView & { result: { kind: 'recommendations' } }) {
    if(mode==='fullscreen')enterDiscovery(true,job.project_id);
    const batch = job.result.batch;
    const references = new Map(batch.references.map(reference => [reference.id, reference]));
    const valid = batch.ideas.filter(idea => idea.reference_ids.every(id => references.has(id)));
    if (mode === 'inline') {
      content.className = 'riff-pipeline__content riff-inline-result';
      const { group, heading } = title('Discovery');
      content.append(group, actions(button('Open discovery', 'riff-button riff-button--primary', () => void run(requestFullscreen), 'open-discovery')));
      setStatus('Discovery ready.'); return heading;
    }
    screen('discovery');
    const libraryView = discoveryLibraryViews[discoveryLibrary];
    if (!(libraryView.filters as readonly string[]).includes(discoveryFilter)) discoveryFilter = libraryView.filters[0];
    const header = el('header', undefined, 'riff-discovery-header');
    const { group, heading } = title(libraryView.title, 'riff-discovery-title'); header.append(group);
    const libraries = el('div', undefined, 'riff-libraries'); libraries.setAttribute('aria-label', 'Discovery libraries'); libraries.setAttribute('role', 'tablist');
    const libraryControls: HTMLButtonElement[] = [];
    discoveryLibraries.forEach(([kind, label], index) => {
      const selected = kind === discoveryLibrary;
      const control = button(label, `riff-library${selected ? ' riff-library--active' : ''}`, () => {
        discoveryLibrary = kind; discoveryFilter = discoveryLibraryViews[kind].filters[0]; render(job);
      }, `library-${kind}`);
      control.setAttribute('role', 'tab'); control.setAttribute('aria-selected', String(selected)); control.tabIndex = selected ? 0 : -1;
      control.addEventListener('keydown', event => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? discoveryLibraries.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + discoveryLibraries.length) % discoveryLibraries.length;
        libraryControls[target]?.focus();
      });
      libraryControls.push(control); libraries.append(control);
    });
    header.append(libraries); content.append(header, el('p', libraryView.copy, 'riff-discovery-copy'));

    const filters = el('div', undefined, 'riff-discovery-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Video filters');
    libraryView.filters.forEach(label => {
      const active = label === discoveryFilter;
      const control = button(label, `riff-filter${active ? ' riff-filter--active' : ''}`, () => { discoveryFilter = label; render(job); }, `filter-${label}`);
      control.setAttribute('aria-pressed', String(active)); filters.append(control);
    });
    content.append(filters);
    const visible=valid;
    if (!visible.length) { setStatus('No videos are available.'); return heading; }

    ideaIndex = Math.min(ideaIndex, visible.length - 1);
    const carousel = el('section', undefined, 'riff-discovery-carousel'); carousel.dataset.discoveryCarousel = '';
    carousel.dataset.focus = 'discovery-carousel'; carousel.tabIndex = 0; carousel.setAttribute('aria-label', `Video ${ideaIndex + 1} of ${visible.length}`);
    carousel.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault(); ideaIndex = (ideaIndex + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length; render(job);
    });
    const stage = el('div', undefined, 'riff-discovery-stage');
    visible.forEach((idea, index) => {
      let delta = index - ideaIndex;
      if (delta > Math.floor(visible.length / 2)) delta -= visible.length;
      if (delta < -Math.floor(visible.length / 2)) delta += visible.length;
      if (Math.abs(delta) > 2) return;
      const position = delta === 0 ? 'active' : delta === -1 ? 'left-one' : delta === 1 ? 'right-one' : delta < 0 ? 'left-two' : 'right-two';
      const card = el('article', undefined, `riff-idea-card riff-idea-card--${position}`); card.dataset.ideaCard = idea.id;
      if (delta === 0) card.dataset.activeIdea = idea.id;
      const reference = referenceFor(idea, references);
      const media = safeLink(reference?.url, `Open source for ${idea.title}`, 'riff-idea-media');
      const preview = mediaImage(reference?.thumbnail_url, 'Reference video preview', 'riff-media-image'); if (preview) media.append(preview);
      const play = el('span', undefined, 'riff-idea-play'); play.append(playIcon()); media.append(play);
      if (reference?.view_multiplier !== undefined) {
        const multiplier = el('span', undefined, 'riff-idea-multiplier');
        multiplier.setAttribute('aria-label', `${reference.view_multiplier.toFixed(1)} times the observed profile baseline`);
        multiplier.append(trendIcon(), el('strong', `${reference.view_multiplier.toFixed(1)}×`)); media.append(multiplier);
      }
      const referenceMetrics: Array<{ value: number; label: string; icon: SVGElement }> = [];
      if (reference?.views !== null && reference?.views !== undefined) referenceMetrics.push({ value: reference.views, label: 'views', icon: eyeIcon() });
      if (reference?.likes !== null && reference?.likes !== undefined) referenceMetrics.push({ value: reference.likes, label: 'likes', icon: heartIcon() });
      if (reference?.saves !== null && reference?.saves !== undefined) referenceMetrics.push({ value: reference.saves, label: 'saves', icon: saveIcon('#544276') });
      if (referenceMetrics.length) {
        const stats = el('span', undefined, 'riff-idea-stats');
        referenceMetrics.forEach(item => {
          const stat = el('span', undefined, 'riff-idea-stat'); stat.setAttribute('aria-label', `${formatMetric(item.value)} ${item.label}`);
          stat.append(item.icon, el('strong', formatMetric(item.value))); stats.append(stat);
        });
        media.append(stats);
      }
      card.append(media);
      if (delta === 0) {
        card.append(el('p', libraryView.quote ? `“${idea.title}”` : idea.title, 'riff-idea-title'));
        const cardActions = el('div', undefined, 'riff-idea-actions');
        const intent = discoveryIntent(discoveryLibrary, discoveryFilter, idea.title);
        cardActions.append(button(libraryView.action, 'riff-button riff-button--primary', () => void run(() => options.makeMine
          ? options.makeMine({ job, batch, idea, library: discoveryLibrary, filter: discoveryFilter, intent })
          : sendPrompt(intent)), 'make-it-mine'));
        const bookmark = button('', 'riff-bookmark', () => void run(() => sendPrompt(`Bookmark “${idea.title}” in Riff. Do not claim it is saved unless Riff confirms persistence.`)), 'bookmark-idea');
        bookmark.setAttribute('aria-label', 'Bookmark idea'); bookmark.append(bookmarkIcon()); cardActions.append(bookmark); card.append(cardActions);
      }
      stage.append(card);
    });
    carousel.append(stage);
    const navigation = el('div', undefined, 'riff-carousel-navigation');
    const previous = button('', 'riff-carousel-arrow', () => { ideaIndex = (ideaIndex - 1 + visible.length) % visible.length; render(job); }, 'previous-idea');
    previous.setAttribute('aria-label', 'Previous idea'); previous.append(arrowIcon('previous'));
    const dots = el('div', undefined, 'riff-discovery-dots'); dots.setAttribute('role', 'group'); dots.setAttribute('aria-label', 'Video position');
    visible.forEach((_, index) => {
      const dot = button('', 'riff-discovery-dot', () => { ideaIndex = index; render(job); }, `idea-dot-${index}`);
      dot.setAttribute('aria-label', `Go to idea ${index + 1}`); dot.setAttribute('aria-current', String(index === ideaIndex)); dots.append(dot);
    });
    const next = button('', 'riff-carousel-arrow', () => { ideaIndex = (ideaIndex + 1) % visible.length; render(job); }, 'next-idea');
    next.setAttribute('aria-label', 'Next idea'); next.append(arrowIcon('next'));
    navigation.append(previous, dots, next); carousel.append(navigation, el('p', 'Use the left and right arrow keys', 'riff-carousel-hint'));
    content.append(carousel); setStatus(`${visible.length} videos shown.`); return heading;
  }

  function renderCatalogDiscovery(){
    if(disposed||mode!=='fullscreen')return;
    const active=doc.activeElement as HTMLElement|null;const hadFocus=!!active&&content.contains(active);const focusKey=hadFocus?active.dataset.focus:undefined;
    location.textContent='Discover videos';menu?.render({activeRoute:'discover'});showingCatalog=true;content.replaceChildren();screen('discovery');
    const view=discoveryLibraryViews[discoveryLibrary];if(!(view.filters as readonly string[]).includes(discoveryFilter))discoveryFilter=view.filters[0];
    const header=el('header',undefined,'riff-discovery-header');const headingGroup=title(view.title,'riff-discovery-title');header.append(headingGroup.group);
    const tabs=el('div',undefined,'riff-libraries');tabs.setAttribute('aria-label','Discovery libraries');tabs.setAttribute('role','tablist');
    const tabControls:HTMLButtonElement[]=[];
    discoveryLibraries.forEach(([kind,label],index)=>{const selected=kind===discoveryLibrary;const control=button(label,`riff-library${selected?' riff-library--active':''}`,()=>{
      discoveryLibrary=kind;discoveryFilter=discoveryLibraryViews[kind].filters[0];if(studioExplore?.library!==kind)studioExplore=undefined;renderCatalogDiscovery();
    },`library-${kind}`);control.setAttribute('role','tab');control.setAttribute('aria-selected',String(selected));control.tabIndex=selected?0:-1;
      control.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;event.preventDefault();
        const target=event.key==='Home'?0:event.key==='End'?discoveryLibraries.length-1:
          (index+(event.key==='ArrowRight'?1:-1)+discoveryLibraries.length)%discoveryLibraries.length;tabControls[target]?.focus();});
      tabControls.push(control);tabs.append(control);});
    header.append(tabs);content.append(header,el('p',view.copy,'riff-discovery-copy'));
    const filters=el('div',undefined,'riff-discovery-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Video filters');
    view.filters.forEach(label=>{const selected=label===discoveryFilter;const control=button(label,`riff-filter${selected?' riff-filter--active':''}`,()=>{
      discoveryFilter=label;renderCatalogDiscovery();
    },`filter-${label}`);control.setAttribute('aria-pressed',String(selected));filters.append(control);});content.append(filters);

    const page=catalogState.page;
    const catalogNotice=(message:string,retryable=false)=>{const notice=el('div',undefined,'riff-catalog-state');notice.setAttribute('role',catalogState.status==='error'?'alert':'status');
      notice.append(el('p',message));if(retryable){const retry=button('Retry','riff-button',()=>options.onCatalogRetry?.(),'retry-catalog');notice.append(retry);}content.append(notice);return notice;};
    if(catalogState.status==='loading'&&!page){content.setAttribute('aria-busy','true');catalogNotice('Loading saved reference videos…');setStatus('Loading saved reference videos…');return;}
    content.removeAttribute('aria-busy');
    if(catalogState.status==='loading'&&page)catalogNotice('Refreshing saved reference videos…');
    if(catalogState.status==='empty'){catalogNotice('No saved permitted reference videos are available for this scope.');setStatus('No saved reference videos are available.');return;}
    if(catalogState.status==='error')catalogNotice(catalogState.message,catalogState.retryable);
    if(!page){setStatus('Saved reference videos are unavailable.');return;}
    const cards=page.cards.slice(0,8);
    if(!cards.length){catalogNotice('No saved permitted reference videos are available for this scope.');setStatus('No saved reference videos are available.');return;}
    const caveats=el('p',`${page.coverage} ${page.freshness}`,'riff-catalog-provenance');caveats.dataset.catalogCaveats='';content.append(caveats);
    const retainedIndex=catalogActiveId?cards.findIndex(card=>card.id===catalogActiveId):-1;
    catalogIndex=retainedIndex>=0?retainedIndex:Math.max(0,Math.min(catalogIndex,cards.length-1));catalogActiveId=cards[catalogIndex]?.id;
    const move=(direction:1|-1)=>{catalogIndex=(catalogIndex+direction+cards.length)%cards.length;catalogActiveId=cards[catalogIndex]?.id;renderCatalogDiscovery();};
    const select=(index:number)=>{catalogIndex=index;catalogActiveId=cards[index]?.id;renderCatalogDiscovery();};
    const carousel=el('section',undefined,'riff-discovery-carousel');carousel.dataset.discoveryCarousel='';carousel.tabIndex=0;
    carousel.dataset.focus='discovery-carousel';carousel.setAttribute('aria-label',`Video ${catalogIndex+1} of ${cards.length}`);
    carousel.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft'].includes(event.key))return;event.preventDefault();
      move(event.key==='ArrowRight'?1:-1);});
    const stage=el('div',undefined,'riff-discovery-stage');cards.forEach((card,index)=>{
      let delta=index-catalogIndex;if(delta>Math.floor(cards.length/2))delta-=cards.length;if(delta< -Math.floor(cards.length/2))delta+=(cards.length);
      if(Math.abs(delta)>2)return;
      const position=delta===0?'active':delta===-1?'left-one':delta===1?'right-one':delta<0?'left-two':'right-two';
      const article=el('article',undefined,`riff-idea-card riff-idea-card--${position}`);article.dataset.catalogCard=card.id;if(delta===0)article.dataset.activeCatalog=card.id;
      const media=safeLink(card.canonical_url,'Open saved video','riff-idea-media');const preview=mediaImage(card.thumbnail_url??undefined,'Saved video preview','riff-media-image');if(preview)media.append(preview);
      const play=el('span',undefined,'riff-idea-play');play.append(playIcon());media.append(play);
      const observed=[['views',card.metrics.views,eyeIcon()],['likes',card.metrics.likes,heartIcon()],['saves',card.metrics.saves,saveIcon('#544276')]] as const;
      const stats=el('span',undefined,'riff-idea-stats');let hasStats=false;
      for(const [label,value,icon] of observed){if(value===null)continue;hasStats=true;const stat=el('span',undefined,'riff-idea-stat');stat.setAttribute('aria-label',`${formatMetric(value)} ${label}`);stat.append(icon,el('strong',formatMetric(value)));stats.append(stat);}
      if(hasStats)media.append(stats);
      article.append(media);if(delta===0){if(card.caption)article.append(el('p',card.caption,'riff-idea-title'));
        const sourceDate=card.source_observed_at??card.observed_at;const provenance=el('p',`${card.origin==='fixture'?'Fixture reference':'Saved reference'} · observed ${new Date(sourceDate).toLocaleDateString('en',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'})}`,'riff-catalog-provenance');article.append(provenance);
        const intent=catalogProposalIntent(card,discoveryLibrary,discoveryFilter);const action=button(view.action,'riff-button riff-button--primary',()=>void run(()=>options.proposeCatalogReference
          ? options.proposeCatalogReference({card:structuredClone(card),library:discoveryLibrary,filter:discoveryFilter,intent,...(studioExplore?.library===discoveryLibrary?{studioExplore:structuredClone(studioExplore)}:{})})
          : sendPrompt(intent)),'catalog-proposal');article.append(el('div',undefined,'riff-idea-actions'));article.lastElementChild!.append(action);}
      stage.append(article);
    });
    carousel.append(stage);const navigation=el('div',undefined,'riff-carousel-navigation');
    const previous=button('','riff-carousel-arrow',()=>move(-1),'previous-video');previous.setAttribute('aria-label','Previous video');previous.append(arrowIcon('previous'));
    const dots=el('div',undefined,'riff-discovery-dots');dots.setAttribute('role','group');dots.setAttribute('aria-label','Video position');cards.forEach((_card,index)=>{const dot=button('','riff-discovery-dot',()=>select(index),`catalog-dot-${index}`);dot.setAttribute('aria-label',`Go to video ${index+1}`);dot.setAttribute('aria-current',String(index===catalogIndex));dots.append(dot);});
    const next=button('','riff-carousel-arrow',()=>move(1),'next-video');next.setAttribute('aria-label','Next video');next.append(arrowIcon('next'));
    navigation.append(previous,dots,next);carousel.append(navigation,el('p','Use the left and right arrow keys','riff-carousel-hint'));content.append(carousel);setStatus(`${cards.length} saved reference videos shown.`);
    if(hadFocus)([...content.querySelectorAll<HTMLElement>('[data-focus]')].find(node=>node.dataset.focus===focusKey)??headingGroup.heading).focus({preventScroll:true});
  }

  function scriptPart(label: string, copy: string, tip?: string) {
    const part = el('article', undefined, 'riff-script-part'); part.append(el('h3', label));
    const body = el('div', undefined, 'riff-script-part__body'); body.append(el('p', copy));
    if (tip) { const note = el('div', undefined, 'riff-filming-tip'); note.append(bulbIcon(), el('p', tip)); body.append(note); }
    part.append(body); return part;
  }

  const formatSeconds = (seconds: number) => Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1).replace(/\.0$/, '');

  function renderStudio(job: CreatorJobView & { result: { kind: 'scripts' } }) {
    const scripts = job.result.scripts;
    if (mode === 'inline') {
      content.className = 'riff-pipeline__content riff-inline-result';
      const { group, heading } = title('Your script, ready to film.');
      content.append(group, actions(button('Open Studio', 'riff-button riff-button--primary', () => void run(requestFullscreen), 'open-studio')));
      setStatus('Studio ready.'); return heading;
    }
    screen('studio');
    const variant = scripts.variants[0]!;
    const reference = scripts.references?.find(item => variant.reference_ids.includes(item.id));
    const header = el('header', undefined, 'riff-studio-header');
    const { group, heading } = title('Your script, ready to film.', 'riff-studio-title');
    if (scripts.idea?.title) group.append(el('p', `${scripts.idea.title}${reference?.platform === 'tiktok' ? ' · TikTok' : ''}`, 'riff-studio-subtitle'));
    header.append(group);
    const studioActions = actions(
      button('Save for later', 'riff-button', () => void run(() => options.setVariantState
        ? options.setVariantState({ job, scripts, variant, state: 'saved' })
        : sendPrompt(`Help me save the ${variant.label} script for later in ChatGPT. Riff has not saved this action because no save-state tool is available.`)), 'save-later'),
      button('I filmed it', 'riff-button riff-button--primary', () => void run(() => options.setVariantState
        ? options.setVariantState({ job, scripts, variant, state: 'filmed' })
        : sendPrompt(`I filmed the ${variant.label} script. Record that acknowledgement in ChatGPT only; it is not persisted in Riff because no filmed-state tool is available.`)), 'filmed-it'),
    );
    studioActions.classList.add('riff-studio-actions'); studioActions.setAttribute('role', 'group'); studioActions.setAttribute('aria-label', 'Studio actions');
    header.append(studioActions); content.append(header);
    const shell = el('section', undefined, 'riff-studio-shell');
    const shellMeta = el('div', undefined, 'riff-studio-shell__meta');
    shellMeta.append(el('h2', 'Your references & script'), el('p', `${formatSeconds(variant.estimated_duration_seconds)} seconds · 3 parts`));
    shell.append(shellMeta);
    const tabNames = ['Full video', 'Hook', 'Main content', 'CTA'] as const;
    const tabs = el('div', undefined, 'riff-studio-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Script components');
    const tabControls: HTMLButtonElement[] = [];
    tabNames.forEach((name, index) => {
      const tab = button(name, 'riff-studio-tab', () => { studioTab = index; render(job); }, `studio-tab-${index}`);
      tab.id = `riff-studio-tab-${index}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(index === studioTab));
      tab.setAttribute('aria-controls', 'riff-studio-panel'); tab.tabIndex = index === studioTab ? 0 : -1;
      tab.addEventListener('keydown', event => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); studioTab = event.key === 'Home' ? 0 : event.key === 'End' ? tabNames.length - 1
          : (studioTab + (event.key === 'ArrowRight' ? 1 : -1) + tabNames.length) % tabNames.length; render(job);
      });
      tabControls.push(tab); tabs.append(tab);
    });
    shell.append(tabs);
    const body = el('div', undefined, 'riff-studio-body');
    const player = safeLink(reference?.url, 'Open reference video', 'riff-studio-player');
    const preview = mediaImage(reference?.thumbnail_url, 'Reference video preview', 'riff-media-image'); if (preview) player.append(preview);
    player.append(el('span', studioTab === 0 ? 'Main format' : `Reference · ${tabNames[studioTab]}`, 'riff-studio-player__label'));
    const play = el('span', undefined, 'riff-studio-player__play'); play.append(playIcon(true)); player.append(play);
    const minutes = Math.floor(variant.estimated_duration_seconds / 60);
    const seconds = Math.round(variant.estimated_duration_seconds % 60).toString().padStart(2, '0');
    player.append(el('span', `0:00 / ${minutes}:${seconds}`, 'riff-studio-player__time')); body.append(player);
    const panel = el('section', undefined, 'riff-studio-panel'); panel.id = 'riff-studio-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `riff-studio-tab-${studioTab}`);
    const panelHeader = el('div', undefined, 'riff-studio-panel__header');
    const panelTitles = ['Your complete video', 'Your hook', 'Your main content', 'Your CTA']; panelHeader.append(el('h2', panelTitles[studioTab]!));
    const exploreLibraries:readonly RiffDiscoveryLibrary[]=['videos','hooks','showcases','ctas'];
    const exploreParts:readonly RiffStudioExploreIntent['part'][]=['full','hook','main_content','cta'];
    const exploreLabels=['Explore videos','Explore hooks','Explore showcases','Explore CTAs'] as const;
    const subject = scripts.idea?.title ? `“${scripts.idea.title}”` : 'my current Riff video';
    panelHeader.append(button(exploreLabels[studioTab]!, 'riff-button', () => {
      const library=exploreLibraries[studioTab]!;const prompt=`Explore ${library==='showcases'?'product showcases':library} for ${subject}. Keep the current script unchanged until I explicitly choose an adaptation.`;
      enterDiscovery(true,job.project_id,true);studioExplore={source:'studio',part:exploreParts[studioTab]!,library,prompt,currentScriptUnchanged:true};
      discoveryLibrary=library;discoveryFilter=discoveryLibraryViews[library].filters[0];renderCatalogDiscovery();
    }, `explore-${studioTab}`));
    panel.append(panelHeader);
    const mainTip = [...variant.shots, ...variant.b_roll, ...variant.on_screen_text, variant.showcase_timing, variant.pacing].join(' · ');
    const partOrder = ['hook', 'main_content', 'cta'] as const;
    const partLabels = { hook: 'Hook', main_content: 'Main content', cta: 'CTA' } as const;
    const visiblePart = studioTab === 1 ? 'hook' : studioTab === 2 ? 'main_content' : studioTab === 3 ? 'cta' : undefined;
    const appendFallback = (part: typeof partOrder[number]) => {
      if (part === 'hook') panel.append(scriptPart('Hook', variant.hook, variant.opening_visual));
      else if (part === 'main_content') panel.append(scriptPart('Main content', variant.script, mainTip));
      else panel.append(scriptPart('CTA', variant.cta));
    };
    const visibleParts: readonly (typeof partOrder[number])[] = visiblePart ? [visiblePart] : partOrder;
    for (const part of visibleParts) {
      const timed = variant.timed_segments?.filter(segment => segment.part === part) ?? [];
      if (!timed.length) { appendFallback(part); continue; }
      timed.forEach(segment => panel.append(scriptPart(
        `${partLabels[segment.part]} · ${formatSeconds(segment.start_seconds)}–${formatSeconds(segment.end_seconds)}s`,
        segment.spoken_text,
        `${segment.filming_direction}${segment.on_screen_text ? ` Caption: ${segment.on_screen_text}` : ''}`,
      )));
    }
    body.append(panel); shell.append(body); content.append(shell);
    if (variant.caption || variant.hashtags?.length) {
      const caption = el('section', undefined, 'riff-studio-caption');
      const captionHeader = el('div', undefined, 'riff-studio-caption__header'); captionHeader.append(el('h2', 'Caption'));
      const copyText = [variant.caption, variant.hashtags?.join(' ')].filter(Boolean).join('\n\n');
      const copy = button('', 'riff-caption-copy', () => {
        const clipboard = doc.defaultView?.navigator.clipboard;
        if (!clipboard) { setStatus('Copy the caption directly from Studio.'); return; }
        void clipboard.writeText(copyText).then(() => setStatus('Caption copied.'), () => setStatus('Copy the caption directly from Studio.'));
      }, 'copy-caption');
      copy.setAttribute('aria-label', 'Copy caption'); copy.append(copyIcon()); captionHeader.append(copy); caption.append(captionHeader);
      if (reference?.platform === 'tiktok') captionHeader.append(el('span', 'TikTok', 'riff-caption-platform'));
      if (variant.caption) caption.append(el('p', variant.caption, 'riff-studio-caption__copy'));
      if (variant.hashtags?.length) caption.append(el('p', variant.hashtags.join(' '), 'riff-studio-caption__hashtags'));
      content.append(caption);
    }
    setStatus('Studio shown.'); return heading;
  }

  function render(job: CreatorJobView,presentation:CreatorPipelinePresentation={}) {
    if (disposed) return;
    const nextIdentity = `${job.project_id}:${job.id}`;
    const same = identity === nextIdentity;
    const preserveStudioCatalog=same&&showingCatalog&&studioExplore?.library===discoveryLibrary&&catalogScopeKey===job.project_id;
    const active = doc.activeElement as HTMLElement | null;
    const hadFocus = !!active && content.contains(active);
    const focusKey = same && hadFocus ? active.dataset.focus : undefined;
    if (!same) {
      ideaIndex = 0; catalogIndex=0;catalogActiveId=undefined;discoveryLibrary = 'videos'; discoveryFilter = 'For you'; studioTab = 0;sourceUrl=undefined;studioExplore=undefined;
      if(current?.project_id!==job.project_id){catalogState={status:'loading'};catalogScopeKey=undefined;}
    }
    if(!preserveStudioCatalog)studioExplore=undefined;
    if(presentation.sourceUrl)sourceUrl=presentation.sourceUrl;
    if(presentation.status?.progress.kind==='scan'&&presentation.status.progress.videos.length)sourceUrl=undefined;
    identity = nextIdentity; current = job;currentStatus=presentation.status;wrapper.dataset.mode = mode;
    if(preserveStudioCatalog){renderCatalogDiscovery();return;}
    showingCatalog=false;content.replaceChildren();
    let heading: HTMLElement;
    const observedState=presentation.status?.state??job.state;
    location.textContent=job.kind==='recommendations'?'Discover videos':job.kind==='scripts'?'Studio':'Analysis';
    menu?.render({activeRoute:job.kind==='recommendations'?'discover':job.kind==='scripts'?'studio':'analysis'});
    if (observedState === 'queued' || observedState === 'running') {screenKind='pending';heading = renderPending(job,presentation.status);}
    else if (observedState === 'failed' || observedState === 'needs_reconciliation') {
      screenKind='failure';heading=renderFailure(observedState,presentation.status?.progress.limitations??job.progress.limitations);
    } else if(job.result?.kind === 'scan') {screenKind='analysis';heading = renderAnalysis(job as CreatorJobView & { result: { kind: 'scan'; dna: CreatorDnaView } });}
    else if (job.result?.kind === 'recommendations') heading = renderDiscovery(job as CreatorJobView & { result: { kind: 'recommendations' } });
    else if (job.result?.kind === 'scripts') {screenKind='studio';heading = renderStudio(job as CreatorJobView & { result: { kind: 'scripts' } });}
    else {screenKind='failure';heading=renderSavedResultRetrieval();}
    if (hadFocus) ([...content.querySelectorAll<HTMLElement>('[data-focus]')].find(node => node.dataset.focus === focusKey) ?? heading).focus({ preventScroll: true });
  }

  return {
    render,
    setCatalogState(state){
      const priorPage=catalogState.page;const next=structuredClone(state);
      if(next.page&&(next.page.cards.length>8||next.page.cards.some(card=>card.role!=='discovered_reference'))){
        catalogState={status:'error',message:'Saved reference videos could not be loaded.',retryable:true,...(priorPage?{page:structuredClone(priorPage)}:{})};
      }else catalogState=next;
      if(showingCatalog)renderCatalogDiscovery();
    },
    showCatalog(library='videos',scope={},explore){if(disposed)return;
      const projectId=scope.accountWide?undefined:scope.projectId??current?.project_id;enterDiscovery(true,projectId,true);
      discoveryLibrary=library;discoveryFilter=discoveryLibraryViews[library].filters[0];studioExplore=explore?.library===library?structuredClone(explore):undefined;renderCatalogDiscovery();},
    leaveCatalog,
    setNotice(message){if(!disposed)setStatus(message);},
    setDisplayMode(nextMode) { if (disposed || mode === nextMode) return; mode = nextMode;if(showingCatalog)renderCatalogDiscovery();else if (current) render(current,{...(currentStatus?{status:currentStatus}:{}),...(sourceUrl?{sourceUrl}:{})}); },
    dispose() { if (disposed) return; disposed = true;menu?.dispose(); current = undefined;currentStatus=undefined;catalogState={status:'loading'};sourceUrl=undefined;catalogScopeKey=undefined;catalogActiveId=undefined;studioExplore=undefined;root.replaceChildren(); },
  };
}
