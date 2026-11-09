# FlakeTrail — Architecture Contract

**Project:** FlakeTrail — Hack With Bangalore 4.0  
**Purpose:** Define shared directory structure, API contracts, TypeScript types, and module interfaces for all six subagents.

This document is the single source of truth for cross-module integration. All six subagents must follow it.

---

## 1. Directory Structure

```
flaketrail/
├── docs/phase-0/              # Phase 0 planning documents (existing, do not modify)
├── shared/
│   ├── types/
│   │   └── index.ts           # Shared TypeScript types
│   └── schemas/
│       └── index.ts           # Shared Zod validation schemas
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # Express app entry point
│       ├── routes/
│       │   ├── analyze.ts     # POST /api/analyze
│       │   ├── incidents.ts   # GET /api/incidents, GET /api/incidents/:id, POST /api/incidents/:id/resolve
│       │   └── health.ts      # GET /api/health
│       ├── parser/
│       │   └── index.ts       # CI log parser + secret redaction
│       ├── hindsight/
│       │   └── service.ts     # Hindsight RETAIN/RECALL/REFLECT wrapper
│       ├── reasoning/
│       │   └── index.ts       # AI reasoning engine
│       ├── middleware/
│       │   └── errorHandler.ts
│       └── config/
│           └── env.ts         # Environment variable loading
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/
│       ├── hooks/
│       ├── types/
│       └── lib/
├── sample-data/
├── tests/
├── .env.example
├── README.md
└── docker-compose.yml (optional, local dev only)
```

---

## 2. Shared Types (`shared/types/index.ts`)

All types are shared between backend and frontend via the `shared/` package.

```typescript
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
  rawLogExcerpt?: string; // redacted excerpt only
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
  source?: string; // Hindsight memory ID
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
```

---

## 3. Shared Schemas (`shared/schemas/index.ts`)

Zod schemas for request validation.

```typescript
import { z } from 'zod';

export const AnalyzeRequestSchema = z.object({
  logText: z.string().min(1, 'CI log text is required'),
  fileName: z.string().optional(),
});

export const OutcomeSubmissionSchema = z.object({
  incidentId: z.string().min(1, 'Incident ID is required'),
  status: z.enum(['proposed', 'failed', 'passed_unmerged', 'verified']),
  fixDescription: z.string().optional(),
  ciResult: z.enum(['passed', 'failed']).optional(),
  merged: z.boolean().optional(),
  prLink: z.string().url().optional().nullable(),
  notes: z.string().optional(),
});

// Verified status requires ciResult=passed AND merged=true
export function validateOutcomeStatus(data: OutcomeSubmission): string[] {
  const errors: string[] = [];
  if (data.status === 'verified' && (data.ciResult !== 'passed' || data.merged !== true)) {
    errors.push('Verified status requires CI passed AND change merged');
  }
  return errors;
}
```

---

## 4. API Contract

### GET /api/health
Returns `{ status: 'ok' }`.

### POST /api/analyze
Body: `AnalyzeRequest`
Response: `AnalyzeResponse`
- Parses CI log, redacts secrets
- Generates failure signature
- Calls Hindsight RECALL for similar incidents
- Calls AI reasoning with parsed failure + historical memories
- Returns parsed failure, historical incidents, AI analysis

### GET /api/incidents
Query params: none
Response: `{ incidents: HistoricalInvestigation[] }`
- Lists all recorded incidents

### GET /api/incidents/:id
Response: `IncidentDetailResponse`
- Returns full incident detail including AI analysis

### POST /api/incidents/:id/resolve
Body: `OutcomeSubmission`
Response: `{ success: true, status: IncidentStatus }`
- Validates outcome (verified requires ciResult=passed AND merged=true)
- Stores outcome in Hindsight via RETAIN
- Returns stored status

---

## 5. Module Interfaces

### Parser Interface (`backend/src/parser/index.ts`)
```typescript
export interface ParserResult extends ParsedFailure {}
export function parseCILog(logText: string, fileName?: string): ParserResult;
export function redactSecrets(text: string): string;
```

### Hindsight Service Interface (`backend/src/hindsight/service.ts`)
```typescript
export interface HindsightService {
  recallSimilar(failureSignature: string, tags?: string[]): Promise<HistoricalInvestigation[]>;
  retainInvestigation(incidentId: string, data: InvestigationData): Promise<void>;
}
```

### AI Reasoning Interface (`backend/src/reasoning/index.ts`)
```typescript
export interface ReasoningInput {
  parsedFailure: ParsedFailure;
  historicalInvestigations: HistoricalInvestigation[];
}
export function analyzeFailure(input: ReasoningInput): Promise<AIAnalysis>;
```

---

## 6. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HINDSIGHT_API_KEY` | Yes | Hindsight API key |
| `HINDSIGHT_BANK_ID` | Yes | Hindsight memory bank ID |
| `OPENROUTER_API_KEY` | At least one provider | Primary LLM provider key (OpenRouter) |
| `GEMINI_API_KEY` | At least one provider | First fallback LLM provider key (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` | At least one provider | Final fallback provider account ID (Cloudflare Workers AI) |
| `CLOUDFLARE_API_TOKEN` | At least one provider | Final fallback provider API token (Cloudflare Workers AI) |
| `OPENROUTER_MODEL` | No | OpenRouter model (default `openrouter/free`) |
| `GEMINI_MODEL` | No | Gemini model (default `gemini-1.5-flash`) |
| `CLOUDFLARE_MODEL` | No | Cloudflare model (default `@cf/google/gemma-4-26b-a4b-it`) |
| `PORT` | No | Backend port (default 3001) |
| `NODE_ENV` | No | Environment (default development) |
| `FRONTEND_URL` | No | Frontend URL for CORS |

Provider fallback order is code-defined in the registry: OpenRouter → Gemini → Cloudflare Workers AI.

---

## 7. Hindsight Memory Rules (Mandatory)

1. **RETAIN**: Store investigation outcome only after developer confirms result. Never retain an unverified AI hypothesis as a completed fix.
2. **RECALL**: Retrieve similar historical investigations using failure signature + tags before LLM reasoning.
3. **REFLECT**: Explicit, optional operation only. Normal analysis does not invoke REFLECT; it uses RECALL results plus the configured LLM provider.
4. **Status enforcement**: Backend enforces `verified` requires CI passed AND merged. Hindsight directives alone are insufficient.
5. **One bank**: Use a single Hindsight memory bank (`HINDSIGHT_BANK_ID`).
6. **Secret redaction**: Redact secrets before any Hindsight or LLM call.

---

## 8. Security Rules

- Secrets redacted before LLM and Hindsight calls
- API keys kept on backend only
- No credentials in frontend source
- No .env files committed
- Validate uploaded file type and size
- Validate all request bodies with Zod

---
