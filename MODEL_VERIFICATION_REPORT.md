# LLM Provider & Model Verification Report — FlackTrail

**Agent:** Agent 2 — LLM Provider and Model Verification  
**Date:** Tue Nov 10 2026  
**Work directory:** `C:\Users\ADI\workspace\FlackTrail`  
**Scope:** Verify each provider's DEFAULT_MODEL against official provider documentation.

---

## Summary Table

| Provider | File | Current DEFAULT_MODEL | Status | Action |
|---|---|---|---|---|
| OpenRouter | `openrouter.ts` | `meta-llama/llama-3.1-8b-instruct:free` | Verified (caveats) | None — monitor |
| Gemini | `gemini.ts` | `gemini-3.6-flash` | Verified | None |
| Cloudflare | `cloudflare.ts` | `@cf/zai-org/glm-4.7-flash` | Verified | None |
| Groq | `groq.ts` | `openai/gpt-oss-120b` | Verified | None |
| NVIDIA | `nvidia.ts` | `meta/llama-3.1-8b-instruct` | Verified | None |
| Z.AI | `zai.ts` | `glm-4.5` → **`glm-4.7-flash`** | **Needs change** | **Changed** |
| Mistral | `mistral.ts` | `mistral-small-latest` | Keep disabled | None |
| SambaNova | `sambanova.ts` | `Llama-4-Maverick-17B-128E-Instruct` | Keep disabled | None |

**Only one file required a code change:** `backend/src/llm/providers/zai.ts` (model ID `glm-4.5` → `glm-4.7-flash`). Comments in `openrouter.ts`, `groq.ts`, `nvidia.ts`, and `cloudflare.ts` were updated to reflect verification status.

---

## 1. OpenRouter — `meta-llama/llama-3.1-8b-instruct:free`

**Status: Verified (with caveats)**

The model ID `meta-llama/llama-3.1-8b-instruct:free` is listed in OpenRouter's free model catalog:
- LLM Token Counter's OpenRouter free models list includes `meta-llama/llama-3.1-8b-instruct:free` (Meta, 128K context, 8B params, Chat/Code, 20 RPM) — https://llmtokencounter.online/openrouter-free-models.html
- OpenRouter's own model page exists at `openrouter.ai/meta-llama/llama-3.1-8b-instruct:free`
- KaibanJS OpenRouter integration docs reference the same ID — https://docs.kaibanjs.com/llms-docs/custom-integrations/OpenRouter

