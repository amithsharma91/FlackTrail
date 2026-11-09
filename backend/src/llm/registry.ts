/**
 * Provider registry for FlakeTrail's unified LLM architecture.
 *
 * Maps provider names to their shared default instances and exposes lookup
 * helpers used by the orchestrator and callers.
 */

import {
  OpenRouterProvider,
  openRouterProvider,
} from './providers/openrouter';
import { GeminiProvider, geminiProvider } from './providers/gemini';
import {
  CloudflareProvider,
  cloudflareProvider,
} from './providers/cloudflare';
import type { LLMProvider } from './types';

/**
 * Explicit provider order. The first entry is the current primary provider;
 * the remaining entries are the configured fallback order used by the
 * orchestrator.
 */
const PROVIDER_ORDER = ['openrouter', 'gemini', 'cloudflare'] as const;

const providers: Record<string, LLMProvider> = {
  openrouter: openRouterProvider,
  gemini: geminiProvider,
  cloudflare: cloudflareProvider,
};

/**
 * Look up a provider instance by name. Returns undefined when unknown.
 */
export function getProvider(name: string): LLMProvider | undefined {
  return providers[name];
}

/**
 * Return the names of every registered provider in fallback order.
 */
export function getAvailableProviders(): string[] {
  return [...PROVIDER_ORDER];
}

/**
 * Return the configured provider order: primary first, then fallbacks.
 */
export function getProviderOrder(): string[] {
  return [...PROVIDER_ORDER];
}

/**
 * Return the default (primary) provider instance (OpenRouter).
 */
export function getDefaultProvider(): LLMProvider {
  return providers[PROVIDER_ORDER[0]];
}

/**
 * Re-export provider classes and default instances for consumers that want
 * to construct custom instances or reference them directly.
 */
export {
  OpenRouterProvider,
  GeminiProvider,
  CloudflareProvider,
  openRouterProvider,
  geminiProvider,
  cloudflareProvider,
};
