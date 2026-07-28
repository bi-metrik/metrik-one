import type { OrigenNegocio } from '@/lib/catalogos/constants'

// ── Constantes para cierre de negocios ────────────────────────────────────────

export const RAZONES_PERDIDA_NEGOCIO = [
  { value: 'precio', label: 'Precio muy alto' },
  { value: 'competencia', label: 'Eligieron a otro' },
  { value: 'timing', label: 'No es el momento' },
  { value: 'no_responde', label: 'No respondio' },
  { value: 'desistio', label: 'El cliente desistio' },
  { value: 'no_conversion_post_pausa', label: 'No hubo conversion tras 3 pausas' },
  { value: 'no_incluido_upme', label: 'No incluido en UPME' },
  { value: 'duplicado', label: 'Lead duplicado' },
  { value: 'fuera_de_perfil', label: 'Fuera de perfil (no aplica)' },
  { value: 'dato_falso_incontactable', label: 'Dato falso / incontactable' },
  { value: 'lead_no_interesado', label: 'No interesado' },
  { value: 'otro', label: 'Otro motivo' },
] as const

// Subconjunto para el descarte de un lead en el buzón de entrada (Recepción).
// Lista separada de las razones de pérdida de venta: mide la calidad de la
// pauta/prospección, no la pérdida comercial. Se muestra cuando el negocio se
// descarta desde una etapa buzón (config_extra.buzon_leads). Los valores viven
// también en RAZONES_PERDIDA_NEGOCIO (misma columna razon_cierre).
export const RAZONES_DESCARTE_LEAD = [
  { value: 'duplicado', label: 'Lead duplicado' },
  { value: 'fuera_de_perfil', label: 'Fuera de perfil (no aplica)' },
  { value: 'dato_falso_incontactable', label: 'Dato falso / incontactable' },
  { value: 'lead_no_interesado', label: 'No interesado' },
  { value: 'otro', label: 'Otro motivo' },
] as const

// Motivos de pausa — lista cerrada
export const MOTIVOS_PAUSA = [
  { value: 'silencio', label: 'Cliente no responde' },
  { value: 'decision_interna', label: 'Esperando decision interna del cliente' },
  { value: 'esperando_credito', label: 'Esperando aprobacion de credito' },
  { value: 'objecion_precio', label: 'Objecion de precio en evaluacion' },
  { value: 'timing', label: 'Cliente en otra prioridad / timing' },
  { value: 'otro', label: 'Otro (especificar)' },
] as const

export const MAX_PAUSAS = 3
export const MAX_DIAS_PAUSA = 14
export const SAFETY_NET_HORAS = 24 // Reactivar en <24h no consume pausa

export const MOTIVOS_CANCELACION = [
  { value: 'cliente_desiste', label: 'Decision del cliente' },
  { value: 'incumplimiento_cliente', label: 'Incumplimiento del cliente' },
  { value: 'incumplimiento_metrik', label: 'Incumplimiento de MeTRIK' },
  { value: 'problema_upme', label: 'Problema con UPME' },
  { value: 'doc_rechazado', label: 'Documento rechazado' },
] as const

// ── Origen del negocio convertido desde una interaccion ──────────────────────
//
// Canal de la interaccion (contacto_interacciones.fuente) → origen del negocio.
// Los `fuente` ('meta' | 'whatsapp' | 'web' | 'manual') NO son el catalogo de
// origenes, por eso el mapeo es explicito. Sin fuente conocida cae a 'otro':
// un negocio convertido nunca queda sin origen.
//
// Vive aqui (modulo plano, no 'use server') para que lo usen tanto la server
// action que crea el negocio como el mini-formulario que muestra el origen ya
// resuelto: una sola regla, cero drift entre lo que se ve y lo que se guarda.
export function origenDesdeFuenteInteraccion(fuente: string | null | undefined): OrigenNegocio {
  switch (fuente) {
    case 'meta':
      return 'meta'
    case 'web':
      return 'web_organico'
    // Un WhatsApp entrante o una interaccion cargada a mano son el cliente
    // llegando por su cuenta: contacto directo.
    case 'whatsapp':
    case 'manual':
      return 'contacto_directo'
    default:
      return 'otro'
  }
}

// ── Marcas de condicion economica ────────────────────────────────────────────
//
// Eje INDEPENDIENTE del origen del negocio (`negocios.origen`): el origen dice
// de donde vino, la marca dice bajo que condicion economica atipica se cerro.
// Un negocio puede tener varias marcas o ninguna, y se ponen/quitan despues de
// crearlo (a diferencia del origen, que se captura al crear).
//
// Viven en `negocios.metadata.marcas` (no columna): son opcionales, editables y
// su unico consumidor es el conteo de la financiera. Cada marca estampa quien y
// cuando (ver src/app/(app)/negocios/marcas-actions.ts).
//
// Fuente unica del catalogo: agregar o renombrar una marca se hace AQUI.
export const MARCAS_CONDICION = [
  { value: 'descuento', label: 'Con descuento', chipClass: 'bg-[#F59E0B]/10 text-[#B45309]' },
  { value: 'sin_honorario', label: 'Sin honorario', chipClass: 'bg-[#EF4444]/10 text-[#DC2626]' },
  { value: 'otro', label: 'Otra condicion', chipClass: 'bg-[#F5F4F2] text-[#6B7280]' },
] as const

export type MarcaCondicionTipo = typeof MARCAS_CONDICION[number]['value']

/** Una marca tal como se persiste en negocios.metadata.marcas. */
export type MarcaCondicion = {
  tipo: MarcaCondicionTipo
  /** Detalle libre opcional (ej. "20% por volumen"). */
  nota: string | null
  /** staff.id de quien la puso. */
  marcado_por_id: string | null
  marcado_por_nombre: string | null
  /** ISO timestamp. */
  marcado_en: string
}

export function esMarcaCondicionValida(value: unknown): value is MarcaCondicionTipo {
  return MARCAS_CONDICION.some((m) => m.value === value)
}

export function marcaCondicionConfig(value: string | null | undefined) {
  if (!value) return null
  return MARCAS_CONDICION.find((m) => m.value === value) ?? null
}

export function marcaCondicionLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return marcaCondicionConfig(value)?.label ?? value
}

/**
 * Lee las marcas de `negocios.metadata`. Tolerante a basura: si la key no existe,
 * no es arreglo, o algún item no tiene tipo valido, se descarta ese item en vez
 * de romper la lista de negocios. Fuente unica de la lectura (la usan tanto
 * getNegociosV2 como las server actions de marcas).
 */
export function leerMarcasDeMetadata(metadata: unknown): MarcaCondicion[] {
  const raw = (metadata as { marcas?: unknown } | null)?.marcas
  if (!Array.isArray(raw)) return []
  const out: MarcaCondicion[] = []
  for (const item of raw) {
    const m = item as Partial<MarcaCondicion>
    if (!esMarcaCondicionValida(m?.tipo)) continue
    out.push({
      tipo: m.tipo,
      nota: typeof m.nota === 'string' && m.nota.trim() ? m.nota.trim() : null,
      marcado_por_id: typeof m.marcado_por_id === 'string' ? m.marcado_por_id : null,
      marcado_por_nombre: typeof m.marcado_por_nombre === 'string' ? m.marcado_por_nombre : null,
      marcado_en: typeof m.marcado_en === 'string' ? m.marcado_en : '',
    })
  }
  return out
}
