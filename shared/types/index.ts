// FlakeTrail shared types

// Incident statuses (MVP)
export type IncidentStatus = 'proposed' | 'failed' | 'passed_unmerged' | 'verified';

// A parsed CI failure
export interface ParsedFailure {
  testName: string;
  errorMessage: string;
  errorType?: string;
  stackTrace?: string;
  failureSignature: string;
  environment?: Record<string, string>;
  filePaths?: string[];
  timestamp?: string;
  ciJobId?: string;
  ciBranch?: string;
  rawLogExcerpt?: string;
}

// A historical investigation memory from Hindsight
export interface HistoricalInvestigation {
  id: string;
  testName: string;
  errorMessage: string;
  failureSignature: string;
  status: IncidentStatus;
  attemptedFix?: string;
  ciJobId?: string;
  ciBranch?: string;
  prLink?: string;
  timestamp: string;
  source?: string;
}

// AI reasoning output
export interface AIAnalysis {
  failureSummary: string;
  possibleCauses: Array<{
    cause: string;
    evidence: string[];
    confidence: 'low' | 'medium' | 'high';
  }>;
  relevantHistoricalIncidents: HistoricalInvestigation[];
  failedApproaches: Array<{
    approach: string;
    incidentId: string;
  }>;
  verifiedApproaches: Array<{
    approach: string;
    incidentId: string;
    prLink?: string;
  }>;
  recommendedSteps: string[];
  confidence: 'low' | 'medium' | 'high';
  uncertaintyExplanation: string;
  hasRelevantHistory: boolean;
}

// Outcome submission
export interface OutcomeSubmission {
  incidentId: string;
  status: IncidentStatus;
  fixDescription?: string;
  ciResult?: 'passed' | 'failed';
  merged?: boolean;
  prLink?: string;
  notes?: string;
}

// Analyze request
export interface AnalyzeRequest {
  logText: string;
  fileName?: string;
}

// Analyze response
export interface AnalyzeResponse {
  incidentId: string;
  parsedFailure: ParsedFailure;
  historicalInvestigations: HistoricalInvestigation[];
  aiAnalysis: AIAnalysis;
}

// Incident detail response
export interface IncidentDetailResponse {
  incidentId: string;
  parsedFailure: ParsedFailure;
  historicalInvestigations: HistoricalInvestigation[];
  aiAnalysis: AIAnalysis;
  status: IncidentStatus;
  outcome?: OutcomeSubmission;
}

// Investigation data for Hindsight retention
export interface InvestigationData {
  incidentId: string;
  testName: string;
  errorMessage: string;
  failureSignature: string;
  environment?: Record<string, string>;
  attemptedFix?: string;
  outcome: IncidentStatus;
  ciResult?: 'passed' | 'failed';
  merged?: boolean;
  prLink?: string;
  notes?: string;
  timestamp: string;
}
