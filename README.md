# FlakeTrail

FlakeTrail is an AI-powered debugging assistant that remembers previous CI failures, investigation attempts, and their outcomes.

When developers encounter similar CI failures, FlakeTrail retrieves relevant historical investigations and helps them investigate faster.

**Core differentiator: Persistent Investigation Memory.**

FlakeTrail is not simply a chatbot, log analyzer, or generic AI debugging assistant. Its central value is remembering:
- What failed.
- What developers investigated.
- Which approaches did not work.
- Which approaches passed CI.
- Which solutions were eventually verified.

Built with **Hindsight** as the persistent memory engine.

## Project Structure

```
flaketrail/
├── docs/phase-0/          # Phase 0 planning documents
├── shared/                # Shared types and schemas
├── backend/               # Node.js + Express API
├── frontend/              # React + Vite + Tailwind
├── sample-data/           # Demo data for hackathon
├── tests/                 # Test files
├── .env.example           # Environment variables template
├── ARCHITECTURE.md        # Architecture contract
└── README.md              # This file
```

## Getting Started

### Prerequisites

- Node.js v18 or higher
- npm or yarn

### Installation

```bash
# Install shared dependencies
cd shared && npm install

# Install backend dependencies
cd ../backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### Environment Setup

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `HINDSIGHT_API_KEY` | Hindsight API key (from https://hindsight.vectorize.io/) |
| `HINDSIGHT_BANK_ID` | Hindsight memory bank ID |
| `LLM_API_KEY` | LLM provider API key (e.g., OpenAI) |
| `LLM_PROVIDER` | LLM provider (e.g., `openai`) |
| `LLM_MODEL` | LLM model (e.g., `gpt-4o-mini`) |

### Running Locally

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```
Server runs on http://localhost:3001

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```
App runs on http://localhost:5173

## MVP Features

1. **Upload or paste CI failure logs** - Submit CI logs for analysis
2. **Extract useful error information** - Automatic extraction of test name, error message, stack trace
3. **Retrieve similar historical failures** - Hindsight memory search for past investigations
4. **AI-powered analysis** - LLM analyzes current failure + historical memory
5. **Debugging recommendations** - Actionable next steps based on verified fixes
6. **Record investigation outcomes** - Mark fixes as failed, passed_unmerged, or verified
7. **Save confirmed outcomes to Hindsight** - Persistent memory for future failures

## Hindsight Memory Rules

- **RETAIN**: Store investigation outcome only after developer confirms result
- **RECALL**: Retrieve similar historical investigations using failure signature
- **REFLECT**: Reason over retrieved memories to produce AI analysis
- Only `verified` records (CI passed AND change merged) count as confirmed fixes
- Secrets are redacted before any Hindsight or LLM call

## Testing

```bash
cd tests
npm install
npx vitest run
```

## Deployment

Frontend: Vercel
Backend: Render or similar

See `.env.example` for required production environment variables.

## License

MIT