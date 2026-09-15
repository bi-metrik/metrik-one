// ============================================================
// Dónde guarda un workspace los archivos de sus negocios.
//
//   workspaces.config_extra.storage_provider      'drive' (default si falta) | 'supabase_externo'
//   workspaces.config_extra.storage_supabase_url  URL del proyecto externo (no es secreto)
//   env WS_STORAGE_SECRET_<SLUG_EN_MAYUSCULAS>    llave secreta del proyecto externo
//
// ⚠️ La llave NUNCA va en `config_extra`: `authenticated` tiene SELECT sobre esa
// columna (policy `ws_select`), así que cualquier usuario del workspace la leería.
//
// ⚠️ Fail-closed. Un valor de `storage_provider` que no se reconoce (una errata como
// "supabase-externo") NO cae a Drive: bloquea Drive y hace fallar la subida con un
// error que dice qué falta. Caer a Drive en silencio mandaría pasaportes de terceros
// a la infraestructura de MeTRIK, que es exactamente lo que esta config existe para
// evitar.
//
// Módulo PURO: sin red, sin base, sin `process.env` directo (el entorno entra por
// parámetro). Lo prueban `config.test.ts`.
// ============================================================

export type ProveedorAlmacenamiento = 'drive' | 'supabase_externo'

export type ConfigAlmacenamiento =
  | { proveedor: 'drive' }
  | { proveedor: 'supabase_externo'; slug: string; url: string; llave: string }

/** Error de configuración de almacenamiento. Su mensaje nunca contiene la llave. */
export class ErrorAlmacenamiento extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorAlmacenamiento'
  }
}

/** Nombre de la variable de entorno con la llave del proyecto externo de un workspace. */
export function nombreVariableLlave(slug: string): string {
  return `WS_STORAGE_SECRET_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/**
 * ¿Este valor de `storage_provider` saca al workspace de Drive?
 * Ausente, vacío o `'drive'` → no. Cualquier otra cosa → sí (fail-closed).
 */
export function esValorProveedorExterno(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false
  if (typeof valor !== 'string') return true
  const v = valor.trim()
  return v !== '' && v !== 'drive'
}

/** ¿El workspace guarda sus archivos fuera de Drive? Solo mira la marca, no valida URL ni llave. */
export function esAlmacenamientoExterno(configExtra: unknown): boolean {
  if (!configExtra || typeof configExtra !== 'object') return false
  return esValorProveedorExterno((configExtra as Record<string, unknown>).storage_provider)
}

/**
 * Resuelve la configuración completa. Lanza `ErrorAlmacenamiento` con un mensaje
 * accionable cuando el workspace declara `supabase_externo` y falta algo.
 */
export function leerConfigAlmacenamiento(entrada: {
  slug: string | null | undefined
  configExtra: unknown
  env: Record<string, string | undefined>
}): ConfigAlmacenamiento {
  const cfg = (entrada.configExtra && typeof entrada.configExtra === 'object'
    ? entrada.configExtra
    : {}) as Record<string, unknown>

  if (!esValorProveedorExterno(cfg.storage_provider)) return { proveedor: 'drive' }

  const slug = (entrada.slug ?? '').trim()
  const etiqueta = slug || '(sin slug)'
  const valor = typeof cfg.storage_provider === 'string' ? cfg.storage_provider.trim() : String(cfg.storage_provider)

  if (valor !== 'supabase_externo') {
    throw new ErrorAlmacenamiento(
      `Workspace ${etiqueta}: storage_provider "${valor.slice(0, 40)}" no es un proveedor conocido ` +
        `(drive | supabase_externo). Los archivos no se guardan hasta corregirlo.`,
    )
  }
  if (!slug) {
    throw new ErrorAlmacenamiento('Workspace sin slug: no se puede resolver la llave del almacenamiento externo.')
  }

  const url = typeof cfg.storage_supabase_url === 'string' ? cfg.storage_supabase_url.trim().replace(/\/+$/, '') : ''
  if (!/^https:\/\/[^\s/]+$/.test(url)) {
    throw new ErrorAlmacenamiento(
      `Workspace ${slug}: storage_provider=supabase_externo pero falta config_extra.storage_supabase_url ` +
        `(https://<proyecto>.supabase.co).`,
    )
  }

  const variable = nombreVariableLlave(slug)
  const llave = (entrada.env[variable] ?? '').trim()
  if (!llave) {
    throw new ErrorAlmacenamiento(
      `Workspace ${slug}: storage_provider=supabase_externo pero falta la variable de entorno ${variable}. ` +
        `Los archivos NO se guardan en Drive como alternativa.`,
    )
  }

  return { proveedor: 'supabase_externo', slug, url, llave }
}
