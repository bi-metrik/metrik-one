// Base domain — dev: localhost, prod: metrikone.co
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'
const IS_DEV = process.env.NODE_ENV === 'development'

// Reserved slugs that are NOT tenants
export const RESERVED_SLUGS = ['www', 'api', 'admin', 'app', 'test', 'demo', 'staging', 'mail', 'ftp']

/**
 * Extract tenant slug from the request Host header.
 * Production: ana.metrikone.co → "ana"
 * Development: ana.localhost:3000 → "ana"
 * Returns null on the bare domain, reserved subdomains, or a malformed host.
 *
 * Shared por el middleware (routing) y por vistas publicas que necesitan
 * resolver el workspace sin sesion (ej. /login del subdominio).
 */
export function extractSlug(hostname: string): string | null {
  const hostWithoutPort = hostname.split(':')[0]
  const baseDomainWithoutPort = BASE_DOMAIN.split(':')[0]

  if (IS_DEV) {
    if (hostWithoutPort !== baseDomainWithoutPort && hostWithoutPort.endsWith(`.${baseDomainWithoutPort}`)) {
      const slug = hostWithoutPort.replace(`.${baseDomainWithoutPort}`, '')
      if (slug && !RESERVED_SLUGS.includes(slug)) return slug
    }
  } else {
    if (hostname.endsWith(BASE_DOMAIN) && hostname !== BASE_DOMAIN) {
      const slug = hostname.replace(`.${BASE_DOMAIN}`, '')
      if (slug && !RESERVED_SLUGS.includes(slug)) return slug
    }
  }

  return null
}
