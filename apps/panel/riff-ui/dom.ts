export type RiffActionResult = {
  status: 'sent' | 'unsupported' | 'failed';
  message: string;
};

export type RiffPanelAction = (prompt: string) => Promise<RiffActionResult>;

export function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function formatRiffDate(value: string | null): string {
  if (value === null) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Unknown';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

