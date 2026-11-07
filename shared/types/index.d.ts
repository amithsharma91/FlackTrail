export type IncidentStatus = 'proposed' | 'failed' | 'passed_unmerged' | 'verified';
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
export interface OutcomeSubmission {
    incidentId: string;
    status: IncidentStatus;
    fixDescription?: string;
    ciResult?: 'passed' | 'failed';
    merged?: boolean;
    prLink?: string;
    notes?: string;
}
export interface AnalyzeRequest {
    logText: string;
    fileName?: string;
}
export interface AnalyzeResponse {
    incidentId: string;
    parsedFailure: ParsedFailure;
    historicalInvestigations: HistoricalInvestigation[];
    aiAnalysis: AIAnalysis;
}
export interface IncidentDetailResponse {
    incidentId: string;
    parsedFailure: ParsedFailure;
    historicalInvestigations: HistoricalInvestigation[];
    aiAnalysis: AIAnalysis;
    status: IncidentStatus;
    outcome?: OutcomeSubmission;
}
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
