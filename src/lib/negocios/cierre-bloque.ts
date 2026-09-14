/**
 * ¿Cómo se cierra un bloque, y qué le falta para cerrarse?
 *
 * FUENTE ÚNICA del criterio de completitud de los tipos que no se cierran a mano. La
 * usan el servidor (`marcarBloqueCompleto`, `reevaluarBloqueCronograma`) y los
 * componentes que deciden cuándo pedir el cierre (`BloqueChecklist`, `BloqueDocumentos`,
 * `BloqueEquipo`). Escrita dos veces, la pantalla pediría el cierre con una regla y el
 * servidor lo aceptaría con otra.
 *
 * ⚠️ POR QUÉ EXISTE
 *
 * `marcarBloqueCompleto` validaba el permiso de edición y escribía `estado='completo'`
 * sobre CUALQUIER bloque, sin mirar su tipo. Una server action exportada es un endpoint
 * alcanzable aunque ninguna pantalla la invoque con ese bloque, así que bastaba el id
 * para dar por completo un cronograma sin fechas, un checklist sin marcar, un bloque de
 * cobros con saldo, una propuesta sin aprobar o un bloque de pago sin pago. El único
 * tipo con barrera era `datos` gate (`camposRequeridosFaltantes`).
 *
 * Tres maneras de cerrarse:
 *
 * - `manual`: el cierre ES la acción de la persona (`datos`, el sello de completado, el
 *   multi-pago). Siguen igual que antes.
 * - `criterio`: el estado se DERIVA de lo guardado (ítems, fechas, documentos, saldo,
 *   responsables). Se puede pedir el cierre a mano, pero solo se acepta si el criterio
 *   se cumple.
 * - `accion_propia`: lo cierra una acción específica que valida su propio resultado
 *   (aprobar la propuesta, generar el formulario, procesar el documento, registrar el
 *   pago). `marcarBloqueCompleto` no es su camino y ninguna pantalla lo usa con ellos:
 *   aceptarlo sería saltarse esa validación, y reimplementarla aquí la duplicaría.
 *
 * Un tipo que no esté en ninguna lista se trata como `manual`: no cambia su
 * comportamiento. Al agregar un tipo nuevo, decidir a cuál pertenece.
 *
 * Puro: no toca DB ni red.
 */

import { BANDERAS_CAPTURA_COBRO } from '@/lib/negocios/superficie-cobro'

export type ModoCierre = 'manual' | 'criterio' | 'accion_propia'

const TIPOS_POR_CRITERIO = new Set([
  'cronograma',
  'cobros',
  'checklist',
  'checklist_soporte',
  'documentos',
  'equipo',
])

const TIPOS_ACCION_PROPIA = new Set([
  // Cada uno se cierra con su propia acción.
  'documento', // procesarDocumento / reprocesarDocumento / actualizarCampoDocumento
  'formulario', // generarFormulario
  'propuesta_economica', // aprobarVersionPropuesta
  'cotizacion', // aceptarCotizacionNegocio
  'guia_devolucion', // aprobarVersionGuia
  'plan_recurrente', // crearPlanRecurrente
  'aprobacion', // actualizarAprobacion
  'facturacion',
  'contacto',
  // De solo visualización: nadie los completa.
  'resumen_financiero',
  'resultado',
  'ejecucion',
  'historial',
  'movimientos',
])

/**
 * Las superficies de pago `datos` que registran el dinero con su propia acción
 * (`registrarPagoEpayco`, `registrarPagoExterno`). El multi-pago NO entra: su componente
 * cierra el bloque con `marcarBloqueCompleto`. La lista de banderas sigue viviendo en
 * `superficie-cobro.ts`; aquí solo se descuenta la que se cierra a mano.
 */
const BANDERAS_PAGO_ACCION_PROPIA = BANDERAS_CAPTURA_COBRO.filter(b => b !== 'es_multi_pago')

export function modoCierre(
  tipo: string | null | undefined,
  configExtra: Record<string, unknown> | null | undefined,
): ModoCierre {
  if (!tipo) return 'manual'
  if (TIPOS_ACCION_PROPIA.has(tipo)) return 'accion_propia'
  if (TIPOS_POR_CRITERIO.has(tipo)) return 'criterio'
  // Mismo orden que el dispatch de `negocio-detail-client`: el sello de completado se
  // pinta antes que cualquier superficie de pago, y su botón cierra con esta función.
  if (tipo === 'datos' && configExtra && configExtra.completion_stamp) return 'manual'
  if (tipo === 'datos' && configExtra && BANDERAS_PAGO_ACCION_PROPIA.some(b => configExtra[b])) {
    return 'accion_propia'
  }
  return 'manual'
}

