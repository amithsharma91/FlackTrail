async function handleResponse(res: Response) {
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export const api = {
  analyze: async (logText: string, fileName?: string) => {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logText, fileName }),
    });
    return handleResponse(res);
  },

  getIncident: async (incidentId: string) => {
    const res = await fetch(`/api/incidents/${incidentId}`);
    return handleResponse(res);
  },

  /** List all recorded incidents (GET /api/incidents). */
  listIncidents: async () => {
    const res = await fetch('/api/incidents');
    return handleResponse(res);
  },

  resolveIncident: async (incidentId: string, body: any) => {
    const res = await fetch(`/api/incidents/${incidentId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return handleResponse(res);
  },

  /** Check backend health (GET /api/health). */
  health: async () => {
    const res = await fetch('/api/health');
    return handleResponse(res);
  },

  /**
   * Optional Hindsight REFLECT: re-analyzes a failure using Hindsight memory.
   * Consumes a paid Hindsight operation — not part of normal analysis.
   * (POST /api/reflect)
   */
  reflect: async (incidentId: string) => {
    const res = await fetch('/api/reflect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidentId }),
    });
    return handleResponse(res);
  },

  /** Check whether the current user has permission to run REFLECT (GET /api/reflect/permission). */
  reflectPermission: async () => {
    const res = await fetch('/api/reflect/permission');
    return handleResponse(res);
  },
};
