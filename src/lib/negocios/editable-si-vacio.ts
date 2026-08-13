import { campoRequeridoCumplido, type CampoTipo } from './campo-completo'

/**
 * Un bloque heredado que se comporta según lo que TRAIGA: si el dato ya viene
 * de la etapa anterior, se muestra de solo lectura; si viene vacío, se habilita
 * para que lo llenen aquí.
 *
 * Opt-in por `config_extra.editable_solo_si_vacio`. Sin la marca, el bloque se
 * comporta exactamente igual que antes.
 *
 * POR QUÉ EXISTE. La alternativa era condicionar el bloque a la rama del proceso
 * ("muéstralo solo si la cita se pidió por PQRS"), y eso deja al comercial de la
 * otra rama SIN VER el dato que necesita: en SOENA tiene que avisarle al cliente
 * la fecha de su cita, y la fecha estaba escondida en el historial de la etapa
 * anterior. El bloque no depende de por dónde entró el caso, depende de si el
 * dato ya está. Preguntar por el dato es más simple y no se desincroniza cuando
 * el proceso gana una rama nueva.
 *
 * ⚠️ SE EVALÚA SOBRE EL DATO DEL ORIGEN, no sobre la copia local. En un bloque
 * `compartido_con_origen` la fila local está vacía por diseño (la escritura se
 * redirige al origen), así que mirar la copia diría "vacío" siempre y el bloque
 * nunca pasaría a solo lectura. `getNegocioDetalle` ya sustituye el `data` por el
 * del origen antes de mandarlo al cliente, y este helper se llama con ese dato.
 *
 * ⚠️ Y ATENCIÓN AL GATE. Un bloque de solo lectura que además es `es_gate` tiene
 * que quedar RESUELTO, no pendiente: la pantalla no ofrece forma de cerrarlo y el
 * negocio quedaría retenido esperando un dato que ya tiene. Es el mismo defecto
 * que este repo ya documentó dos veces (ver `bloque-visible-completo.ts`). Por eso
 * el cierre corre en el servidor, no solo en el render.
 */
export function soloLecturaPorDatoLleno(
  configExtra: Record<string, unknown> | null | undefined,
  data: Record<string, unknown> | null | undefined,
): boolean {
  if ((configExtra as { editable_solo_si_vacio?: boolean } | null)?.editable_solo_si_vacio !== true) {
    return false
  }

  const fields = ((configExtra?.fields ?? []) as Array<{
    slug?: string
    tipo?: string
    required?: boolean
    no_cero?: boolean
  }>)
  const d = (data ?? {}) as Record<string, unknown>

  // Sin campos requeridos declarados no hay forma de saber si "ya viene lleno":
  // se deja editable, que es el lado seguro (no esconde un campo por llenar).
  const requeridos = fields.filter(f => f.required === true && f.slug)
  if (requeridos.length === 0) return false

  return requeridos.every(f =>
    campoRequeridoCumplido({ tipo: (f.tipo ?? 'texto') as CampoTipo, no_cero: f.no_cero }, d[f.slug as string])
  )
}
