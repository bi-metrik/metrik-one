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
    no_cero?: boolean
  }>)
  const d = (data ?? {}) as Record<string, unknown>

  for (const f of fields) {
    if (f.required !== true || !f.slug) continue
    if (!campoRequeridoCumplido({ tipo: (f.tipo ?? 'texto') as CampoTipo, no_cero: f.no_cero }, d[f.slug])) return false
  }
  return true
}

/**
 * ¿Este gate de solo lectura ya está resuelto, aunque su instancia siga `pendiente`?
 *
 * La misma regla de arriba, pero preguntada en otro momento. `visiblePuedeNacerCompleto` se
 * evalúa UNA vez, al crear la instancia, con la data que tenga en ese instante. Cuando el
 * campo que faltaba se llena después —el auto-init en una pasada posterior, un backfill— el
 * veredicto queda viejo y nadie lo revisa.
 *
 * Eso en un bloque `visible` + `es_gate` no es cosmético: es de solo lectura, así que la UI
 * no ofrece forma de cerrarlo, y el gate retiene un negocio **cuya respuesta ya está escrita
 * en el propio bloque**. El caso queda esperando un dato que tiene.
 *
 * Medido en SOENA (2026-08-04): 5 negocios vivos así en la etapa Entrega (V0049, V0066,
 * V0070, V0071, V0080), más V0107 y V0122 destrabados a mano el día anterior. Todos con el
 * campo `requiere_cita_dian_iva` resuelto desde la seccional del RUT.
 *
 * Devuelve false para todo lo que no sea un gate de solo lectura: un bloque editable lo
 * cierra la persona que lo diligencia, y no le corresponde a esto adelantarse.
 */
export function gateVisibleQuedaResuelto(
  bloqueConfig: {
    estado?: string | null
    es_gate?: boolean | null
    config_extra?: Record<string, unknown> | null
  } | null | undefined,
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (bloqueConfig?.estado !== 'visible' || bloqueConfig?.es_gate !== true) return false
  return visiblePuedeNacerCompleto(bloqueConfig.config_extra ?? null, data, true)
}

/**
 * ¿Una copia de solo lectura de un DOCUMENTO puede nacer completa?
 *
 * Un bloque `visible` nace completo porque no requiere acción del usuario. Para un
 * bloque de datos eso es cierto: lo llena el sistema. Para un DOCUMENTO heredado no:
 * la copia no tiene archivo propio, muestra el del origen, y si el origen tampoco
 * tiene archivo la pantalla afirma que el documento está cuando no está. Eso no es
 * ruido, es información falsa, y sobre un expediente es peor que un pendiente de más.
 *
 * Medido en SOENA el 2026-08-10, al mover el bloque de factura: **754 instancias**
 * de "Factura emitida" y 28 de "RUT solicitante 2" se veían completas con el origen
 * vacío. En cambio las de Certificado UPME, Factura Venta Vehículo y RUT (69 en
 * total) SÍ tienen archivo en su origen y se ven bien: por eso la regla mira el
 * origen y no el tipo a secas, que las habría marcado pendientes sin motivo.
 *
 * @param esDocumento tipo del bloque === 'documento'.
 * @param origenTieneArchivo si el negocio ya tiene el documento en el bloque origen.
 */
export function documentoHeredadoNaceCompleto(
  esDocumento: boolean,
  heredado: boolean,
  origenTieneArchivo: boolean,
): boolean {
  if (!esDocumento || !heredado) return true
  return origenTieneArchivo
}
