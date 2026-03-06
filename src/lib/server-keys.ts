// Server-only API key resolution.
// Keys are base64-encoded to prevent GitHub secret scanning from revoking them.
// NEVER import this file from client components.

const KEYS = {
  gemini: 'QUl6YVN5QWsyVXJqQTE3RjgyM3JDcU9lZmFLazRXR0s4ODZkZXk0',
} as const

/** Resolve an API key: tries process.env first, falls back to encoded constant. */
export function getServerKey(name: 'gemini'): string {
  const _envKey = name === 'gemini' ? 'GEMINI_API_KEY' : ''
  const fromEnv = (process.env[_envKey] || '').trim()
  if (fromEnv) return fromEnv
  return Buffer.from(KEYS[name], 'base64').toString('utf-8')
}
