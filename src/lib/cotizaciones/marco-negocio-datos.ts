/**
 * La lectura del marco del negocio para la cotización de viaje (`marco-negocio.ts`).
 *
 * Devuelve `null` cuando el negocio NO cotiza viajes (su línea no declara quiénes
 * viajan, `lineas-por-tipo.ts`) o cuando no se puede leer: en los dos casos la
 * cotización se pinta como siempre, sin marco (R6: Termotech, Arca y WMC no ven nada).
 *
 * `custom_data` del contacto se lee aquí y no viaja entero: solo los campos del perfil
 * (`perfilDesdeCustomData`). `getNegocio` lo deja fuera a propósito.
 */

import { guardVerNegocio } from '@/lib/permissions/guard-negocio'
import type { LineaParaCobertura } from './cobertura-opciones'
import { lineaCotizaPorTipo } from './lineas-por-tipo'
import {
  cotizacionesAbiertas,
  iataDelDestino,
  muestraCotizaciones,
  perfilDesdeCustomData,
  solicitudDesdeFilas,
  type EtapaDelNegocio,
  type MarcoDelNegocio,
} from './marco-negocio'
import { viajeDesdeFilas } from './viaje-negocio'

type Resultado<T> = { data: T | null; error: { message: string } | null }

export async function leerMarcoDelNegocio(supabase: unknown, workspaceId: string, negocioId: string): Promise<MarcoDelNegocio | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const neg = await sb
    .from('negocios')
    .select('id, linea_id, contacto_id, etapas_negocio!negocios_etapa_actual_id_fkey(nombre, stage, numero)')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle() as Resultado<{
      id: string
      linea_id: string | null
      contacto_id: string | null
      etapas_negocio: EtapaDelNegocio | EtapaDelNegocio[] | null
    }>
  if (neg.error || !neg.data?.linea_id) return null

  // ¿Cotiza viajes? La misma pregunta que se hace la página de la cotización.
  const bloques = await sb
    .from('bloque_configs')
    .select('fields:config_extra->fields, etapas_negocio!inner(linea_id)')
    .eq('etapas_negocio.linea_id', neg.data.linea_id) as Resultado<{ fields: unknown }[]>
  if (bloques.error || !lineaCotizaPorTipo((bloques.data ?? []).map(b => b.fields))) return null

  const guard = await guardVerNegocio(negocioId)
  if (!guard.ok) return null

  const [filasViaje, contacto, cots] = await Promise.all([
    sb
      .from('negocio_bloques')
      .select(
        'adultos:data->adultos, ninos:data->ninos, infantes:data->infantes, '
        + 'fecha_salida:data->fecha_salida, fecha_regreso:data->fecha_regreso, destino:data->destino, '
        + 'destino_tipo:data->destino_tipo, fechas_tipo:data->fechas_tipo, requisitos_especiales:data->requisitos_especiales',
      )
      .eq('negocio_id', negocioId) as Promise<Resultado<Record<string, unknown>[]>>,
    neg.data.contacto_id
      ? sb
        .from('contactos')
        .select('custom_data')
        .eq('id', neg.data.contacto_id)
        .eq('workspace_id', workspaceId)
        .maybeSingle() as Promise<Resultado<{ custom_data: unknown }>>
      : Promise.resolve({ data: null, error: null }),
    sb
      .from('cotizaciones')
      .select('id, codigo, consecutivo, estado, valor_total, updated_at, created_at')
      .eq('negocio_id', negocioId) as Promise<Resultado<{ id: string; codigo: string | null; consecutivo: string | null; estado: string; valor_total: number | null; updated_at: string | null; created_at: string | null }[]>>,
  ])

  if (filasViaje.error) console.warn('[marco-negocio] no se pudo leer la solicitud:', filasViaje.error.message)
  if (contacto.error) console.warn('[marco-negocio] no se pudo leer el contacto:', contacto.error.message)
  if (cots.error) console.warn('[marco-negocio] no se pudieron leer las cotizaciones:', cots.error.message)

  const filas = filasViaje.data ?? []
  const v = viajeDesdeFilas(filas)
  const viaje = { destino: v.destino, fechas: v.fechas, composicion: v.composicion }

  const abiertas = cotizacionesAbiertas(cots.data ?? [])

  // El IATA sale de los vuelos ya leídos de las cotizaciones abiertas.
  let iataDestino: string | null = null
  if (abiertas.length > 0 && viaje.destino) {
    const items = await sb
      .from('items')
      .select('id, cotizacion_id, grupo, tarifa_pax')
      .in('cotizacion_id', abiertas.map(c => c.id))
      .ilike('grupo', 'vuelo%') as Resultado<(LineaParaCobertura & { cotizacion_id: string })[]>
    if (items.error) console.warn('[marco-negocio] no se pudieron leer los vuelos:', items.error.message)
    iataDestino = iataDelDestino(viaje.destino, items.data ?? [])
  }

  const etapaRaw = neg.data.etapas_negocio
  const etapa = (Array.isArray(etapaRaw) ? etapaRaw[0] : etapaRaw) ?? null

  return {
    negocioId,
    viaje,
    iataDestino,
    solicitud: solicitudDesdeFilas(filas, viaje),
    perfil: perfilDesdeCustomData(contacto.data?.custom_data),
    cotizaciones: muestraCotizaciones(etapa) && !cots.error ? abiertas : null,
    puedeCrearCotizacion: !abiertas.some(c => c.estado === 'aceptada'),
  }
}