export const MENSAJE_ACCION_PROPIA =
  'Este bloque no se marca a mano: se completa con su propia acción'

export const MENSAJE_SALDO_POR_COBRAR =
  'El negocio todavía tiene saldo por cobrar'

// ── Cronograma ────────────────────────────────────────────────────────────────

/** Misma lectura que pinta «Requiere todas las fechas» en la tarjeta. */
export function exigeTodasLasFechas(configExtra: Record<string, unknown> | null | undefined): boolean {
  return Boolean(configExtra?.require_all_dates)
}

export function faltaEnCronograma(
  items: ReadonlyArray<{ fecha_inicio?: string | null; fecha_fin?: string | null }>,
  exigeFechas: boolean,
): string | null {
  if (items.length === 0) return 'El cronograma no tiene actividades'
  if (exigeFechas) {
    const sinFechas = items.filter(i => !i.fecha_inicio || !i.fecha_fin).length
    if (sinFechas > 0) {
      return sinFechas === 1
        ? 'Falta la fecha planeada de 1 actividad'
        : `Faltan fechas planeadas en ${sinFechas} actividades`
    }
  }
  return null
}

// ── Checklist ─────────────────────────────────────────────────────────────────

/** Un checklist pide soporte (link) por ítem si es del tipo con soporte o lo declara. */
export function checklistConSoporte(
  tipo: string | null | undefined,
  configExtra: Record<string, unknown> | null | undefined,
): boolean {
  return tipo === 'checklist_soporte' || configExtra?.withSupport === true
}

export function itemChecklistCumplido(
  item: { completado?: boolean | null; link_url?: string | null },
  conSoporte: boolean,
): boolean {
  if (!item.completado) return false
  return !conSoporte || !!item.link_url?.trim()
}

export function faltaEnChecklist(
  items: ReadonlyArray<{ completado?: boolean | null; link_url?: string | null }>,
  conSoporte: boolean,
): string | null {
  if (items.length === 0) return 'El checklist no tiene ítems'
  const pendientes = items.filter(i => !itemChecklistCumplido(i, conSoporte)).length
  if (pendientes === 0) return null
  if (conSoporte) {
    return pendientes === 1 ? 'Falta 1 ítem con su soporte' : `Faltan ${pendientes} ítems con su soporte`
  }
  return pendientes === 1 ? 'Falta 1 ítem por marcar' : `Faltan ${pendientes} ítems por marcar`
}

// ── Documentos (varios archivos) ──────────────────────────────────────────────

export interface DocumentoRequerido {
  slug: string
  label?: string
  required?: boolean
}

/** Slugs con archivo guardado en `data.docs`. */
export function documentosSubidos(docs: unknown): Set<string> {
  const out = new Set<string>()
  if (!docs || typeof docs !== 'object') return out
  for (const [slug, url] of Object.entries(docs as Record<string, unknown>)) {
    if (typeof url === 'string' && url.trim()) out.add(slug)
  }
  return out
}

export function faltaEnDocumentos(
  documentos: ReadonlyArray<DocumentoRequerido>,
  subidos: ReadonlySet<string>,
): string | null {
  const faltan = documentos.filter(d => d.required && !subidos.has(d.slug))
  if (faltan.length === 0) return null
  return `Faltan documentos obligatorios: ${faltan.map(d => d.label ?? d.slug).join(', ')}`
}

// ── Equipo ────────────────────────────────────────────────────────────────────

export const ROLES_EQUIPO: ReadonlyArray<{
  key: 'comercial_id' | 'ejecucion_id' | 'financiero_id'
  label: string
  rol: string
}> = [
  { key: 'comercial_id', label: 'Responsable comercial', rol: 'comercial' },
  { key: 'ejecucion_id', label: 'Responsable ejecución', rol: 'ejecucion' },
  { key: 'financiero_id', label: 'Responsable financiero', rol: 'financiero' },
]

/** Si `config_extra.rol` está definido, el bloque solo pide ese responsable. */
export function rolesDelEquipo(configExtra: Record<string, unknown> | null | undefined) {
  const rol = (configExtra?.rol as string | undefined) ?? null
  return rol ? ROLES_EQUIPO.filter(r => r.rol === rol) : ROLES_EQUIPO
}

export function faltaEnEquipo(
  configExtra: Record<string, unknown> | null | undefined,
  data: Record<string, unknown> | null | undefined,
): string | null {
  const asignado = rolesDelEquipo(configExtra).some(r => !!data?.[r.key])
  return asignado ? null : 'Asigna al responsable antes de dar el bloque por completo'
}
