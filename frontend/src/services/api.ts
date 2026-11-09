// Normalize the base URL: strip trailing slashes so that
// `${baseUrl}${path}` never produces a double-slash URL
// (e.g. "https://backend.onrender.com/" + "/api/analyze" would otherwise
//  become "https://backend.onrender.com//api/analyze" -> Express 404).
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

async function handleResponse(res: Response) {
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

export const api = {
  analyze: async (logText: string, fileName?: string) => {
    const res = await fetch(apiUrl('/api/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logText, fileName }),
    });
    return handleResponse(res);
  },

  getIncident: async (incidentId: string) => {
    const res = await fetch(apiUrl(`/api/incidents/${incidentId}`));
    return handleResponse(res);
  },

  /** List all recorded incidents (GET /api/incidents). */
  listIncidents: async () => {
    const res = await fetch(apiUrl('/api/incidents'));
    return handleResponse(res);
  },

  resolveIncident: async (incidentId: string, body: any) => {
    const res = await fetch(apiUrl(`/api/incidents/${incidentId}/resolve`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return handleResponse(res);
  },

  /** Check backend health (GET /api/health). */
  health: async () => {
    const res = await fetch(apiUrl('/api/health'));
    return handleResponse(res);
  },

  /**
   * Optional Hindsight REFLECT: re-analyzes a failure using Hindsight memory.
   * Consumes a paid Hindsight operation — not part of normal analysis.
   * (POST /api/reflect)
   */
  reflect: async (incidentId: string) => {
    const res = await fetch(apiUrl('/api/reflect'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidentId }),
    });
    return handleResponse(res);
  },

  /** Check whether the current user has permission to run REFLECT (GET /api/reflect/permission). */
  reflectPermission: async () => {
    const res = await fetch(apiUrl('/api/reflect/permission'));
    return handleResponse(res);
  },
};
