import { campoRequeridoCumplido, type CampoTipo } from './campo-completo'

/**
 * ¿Un bloque de solo lectura (`estado='visible'`) que además es GATE puede nacer resuelto?
 *
 * Los bloques `visible` nacen `completo` porque no requieren acción del usuario: los llena
 * el sistema (auto_fill, auto-init, herencia). Eso vale **si el sistema efectivamente los
 * llenó**. Cuando el bloque además es `es_gate`, darlo por resuelto vacío convierte el gate
 * en decoración: no retiene nada y el negocio avanza con la pregunta sin responder.
 *
 * Y es peor cuando el campo ausente decide un routing: ninguna condición matchea, el motor
 * cae al `default_etapa_orden` y el caso se va por la rama equivocada **en silencio**.
 *
 * Caso que lo destapó (SOENA, 2026-07-31): el bloque "Cita DIAN" de la etapa Entrega es
 * `visible` + `es_gate`, y su campo `requiere_cita_dian_iva` decide si el caso pasa por
 * Cita, por Anexos, o cae al default. El auto-init no lo llenaba, nadie podía responderlo a
 * mano (es de solo lectura) y el bloque nacía completo igual. Resultado: los casos con
 * devolución de IVA salían de Entrega directo a **Facturación**, que es `etapa_cierre`. Un
 * dato faltante empujaba el negocio al cierre saltándose toda la fase de devolución.
 *
 * ⚠️ **SOLO aplica a bloques `es_gate`.** La primera versión de esta regla miraba todo
 * bloque `visible` con campos `required`, y eso es demasiado ancho: medido en SOENA,
 * habría hecho nacer `pendiente` a ~640 instancias de bloques que NO son gate (Vehículos,
 * Solicitantes asociados, Radicado de inclusión…). No habrían bloqueado nada — no son
 * gate — pero el equipo vería decenas de bloques marcados como pendientes en cada caso
 * nuevo, cuando hoy los ve resueltos. Ruido que enseña a ignorar los avisos.
 *
 * El defecto a cerrar es **un gate que no retiene**. Un bloque de solo lectura que no es
 * gate y nace resuelto no decide nada y no hace daño: se deja como estaba.
 *
 * La regla por campo NO se reimplementa aquí: delega en `campoRequeridoCumplido`, la fuente
 * única que ya usa `BloqueDatos` para decidir la completitud. Si un `toggle` obligatorio
 * exige quedar en verdadero allá, aquí exige lo mismo.
 *
 * @param esGate `bloque_configs.es_gate`. Si es false, nace completo como siempre.
 */
export function visiblePuedeNacerCompleto(
  configExtra: Record<string, unknown> | null | undefined,
  data: Record<string, unknown> | null | undefined,
  esGate: boolean,
): boolean {
  if (!esGate) return true

  const fields = ((configExtra?.fields ?? []) as Array<{
    slug?: string
    tipo?: string
    required?: boolean
  }>)
  const d = (data ?? {}) as Record<string, unknown>

  for (const f of fields) {
    if (f.required !== true || !f.slug) continue
    if (!campoRequeridoCumplido((f.tipo ?? 'texto') as CampoTipo, d[f.slug])) return false
  }
  return true
}
