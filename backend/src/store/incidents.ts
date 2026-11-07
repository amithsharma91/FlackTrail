// Shared in-memory incident store for the MVP.
// Both analyze.ts and incidents.ts routes read/write to this same store.

export interface StoredIncident {
  id: string;
  parsedFailure: any;
  historicalInvestigations: any[];
  aiAnalysis: any;
  status: 'proposed' | 'failed' | 'passed_unmerged' | 'verified';
  outcome?: any;
  createdAt: string;
}

export const incidents: Map<string, StoredIncident> = new Map();
