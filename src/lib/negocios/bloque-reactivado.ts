/**
 * Bloques que se ACTIVARON tarde: aplican hoy, pero el caso ya pasó por su etapa.
 *
 * ── El problema ───────────────────────────────────────────────────────────────────
 * Un bloque condicional solo se dibuja si su `condition` se cumple. Cuando el caso
 * avanzó, la condición se evaluó con lo que se había respondido en ese momento; si
 * después alguien CORRIGE la respuesta, la condición pasa a cumplirse y el bloque
 * pasa a aplicar — pero su etapa ya quedó atrás y el historial de etapas anteriores
 * no lo muestra: excluye lo que no tiene instancia y lo que está vacío y pendiente
 * (`getNegocioDetalleCompleto`). Resultado: el bloque que ahora hace falta no existe
 * en ninguna pantalla.
 *
 * Lo que costó (SOENA, agosto 2026): un vehículo con DOS titulares se registró como
 * "Un solo solicitante" — 119 de los 261 casos abiertos tienen esa respuesta puesta
 * por backfill, o sea que nadie la contestó. El RUT del segundo titular
 * (`rut_solicitante_2`) vive en Documentación y es condicional a `copropiedad`. Al
 * corregir la titularidad estando en Cargue, el bloque pasa a aplicar y no aparece
 * en ningún lado: operaciones tenía el PDF en la mano y ningún lugar donde subirlo.
 * La DIAN exige que ambos titulares salgan en el certificado UPME, así que el caso
 * queda detenido. Medido: de 4 casos en copropiedad, solo 1 tenía el segundo RUT.
 *
 * ── El criterio ───────────────────────────────────────────────────────────────────
 * NO se reconstruye si la condición se cumplía antes: eso exigiría una historia que
 * nadie guardó, y cualquier respuesta sería una suposición. Se pregunta lo único que
 * se puede saber de verdad — ¿el bloque aplica HOY y sigue vacío? Es el mismo
 * razonamiento de `editable-si-vacio.ts`: el bloque no depende de por dónde entró el
 * caso, depende de si el dato ya está.
 *
 * Tres condiciones, todas necesarias:
 *
 *  1. El bloque DECLARA una `condition`. Un bloque sin condición que quedó vacío es
 *     simplemente un bloque que nadie llenó; no se activó por ninguna decisión, y
 *     tratarlo igual llenaría el historial de todo lo que alguna vez se saltó.
 *  2. Su condición se cumple con los datos vigentes.
 *  3. Está VACÍO. Un bloque con dato no se toca: corregir lo que ya está escrito es
 *     el otro camino, el de `bloque_correcciones`, que exige causa y deja rastro.
 *     Esto no lo reemplaza ni lo esquiva.
 *
 * ── Opt-in ────────────────────────────────────────────────────────────────────────
 * La LÍNEA lo declara: `lineas_negocio.config_extra.reactivar_bloques.activa = true`.
 * Escribir en una etapa que ya pasó es exactamente lo que el resto del producto cierra
 * a propósito, así que ninguna línea lo gana sin pedirlo. Una línea que no lo declare
 * se comporta igual que hoy.
 */

import { cumpleCondicion, type CondicionBloque, type FuentesCondicion } from './condicion-bloque'

/** `true` cuando `activa` está declarado en la config de la línea. */
export function reactivacionActiva(
  configLinea: Record<string, unknown> | null | undefined,
): boolean {
  const cfg = (configLinea as { reactivar_bloques?: { activa?: unknown } } | null)?.reactivar_bloques
  return cfg?.activa === true
}

/**
 * ¿La instancia nunca se llenó?
 *
 * ⚠️ Las claves con guion bajo NO cuentan. `_migrado: true` es la marca que dejó el
 * backfill, no una respuesta de nadie: un bloque que solo tiene eso está vacío para
 * cualquier efecto humano. Contarlo como lleno dejaría fuera justo los casos que
 * motivaron este módulo.
 *
 * Un valor presente pero vacío (`''`, `null`, `[]`, `{}`) tampoco cuenta: los
 * defaults de un bloque se escriben al nacer y no son un dato que alguien puso.
 */
export function instanciaVacia(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return true
  return Object.entries(data).every(([clave, valor]) => clave.startsWith('_') || esValorVacio(valor))
}

function esValorVacio(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === '') return true
  if (Array.isArray(valor)) return valor.length === 0
  if (typeof valor === 'object') {
    return Object.values(valor as Record<string, unknown>).every(esValorVacio)
  }
  return false
}

export interface EntradaReactivado {
  /** Opt-in ya resuelto: `reactivacionActiva(config de la línea)`. */
  activa: boolean
  configExtra: Record<string, unknown> | null | undefined
  data: Record<string, unknown> | null | undefined
  /** Estado de la instancia. `null` cuando la instancia ni siquiera existe. */
  estado: string | null
  fuentes: FuentesCondicion
}

/**
 * ¿Este bloque de una etapa YA PASADA aplica hoy y sigue vacío?
 *
 * ⚠️ Un bloque heredado (`source_etapa_orden`) NUNCA es reactivable: es una COPIA de
 * solo lectura de un bloque que vive en otra etapa, y habilitarlo escribiría el dato
 * en el lugar equivocado. El que hay que abrir es el origen.
 */
export function esBloqueReactivado(entrada: EntradaReactivado): boolean {
  if (!entrada.activa) return false
  const ce = entrada.configExtra ?? {}
  if (typeof (ce as { source_etapa_orden?: unknown }).source_etapa_orden === 'number') return false
  if ((ce as { desactivado?: unknown }).desactivado === true) return false
  const cond = (ce as { condition?: CondicionBloque }).condition
  if (!cond) return false
  if (entrada.estado === 'completo') return false
  if (!instanciaVacia(entrada.data)) return false
  return cumpleCondicion(cond, entrada.fuentes)
}
