import { campoRequeridoCumplido, type CampoTipo } from './campo-completo'

/**
 * ¿Un bloque de solo lectura (`estado='visible'`) puede nacer ya resuelto?
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
 * Regla: si el bloque declara campos `required` sin valor, NO nace completo — queda
 * `pendiente` para que su gate retenga y alguien lo mire. Sin campos `required` (el caso
 * común de los bloques informativos heredados), el comportamiento es idéntico al anterior.
 *
 * La regla por campo NO se reimplementa aquí: delega en `campoRequeridoCumplido`, la fuente
 * única que ya usa `BloqueDatos` para decidir la completitud. Si un `toggle` obligatorio
 * exige quedar en verdadero allá, aquí exige lo mismo.
 */
export function visiblePuedeNacerCompleto(
  configExtra: Record<string, unknown> | null | undefined,
  data: Record<string, unknown> | null | undefined,
): boolean {
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
