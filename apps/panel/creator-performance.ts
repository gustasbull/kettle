type PanelStage = 'tool_call' | 'poll_observation' | 'panel_render';
type PanelStatus = 'ok' | 'error' | 'timeout' | 'rejected';
type PanelFingerprint = { resource_version: string; bundle_version: string };
type LocalPerformance = Pick<Performance, 'now' | 'measure'>;

const resourceVersions = new Set(['riff-home-v4', 'riff-onboarding-v3', 'creator-pipeline-v4']);
const safeBundleVersion = /^sha256:[a-f0-9]{64}$/;

/** Content-free, browser-local Performance entries. No reporting transport exists. */
export function createPanelPerformance(performance: LocalPerformance, fingerprint: PanelFingerprint) {
  const valid = resourceVersions.has(fingerprint.resource_version)
    && safeBundleVersion.test(fingerprint.bundle_version);
  return {
    start(stage: PanelStage) {
      const started = performance.now();
      return (status: PanelStatus) => {
        if (!valid) return;
        try {
          performance.measure(`riff:${stage}`, { start: started, end: performance.now(), detail: Object.freeze({
            stage, status, resource_version: fingerprint.resource_version,
            bundle_version: fingerprint.bundle_version,
          }) });
        } catch { /* Performance observation cannot alter panel behavior. */ }
      };
    },
  };
}

export function panelPerformanceFromDocument(doc: Document, performance: LocalPerformance) {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="riff-bundle-version"]');
  return createPanelPerformance(performance, {
    resource_version: meta?.dataset.resourceVersion ?? '', bundle_version: meta?.content ?? '',
  });
}
