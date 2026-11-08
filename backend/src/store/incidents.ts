// Persistent incident store backed by SQLite.
// Both analyze.ts and incidents.ts routes read/write to this same store.

import { IncidentRepository } from '../persistence/incidentRepository';
import {
  ParsedFailure,
  HistoricalInvestigation,
  AIAnalysis,
  IncidentStatus,
  OutcomeSubmission,
} from '../shared/index';

export interface StoredIncident {
  id: string;
  parsedFailure: ParsedFailure;
  historicalInvestigations: HistoricalInvestigation[];
  aiAnalysis: AIAnalysis;
  status: IncidentStatus;
  outcome?: any;
  createdAt: string;
  updatedAt: string;
}

let incidentRepository: IncidentRepository | null = null;

/**
 * Initialize the incident store with a database connection.
 * Must be called before any store operations.
 */
export function initIncidentStore(db: import('node:sqlite').DatabaseSync): void {
  incidentRepository = new IncidentRepository(db);
}

/**
 * Get the incident repository instance.
 * Throws if the store has not been initialized.
 */
export function getIncidentStore(): IncidentRepository {
  if (!incidentRepository) {
    throw new Error(
      'Incident store not initialized. Call initIncidentStore() first.'
    );
  }
  return incidentRepository;
}

/**
 * Create a new investigation record.
 */
export function createIncident(incident: StoredIncident): void {
  getIncidentStore().create(incident);
}

/**
 * Get an incident by ID.
 */
export function getIncidentById(id: string): StoredIncident | null {
  return getIncidentStore().getById(id);
}

/**
 * List all incidents.
 */
export function listAllIncidents(): StoredIncident[] {
  return getIncidentStore().listAll();
}

/**
 * Update an incident's status and/or outcome.
 */
export function updateIncident(
  id: string,
  updates: {
    status?: IncidentStatus;
    outcome?: any;
  }
): void {
  getIncidentStore().update(id, updates);
}

/**
 * Clear all investigations.
 */
export function clearAll(): void {
  getIncidentStore().clearAll();
}