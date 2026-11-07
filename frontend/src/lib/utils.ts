export function cn(...classes: (string | undefined | null | boolean)[]) {
  return classes.filter(Boolean).join(' ');
}

/** Tailwind color config for the four incident statuses. */
export const STATUS_CONFIG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  verified: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', label: 'Verified' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', label: 'Failed' },
  passed_unmerged: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', label: 'Passed, unmerged' },
  proposed: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', label: 'Proposed' },
};

export function statusConfig(status: string) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.proposed;
}

/** Format an ISO timestamp into a short, locale-friendly string. */
export function formatDate(timestamp?: string | null): string {
  if (!timestamp) return '—';
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

/** Maximum upload size in bytes (2 MB). */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Allowed log file extensions. */
export const ALLOWED_LOG_EXTENSIONS = ['.log', '.txt'];

export function isAllowedLogFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ALLOWED_LOG_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
