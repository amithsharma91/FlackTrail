/**
 * Incident repository using SQLite for persistent storage.
 *
 * Provides CRUD operations for investigation incidents. All operations
 * use parameterized queries to prevent SQL injection.
 */

import { DatabaseSync } from 'node:sqlite';
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

export class IncidentRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Create a new investigation record.
   */
  create(incident: StoredIncident): void {
    this.db.prepare(
      `INSERT INTO incidents (
        id, test_name, error_message, error_type, stack_trace,
        failure_signature, environment, file_paths, timestamp,
        ci_job_id, ci_branch, raw_log_excerpt, status, outcome,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      incident.id,
      incident.parsedFailure.testName,
      incident.parsedFailure.errorMessage,
      incident.parsedFailure.errorType ?? null,
      incident.parsedFailure.stackTrace ?? null,
      incident.parsedFailure.failureSignature,
      incident.parsedFailure.environment
        ? JSON.stringify(incident.parsedFailure.environment)
        : null,
      incident.parsedFailure.filePaths
        ? JSON.stringify(incident.parsedFailure.filePaths)
        : null,
      incident.parsedFailure.timestamp ?? null,
      incident.parsedFailure.ciJobId ?? null,
      incident.parsedFailure.ciBranch ?? null,
      incident.parsedFailure.rawLogExcerpt ?? null,
      incident.status,
      incident.outcome ? JSON.stringify(incident.outcome) : null,
      incident.createdAt,
      incident.updatedAt ?? incident.createdAt
    );
  }

  /**
   * Get an incident by ID.
   */
  getById(id: string): StoredIncident | null {
    const row = this.db.prepare(
      `SELECT * FROM incidents WHERE id = ?`
    ).get(id) as any;

    if (!row) {
      return null;
    }

    return this.rowToIncident(row);
  }

  /**
   * List all incidents.
   */
  listAll(): StoredIncident[] {
    const rows = this.db.prepare(
      `SELECT * FROM incidents ORDER BY created_at DESC`
    ).all() as any[];

    return rows.map((row) => this.rowToIncident(row));
  }

  /**
   * Update an incident's status and/or outcome.
   */
  update(
    id: string,
    updates: {
      status?: IncidentStatus;
      outcome?: any;
    }
  ): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.outcome !== undefined) {
      fields.push('outcome = ?');
      values.push(JSON.stringify(updates.outcome));
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(
      `UPDATE incidents SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);
  }

  /**
   * Check if a duplicate retention record exists for the given incident + signature.
   */
  duplicateExists(incidentId: string, failureSignature: string): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM incidents WHERE id = ? AND failure_signature = ? LIMIT 1`
    ).get(incidentId, failureSignature);
    return !!row;
  }

  /**
   * Clear all incidents.
   */
  clearAll(): void {
    this.db.prepare(`DELETE FROM incidents`).run();
  }

  /**
   * Convert a database row to a StoredIncident object.
   */
  private rowToIncident(row: any): StoredIncident {
    return {
      id: row.id,
      parsedFailure: {
        testName: row.test_name,
        errorMessage: row.error_message,
        errorType: row.error_type || undefined,
        stackTrace: row.stack_trace || undefined,
        failureSignature: row.failure_signature,
        environment: row.environment ? JSON.parse(row.environment) : {},
        filePaths: row.file_paths ? JSON.parse(row.file_paths) : [],
        timestamp: row.timestamp,
        ciJobId: row.ci_job_id ?? undefined,
        ciBranch: row.ci_branch ?? undefined,
        rawLogExcerpt: row.raw_log_excerpt ?? undefined,
      },
      historicalInvestigations: row.historical_investigations
        ? JSON.parse(row.historical_investigations)
        : [],
      aiAnalysis: row.ai_analysis ? JSON.parse(row.ai_analysis) : {},
      status: row.status as IncidentStatus,
      outcome: row.outcome ? JSON.parse(row.outcome) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}