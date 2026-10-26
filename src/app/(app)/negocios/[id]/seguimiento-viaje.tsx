import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'
import { lineaEstadoEnvio } from '@/lib/negocios/seguimiento'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * La línea de estado del gate `cotizacion_enviada` (Seguimiento, etapa 3 de «Viaje a medida»):
 * «Cotización enviada el …» o «Falta enviar la cotización desde «Revisar y enviar»». Solo en la
 * etapa que declara el gate; en las demás no lee nada más ni pinta nada. Lee lo mismo que el gate
 * (`hayCotizacionEnviada`: una cotización con `fecha_envio`).
 */
export async function leerSeguimientoViaje(
  supabase: Db,
  args: { workspaceId: string; negocioId: string },
): Promise<React.ReactNode> {
  try {
    const { data: neg } = await supabase
      .from('negocios')
      .select('etapa_actual_id')
      .eq('id', args.negocioId)
      .eq('workspace_id', args.workspaceId)
      .maybeSingle()
    const etapaId = (neg as { etapa_actual_id?: string | null } | null)?.etapa_actual_id
    if (!etapaId) return null
    const { data: etapa } = await supabase.from('etapas_negocio').select('config_extra').eq('id', etapaId).maybeSingle()
    const gates = ((etapa as { config_extra?: { gates?: unknown } } | null)?.config_extra?.gates ?? []) as unknown[]
    if (!gates.includes('cotizacion_enviada')) return null
    const { data: cots, error } = await supabase
      .from('cotizaciones')
      .select('fecha_envio')
      .eq('negocio_id', args.negocioId)
      .not('fecha_envio', 'is', null)
      .order('fecha_envio', { ascending: false })
      .limit(1)
    if (error) return null
    const fecha = ((cots ?? []) as Array<{ fecha_envio: string | null }>)[0]?.fecha_envio ?? null
    const linea = lineaEstadoEnvio(fecha ? formatBogotaFechaCortaAno(fecha) ?? null : null)
    return (
      <p
        className={`mb-3 rounded-lg border px-3 py-2 text-xs ${linea.enviada ? 'text-emerald-800' : 'border-amber-200 bg-amber-50/60 text-amber-900'}`}
        data-seguimiento-envio={linea.enviada ? 'enviada' : 'falta'}
      >
        {linea.texto}
      </p>
    )
  } catch (e) {
    console.warn('[negocio] no se pudo leer el envío de la cotización:', e instanceof Error ? e.message : e)
    return null
  }
}
