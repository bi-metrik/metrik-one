// Server-only API key resolution.
// Keys are base64-encoded to prevent GitHub secret scanning from revoking them.
// NEVER import this file from client components.

/** Resolve an API key from environment variables. */
export function getServerKey(name: 'gemini'): string {
  const envKey = name === 'gemini' ? 'GEMINI_API_KEY' : ''
  return (process.env[envKey] || '').trim()
}
