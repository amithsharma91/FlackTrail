/**
 * Provider registry for FlakeTrail's unified LLM architecture.
 *
 * Maps provider names to their shared default instances and exposes lookup
 * helpers used by the orchestrator and callers.
 *
 * Provider fallback order (strict free mode):
 *   1. Gemini (primary)
 *   2. OpenRouter
 *   3. Groq
 *   4. NVIDIA NIM
 *   5. Z.AI
 *   6. Cloudflare
 *
 * Mistral and SambaNova are disabled by default and do not enter the
 * fallback chain unless explicitly enabled after confirming zero-cost API access.
 */

import {
  CloudflareProvider,
  cloudflareProvider,
} from './providers/cloudflare';
import { GeminiProvider, geminiProvider } from './providers/gemini';
import { GroqProvider, groqProvider } from './providers/groq';
import { MistralProvider, mistralProvider } from './providers/mistral';
import {
  NVIDIAProvider,
  nvidiaProvider,
} from './providers/nvidia';
import {
  OpenRouterProvider,
  openRouterProvider,
} from './providers/openrouter';
import {
  SambaNovaProvider,
  sambanovaProvider,
} from './providers/sambanova';
import {
  ZAIProvider,
  zaiProvider,
} from './providers/zai';
import type { LLMProvider } from './types';
import { getProviderFreeStatus, logProviderSkip } from './freeMode';

/**
 * Explicit provider order. The first entry is the current primary provider;
 * the remaining entries are the configured fallback order used by the
 * orchestrator. Mistral and SambaNova are intentionally excluded.
 */
const PROVIDER_ORDER = [
  'gemini',
  'openrouter',
  'groq',
  'nvidia',
  'zai',
  'cloudflare',
] as const;

/**
 * All known provider instances, including disabled ones. Disabled providers
 * are instantiated but will throw from chat() if called.
 */
const allProviders: Record<string, LLMProvider> = {
  openrouter: openRouterProvider,
  gemini: geminiProvider,
  groq: groqProvider,
  nvidia: nvidiaProvider,
  zai: zaiProvider,
  cloudflare: cloudflareProvider,
  mistral: mistralProvider,
  sambanova: sambanovaProvider,
};

/**
 * Providers that are enabled under strict free mode (have credentials and
 * are not explicitly disabled). Computed once at module load.
 */
const enabledProviders: Record<string, LLMProvider> = {};

for (const name of PROVIDER_ORDER) {
  const status = getProviderFreeStatus(name);
  if (status.allowed) {
    enabledProviders[name] = allProviders[name];
  } else {
    logProviderSkip(name);
  }
}

/**
 * Look up an enabled provider instance by name. Returns undefined when
 * unknown or disabled.
 */
export function getProvider(name: string): LLMProvider | undefined {
  return enabledProviders[name];
}

/**
 * Return the names of every enabled provider in fallback order.
 */
export function getAvailableProviders(): string[] {
  return PROVIDER_ORDER.filter((name) => Boolean(enabledProviders[name]));
}

/**
 * Return the configured provider order: primary first, then fallbacks.
 * Only includes enabled providers.
 */
export function getProviderOrder(): string[] {
  return PROVIDER_ORDER.filter((name) => Boolean(enabledProviders[name]));
}

/**
 * Return the default (primary) provider instance (OpenRouter).
 * Throws if no providers are enabled.
 */
export function getDefaultProvider(): LLMProvider {
  const order = getProviderOrder();
  if (order.length === 0) {
    throw new Error(
      'No LLM providers are enabled. Configure at least one provider API key.'
    );
  }
  return enabledProviders[order[0]];
}

/**
 * Re-export provider classes and default instances for consumers that want
 * to construct custom instances or reference them directly.
 */
export {
  OpenRouterProvider,
  GeminiProvider,
  CloudflareProvider,
  GroqProvider,
  NVIDIAProvider,
  ZAIProvider,
  MistralProvider,
  SambaNovaProvider,
  openRouterProvider,
  geminiProvider,
  cloudflareProvider,
  groqProvider,
  nvidiaProvider,
  zaiProvider,
  mistralProvider,
  sambanovaProvider,
};
