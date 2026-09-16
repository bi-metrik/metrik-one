/**
 * Reglas del módulo Valida API, puras. Las usan el servidor (que decide) y la pantalla (que
 * dibuja), y por eso viven en un solo archivo: una regla copiada en los dos lados se
 * desincroniza, y el síntoma es un botón que aparece y una acción que lo rechaza.
 *
 * El servidor es quien manda: la pantalla solo evita mostrar lo que igual se rechazaría.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Llave de `workspaces.modules` del módulo. Es la `clave` de `MODULOS.valida_api`. */
export const CLAVE_MODULO_VALIDA_API = 'valida_api'

/** ¿El workspace tiene encendido el módulo? Solo `true` lo enciende: un valor ausente no. */
export function moduloValidaApiActivo(modules: Record<string, unknown> | null | undefined): boolean {
  return modules?.[CLAVE_MODULO_VALIDA_API] === true
}

/**
 * El cliente de Valida del workspace, leído de `config_extra.valida_cliente_id`.
 *
 * Es la ÚNICA fuente del `cliente_id` de toda llamada a Valida (§5.3): lo pone el servidor desde
 * el workspace de la sesión, **nunca el navegador**. Un valor que no es uuid se trata como
 * ausente: mandarlo a Valida daría 400, y adivinar qué quiso decir sería operar la cuenta de
 * otro.
 */
export function clienteValidaDe(configExtra: unknown): string | null {
  if (!configExtra || typeof configExtra !== 'object') return null
  const valor = (configExtra as Record<string, unknown>).valida_cliente_id
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return UUID.test(limpio) ? limpio.toLowerCase() : null
}

/**
 * El cliente de Valida que ESTE workspace puede operar desde el módulo, o null.
 *
 * Exige las dos cosas a la vez, y no es redundante: medido el 2026-09-16, **7 workspaces ya
 * traen `valida_cliente_id`** (afi, alma-afi, metrik, maxitec y tres CDA), todos clientes de
 * integración. Con solo el cliente, el owner de cualquiera de ellos alcanzaría las acciones de
 * llaves. Valida los frena después con 422 (`canal <> 'api_directa'`), pero ONE no le delega
 * esa decisión: una segunda barrera no es la primera.
 */
export function clienteOperable(
  modules: Record<string, unknown> | null | undefined,
  configExtra: unknown,
): string | null {
  if (!moduloValidaApiActivo(modules)) return null
  return clienteValidaDe(configExtra)
}

/** Llaves: generar, regenerar y revocar. Owner y admin (§5.4, §6). */
export function puedeOperarLlaves(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/** Pagos: dinero del contrato. Owner y admin, igual que `/servicios`. */
export function puedeVerPagos(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/** Nombre de una llave nueva: 1 a 60 caracteres, como exige `EmitirLlaveBody` en Valida. */
export function nombreLlaveValido(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? '').trim()
  return limpio.length >= 1 && limpio.length <= 60 ? limpio : null
}

export function esUuid(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && UUID.test(valor.trim())
}
