/**
 * Strict Free Mode configuration for FlakeTrail's LLM provider infrastructure.
 *
 * When STRICT_FREE_MODE=true, only explicitly enabled and verified zero-cost
 * providers may receive requests. Providers that are disabled, not verified
 * as free, or missing API credentials are skipped with a log message.
 *
 * Providers requiring billing or payment methods (Mistral, SambaNova) must
 * default to disabled and never enter the fallback chain unless explicitly
 * enabled by the user after independent zero-cost confirmation.
 */

export interface ProviderFreeStatus {
  /** Whether the provider is eligible to be enabled (has a published free tier). */
  eligible: boolean;
  /** Whether the provider is explicitly enabled via env var. */
  enabled: boolean;
  /** Whether the provider is verified as zero-cost (published free tier). */
  verifiedFree: boolean;
  /** Whether the provider has API credentials configured. */
  hasCredentials: boolean;
  /** Whether the provider is allowed to receive requests. */
  allowed: boolean;
  /** Human-readable reason if the provider cannot be used. */
  skipReason?: string;
}

const STRICT_FREE_MODE = process.env.STRICT_FREE_MODE === 'true';

/**
 * Known zero-cost provider status. This is deployment-time knowledge, not
 * a runtime check against provider APIs. The actual credential check happens
 * at request time.
 *
 * Mistral: Published Free mode does not include API access; requires billing.
 * SambaNova: Free plan requires payment method + credit purchase.
 * Groq, NVIDIA NIM, Z.AI: Have free developer tiers (must still verify quota).
 */
const KNOWN_FREE_STATUS: Record<string, ProviderFreeStatus> = {
  openrouter: { eligible: true, enabled: false, verifiedFree: true, hasCredentials: false, allowed: false },
  gemini: { eligible: true, enabled: true, verifiedFree: true, hasCredentials: false, allowed: false },
  cloudflare: { eligible: true, enabled: false, verifiedFree: true, hasCredentials: false, allowed: false },
  groq: { eligible: true, enabled: false, verifiedFree: true, hasCredentials: false, allowed: false },
  nvidia: { eligible: true, enabled: false, verifiedFree: true, hasCredentials: false, allowed: false },
  zai: { eligible: true, enabled: false, verifiedFree: true, hasCredentials: false, allowed: false },
  mistral: { eligible: false, enabled: false, verifiedFree: false, hasCredentials: false, allowed: false },
  sambanova: { eligible: false, enabled: false, verifiedFree: false, hasCredentials: false, allowed: false },
};

/**
 * Resolve the API key env var name for a provider.
 */
function providerEnvKey(name: string): string {
  const map: Record<string, string> = {
    openrouter: 'OPENROUTER_API_KEY',
    gemini: 'GEMINI_API_KEY',
    cloudflare: 'CLOUDFLARE_API_TOKEN',
    groq: 'GROQ_API_KEY',
    nvidia: 'NVIDIA_API_KEY',
    zai: 'ZAI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    sambanova: 'SAMBANOVA_API_KEY',
  };
  return map[name] ?? `${name.toUpperCase()}_API_KEY`;
}

/**
 * Resolve the enabled flag env var name for a provider.
 */
function providerEnabledKey(name: string): string {
  return `${name.toUpperCase()}_ENABLED`;
}

/**
 * Determine the default enabled state for a provider.
 * Only Gemini defaults to enabled. OpenRouter, Cloudflare, Groq, NVIDIA,
 * Z.AI, Mistral, and SambaNova default to disabled until verified free.
 */
function defaultEnabled(name: string): boolean {
  const known = KNOWN_FREE_STATUS[name];
  if (!known) return false;
  return known.enabled;
}

/**
 * Get the free-mode status for a provider, including whether it has credentials
 * and whether it is allowed to receive requests.
 */
export function getProviderFreeStatus(name: string): ProviderFreeStatus {
  const known = KNOWN_FREE_STATUS[name];
  if (!known) {
    return {
      eligible: false,
      enabled: false,
      verifiedFree: false,
      hasCredentials: false,
      allowed: false,
      skipReason: `Unknown provider "${name}"`,
    };
  }

  const hasCredentials = Boolean(process.env[providerEnvKey(name)]);

  // Determine enabled state: explicit env var override, then default.
  const envEnabled = process.env[providerEnabledKey(name)];
  const enabled =
    envEnabled !== undefined ? envEnabled === 'true' : known.enabled;

  // Allowed = eligible AND enabled AND verifiedFree AND hasCredentials
  const allowed =
    known.eligible && enabled && known.verifiedFree && hasCredentials;

  const status: ProviderFreeStatus = {
    ...known,
    enabled,
    hasCredentials,
    allowed,
  };

  if (!known.eligible) {
    status.skipReason = `Provider "${name}" is not eligible (no published free tier)`;
  } else if (!enabled) {
    status.skipReason = `Provider "${name}" is disabled via ${providerEnabledKey(name)}=false`;
  } else if (!known.verifiedFree) {
    status.skipReason = `Provider "${name}" is not verified as zero-cost`;
  } else if (!hasCredentials) {
    status.skipReason = `Provider "${name}" has no API credentials configured`;
  }

  return status;
}

/**
 * Check whether a provider is allowed to receive requests under strict free mode.
 *
 * Returns true only when the provider is eligible, enabled, verified free,
 * and has credentials configured.
 */
export function canUseProvider(name: string): boolean {
  const status = getProviderFreeStatus(name);
  return status.allowed;
}

/**
 * Log a skip message when a provider cannot be used.
 * Uses console.warn so it's visible in server logs but never includes secrets.
 */
export function logProviderSkip(name: string): void {
  const status = getProviderFreeStatus(name);
  if (status.skipReason) {
    console.warn(`[llm] Skipping provider "${name}": ${status.skipReason}`);
  }
}

/**
 * Return the ordered list of providers that are allowed to receive requests,
 * filtered by strict free mode and credential availability.
 */
export function getEnabledProviders(): string[] {
  return Object.keys(KNOWN_FREE_STATUS).filter((name) => canUseProvider(name));
}

/**
 * Check whether strict free mode is active.
 */
export function isStrictFreeMode(): boolean {
  return STRICT_FREE_MODE;
}
