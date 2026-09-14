/**
 * Gate de carpeta local, lado de la aplicacion.
 *
 * La regla NO vive aqui. La aplica el trigger `trg_zz_gate_carpeta_local` sobre `negocios`
 * (migracion `20260914223000_gate_carpeta_local.sql`): en un workspace con
 * `config_extra.exigir_carpeta_local = true`, un negocio no pasa de la primera etapa de su
 * linea sin `metadata.carpeta_local`. Vive en la base porque `etapa_actual_id` lo escriben
 * seis caminos de la aplicacion, los scripts y el SQL directo, y un control en uno solo deja
 * los demas abiertos.
 *
 * Por eso este modulo no decide nada: solo reconoce el rechazo por su SQLSTATE y lo convierte
 * en un bloqueo que la pantalla ya sabe mostrar (el modal de gates, sin boton de omitir). No
 * se repite la regla en TypeScript a proposito: una segunda copia se separaria de la primera,
 * y el sintoma seria una pantalla que dice una cosa y una base que hace otra.
 *
 * El texto tampoco se redacta aqui: sale del MESSAGE del trigger, que se basta solo porque
 * varios caminos lo muestran tal cual.
 */

/** SQLSTATE con el que el trigger rechaza. Contrato con la migracion (ver el test). */
export const SQLSTATE_GATE_CARPETA_LOCAL = 'MK001'

/** Clave de `workspaces.config_extra` que enciende el gate. Solo cuenta el booleano `true`. */
export const CLAVE_EXIGIR_CARPETA_LOCAL = 'exigir_carpeta_local'

/** Solo para el caso improbable de un rechazo con el codigo pero sin mensaje. */
const MENSAJE_RESPALDO =
  'Este negocio no puede pasar de la primera etapa sin su carpeta del cerebro: registra la ruta proyectos/{cliente}/{proyecto}/ en metadata.carpeta_local.'

export type BloqueoGate = { nombre: string; es_gate: true; omitible: false }

export function esRechazoCarpetaLocal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (err as { code?: unknown }).code === SQLSTATE_GATE_CARPETA_LOCAL
}

/**
 * El bloqueo para `bloquesPendientes`, o `null` si el error es cualquier otro.
 *
 * `omitible: false` porque el override de owner/admin no pasa por la base: el trigger lo
 * vuelve a rechazar igual, y un boton de "Omitir gate" que no hace nada es peor que no tenerlo.
 */
export function bloqueoCarpetaLocal(err: unknown): BloqueoGate | null {
  if (!esRechazoCarpetaLocal(err)) return null
  const msg = (err as { message?: unknown }).message
  return {
    nombre: typeof msg === 'string' && msg.trim() !== '' ? msg : MENSAJE_RESPALDO,
    es_gate: true,
    omitible: false,
  }
}
