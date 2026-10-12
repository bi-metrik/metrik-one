import { headers } from 'next/headers';

/**
 * El origen público del inquilino que atiende la petición, para armar enlaces
 * que salen por correo (invitación de vinculación, solicitud del mostrador).
 *
 * Primero el slug que inyecta el middleware (`x-tenant-slug`): en la función
 * serverless el `host` y el `x-forwarded-host` NO traen el subdominio (ver
 * `src/middleware.ts`), y Valida solo acepta `https://<sub>.metrikone.co` como
 * base del enlace. Sin cabecera de inquilino (local, rutas fuera del middleware)
 * se cae al host de la petición, como antes.
 */
export async function origenDelTenant(): Promise<string> {
  const h = await headers();
  return origenDesdeCabeceras(
    (n) => h.get(n),
    (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim(),
  );
}

export function origenDesdeCabeceras(
  get: (nombre: string) => string | null,
  baseDomain: string,
): string {
  const slug = (get('x-tenant-slug') ?? '').trim().toLowerCase();
  if (slug && /^[a-z0-9-]+$/.test(slug) && !baseDomain.startsWith('localhost')) {
    return `https://${slug}.${baseDomain}`;
  }
  const host = get('x-forwarded-host') ?? get('host') ?? '';
  const proto = get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