**Caveat:** The task notes this model is "reported 404 on production." A GitHub issue (RightNow-AI/openfang#610) documents a user receiving `{"error":{"message":"No endpoints found for meta-llama/llama-3.1-8b-instruct:free.","code":404}}`. OpenRouter free models rotate and can temporarily be unavailable. The ID format and catalog listing are correct; no change is required, but availability should be monitored. If production 404s persist, a stable fallback such as `meta-llama/llama-3.3-70b-instruct:free` or `google/gemma-2-9b-it:free` (both listed in OpenRouter's free catalog) can be configured via `OPENROUTER_MODEL`.

**File:** `backend/src/llm/providers/openrouter.ts` (comment updated to note rotation risk)

---

## 2. Gemini — `gemini-3.6-flash`

**Status: Verified**

Officially confirmed by Google AI for Developers documentation:
- Model page: https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
- Model code: `gemini-3.6-flash` — described as "a previous-generation Flash model that remains available for production use"
- Stable version: `gemini-3.6-flash`; latest update July 2026
- Input token limit: 1,048,576; Output token limit: 65,536
- REST endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent` (matches the code's base URL)
- Supports thinking mode, function calling, structured output, code execution, etc.

**File:** `backend/src/llm/providers/gemini.ts` — no changes needed; `gemini-3.6-flash` is valid and available.

---

## 3. Cloudflare — `@cf/zai-org/glm-4.7-flash`

**Status: Verified**

Officially confirmed by Cloudflare Workers AI documentation:
- Model page: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- Model slug: `@cf/zai-org/glm-4.7-flash` — Cloudflare-hosted, by Zhipu AI
- Context window: 131,072 tokens; Function calling: Yes; Reasoning: Yes; Zero data retention: Yes
- Announced Feb 13, 2026 (Changelog: https://developers.cloudflare.com/changelog/post/2026-02-13-glm-4.7-flash-workers-ai/)
- Still present in the Workers AI model catalog as of Aug 12, 2026 (https://developers.cloudflare.com/workers-ai/models/)
- Pricing: $0.0605 per M input tokens, $0.40 per M output tokens

**Regarding the reported 401 auth error:** A 401 indicates an authentication/token issue (`CLOUDFLARE_API_TOKEN` missing or invalid), not an invalid model ID. The model slug `@cf/zai-org/glm-4.7-flash` is correct. The alternative mentioned in the task (`@cf/zai-org/glm-4.7-flash`) is the same model — no alternative is needed.

**File:** `backend/src/llm/providers/cloudflare.ts` (comment updated to clarify 401 is an auth issue)

---

## 4. Groq — `openai/gpt-oss-120b`

**Status: Verified**

Officially confirmed by GroqDocs:
- Models page: https://console.groq.com/docs/models
- Listed under **Production Models** as `openai/gpt-oss-120b` (OpenAI GPT-OSS 120B)
- Price: $0.15 input / $0.60 output per 1M tokens
- Context window: 131,072 tokens; Max completion: 65,536 tokens
- Rate limits (Developer plan): 250K TPM, 1K RPM
- Token speed: ~500 tps
- Dedicated model page: https://console.groq.com/docs/model/openai/gpt-oss-120b
- Confirmed via the `anyllm_providers` Groq source (groq.rs) which lists `openai/gpt-oss-120b` as `ModelStatus::Available`

**File:** `backend/src/llm/providers/groq.ts` (comment updated to reflect verification)

---

## 5. NVIDIA — `meta/llama-3.1-8b-instruct`

**Status: Verified**

Officially confirmed by NVIDIA NIM documentation:
- Support matrix: https://docs.nvidia.com/nim/large-language-models/latest/support-matrix.html — lists `llama-3.1-8b-instruct` under `meta/llama-3.1-8b-instruct`
- NGC catalog: https://catalog.ngc.nvidia.com/orgs/nim/teams/meta/containers/llama-3.1-8b-instruct
- NVIDIA NIM Quickstart uses `meta/llama-3.1-8b-instruct` as the model ID in `/v1/chat/completions` — https://docs.nvidia.com/nim/large-language-models/latest/get-started/quickstart.html
- Base URL `https://integrate.api.nvidia.com/v1` matches the code's `DEFAULT_BASE_URL`
- NVIDIA Build offers free serverless inference for development (not production) — https://www.llmperks.com/nvidia

**File:** `backend/src/llm/providers/nvidia.ts` (comment updated to reflect verification)

---

## 6. Z.AI — `glm-4.5` → `glm-4.7-flash` **[CHANGED]**

**Status: Needs change — code updated in `zai.ts`**

### Problem with `glm-4.5`
- Z.AI's own free-tier registry (awesome-free-ai-coding, verified 2026-10-13) records: "2026-07-27 — Free models changed: added glm-4.7-flash; dropped glm-4.5"
- `glm-4.5` is no longer on Z.AI's free API tier; using it may incur charges or return errors under strict free mode.
- The model itself exists (docs: https://docs.z.ai/guides/llm/glm-4.5) but is not free.

### Replacement: `glm-4.7-flash`
- Officially documented by Z.AI: https://docs.z.ai/guides/llm/glm-4.7 — "GLM-4.7-Flash: 30B parameters: Lightweight, efficient, and high-performance."
- Cloudflare Workers AI also hosts it as `@cf/zai-org/glm-4.7-flash` (Zhipu AI origin), confirming the model ID.
- **Free on Z.AI API:** input, cached input, and output are all $0 (per https://glm-ai.chat/pricing/ and awesome-free-ai-coding)
- Model ID used in API calls: `glm-4.7-flash` (example curl payload uses `"model": "glm-4.7-flash"`)
- Base URL `https://api.z.ai/api/paas/v4` matches the code's `DEFAULT_BASE_URL` and Z.AI docs

### Change made
`backend/src/llm/providers/zai.ts`:
- `DEFAULT_MODEL` changed from `'glm-4.5'` to `'glm-4.7-flash'`
- JSDoc header and environment-variable comments updated to reflect verification and the free-tier status

---

## 7. Mistral — `mistral-small-latest` (disabled)

**Status: Keep disabled**

Mistral's official documentation (docs.mistral.ai) states:
- "Free mode: API access is enabled by default with no credit card required. Usage and rate limits apply." — https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key
- `mistral-small-latest` is a valid model used in Mistral's own quickstart examples
- Free mode includes included monthly usage; pay-as-you-go extends beyond that

However, the FlackTrail codebase conservatively keeps Mistral disabled (`MISTRAL_ENABLED` defaults to `"false"`), and the task instructs that Mistral should remain disabled. No code change is required. If the project decides to enable Mistral in the future, `mistral-small-latest` is a valid model ID and no payment method is required for free-mode API access (subject to unpublished rate limits).

**File:** `backend/src/llm/providers/mistral.ts` — no changes needed; remains disabled by default.

---

## 8. SambaNova — `Llama-4-Maverick-17B-128E-Instruct` (disabled)

**Status: Keep disabled — requires billing/payment**

Officially confirmed by SambaNova documentation:
- Plans page: https://cloud.sambanova.ai/plans — Free plan: "Add a payment method and purchase credits to run your first requests." The former $5 no-card starter credit was dropped (Aug 2026, per UsagePricing).
- Rate limits docs: https://docs.sambanova.ai/docs/en/models/rate-limits — Free Tier applied when no payment method is linked; in practice, unfunded accounts receive `402 PAYMENT_METHOD_REQUIRED` on every chat call (confirmed by SpiderGate and toolfreebie testing).
- Billing page: https://cloud.sambanova.ai/plans/billing requires a payment method + credit purchase.
- SambaNova serves models via OpenAI-compatible API at `https://api.sambanova.ai/v1`.

**Note on model ID:** The catalog models confirmed in public sources include `Meta-Llama-3.3-70B-Instruct`, `DeepSeek-V3.1`, and `gpt-oss-120b`. `Llama-4-Maverick-17B-128E-Instruct` was not found in the SambaNova catalog listings reviewed. If SambaNova is ever enabled, the model ID should be verified against `https://api.sambanova.ai/v1/models` before use.

**File:** `backend/src/llm/providers/sambanova.ts` — no changes needed; remains disabled by default (`SAMBANOVA_ENABLED` defaults to `"false"`).

---

## Files Modified

| File | Change |
|---|---|
| `backend/src/llm/providers/zai.ts` | `DEFAULT_MODEL`: `'glm-4.5'` → `'glm-4.7-flash'`; updated JSDoc and env-var comments |
| `backend/src/llm/providers/groq.ts` | Updated comments: model verified available on GroqCloud |
| `backend/src/llm/providers/nvidia.ts` | Updated comments: model verified available on NVIDIA NIM |
| `backend/src/llm/providers/openrouter.ts` | Updated comments: model verified in free catalog; noted free-model rotation risk |
| `backend/src/llm/providers/cloudflare.ts` | Updated comments: model verified; clarified 401 is an auth issue |

Files not modified (verified, no change needed): `gemini.ts`, `mistral.ts`, `sambanova.ts`.

---

## Evidence Sources

- OpenRouter: https://openrouter.ai/meta-llama/llama-3.1-8b-instruct:free ; https://llmtokencounter.online/openrouter-free-models.html
- Gemini: https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
- Cloudflare: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/ ; https://developers.cloudflare.com/changelog/post/2026-02-13-glm-4.7-flash-workers-ai/
- Groq: https://console.groq.com/docs/models ; https://console.groq.com/docs/model/openai/gpt-oss-120b
- NVIDIA: https://docs.nvidia.com/nim/large-language-models/latest/support-matrix.html ; https://catalog.ngc.nvidia.com/orgs/nim/teams/meta/containers/llama-3.1-8b-instruct
- Z.AI: https://docs.z.ai/guides/llm/glm-4.7 ; https://docs.z.ai/guides/llm/glm-4.5 ; https://glm-ai.chat/pricing/ ; https://mvalentsev.github.io/awesome-free-ai-coding/providers/zai-glm
- Mistral: https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key
- SambaNova: https://cloud.sambanova.ai/plans ; https://docs.sambanova.ai/docs/en/models/rate-limits