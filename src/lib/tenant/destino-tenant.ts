// Base domain — dev: localhost, prod: metrikone.co.
// .trim() por la misma razon que en extract-slug.ts: la env var ya llego una vez
// con un salto de linea pegado y rompio el `endsWith` para TODOS los tenants.
const BASE_DOMAIN_ENV = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000').trim()
const IS_DEV_ENV = process.env.NODE_ENV === 'development'

export interface OpcionesDestino {
  /** Inyectable para pruebas. Por defecto, NEXT_PUBLIC_BASE_DOMAIN. */
  baseDomain?: string
  /** Inyectable para pruebas. Por defecto, NODE_ENV === 'development'. */
  isDev?: boolean
}

/**
 * ¿El host por el que entro la peticion cuelga del dominio base del producto?
 *
 * `metrikone.co` -> si · `soena.metrikone.co` -> si
 * `metrik-one-git-rama-metrik-one.vercel.app` -> NO
 */
export function hostEsDelDominioBase(
  host: string | null | undefined,
  baseDomain: string = BASE_DOMAIN_ENV,
): boolean {
  if (!host) return false
  const h = host.trim().toLowerCase()
  const b = baseDomain.trim().toLowerCase()
  if (!b) return false
  return h === b || h.endsWith(`.${b}`)
}

/**
 * A donde mandar al usuario cuando ya sabemos su workspace (tras autenticar, o al
 * pisar `/` o `/login` con sesion viva).
 *
 * En produccion cada workspace vive en su subdominio, asi que el destino se arma con
 * el slug: `https://soena.metrikone.co/numeros`.
 *
 * ⚠️ Un deployment de PREVIEW se sirve desde `*.vercel.app`, un host que NO cuelga de
 * BASE_DOMAIN. Ahi el subdominio del tenant sencillamente no existe, y armar el
 * destino con el slug saca al revisor del preview: a produccion si la variable esta
 * puesta, y a un host MUERTO (`https://soena.localhost:3000`) si no lo esta — que es
 * lo que pasaba, porque el scope Preview no tenia NEXT_PUBLIC_BASE_DOMAIN. En los dos
 * casos el QA visual del PR quedaba imposible justo despues de iniciar sesion.
 *
 * Regla: si el host de la peticion no pertenece al dominio base, el destino se queda
 * en el MISMO host. Es seguro porque el workspace NO se resuelve por el subdominio
 * sino por `profiles.workspace_id` (lo hace `getWorkspace`); lo unico que un preview
 * pierde es el routing por subdominio, que en ese host no puede existir de todos
 * modos. Y no depende de como este configurada la env var: con o sin ella, un host
 * `*.vercel.app` nunca cuelga del dominio base.
 *
 * Devuelve una ruta RELATIVA (empieza por '/') cuando hay que quedarse en el host
 * actual, o una URL ABSOLUTA al subdominio del tenant. Quien llama resuelve la
 * relativa contra el host por el que entro la peticion.
 */
export function destinoTrasAutenticar(
  slug: string,
  path: string,
  requestHost: string | null | undefined,
  opciones: OpcionesDestino = {},
): string {
  const baseDomain = (opciones.baseDomain ?? BASE_DOMAIN_ENV).trim()
  const isDev = opciones.isDev ?? IS_DEV_ENV

  // En local todo vive en el mismo host; el subdominio no se usa.
  if (isDev) return path
  // Preview u otro host ajeno al dominio base: no hay subdominio al que ir.
  if (!hostEsDelDominioBase(requestHost, baseDomain)) return path

  return `https://${slug}.${baseDomain}${path}`
}

/** ¿El destino que devolvio `destinoTrasAutenticar` hay que resolverlo contra el host actual? */
export function esRelativo(destino: string): boolean {
  return destino.startsWith('/')
}
