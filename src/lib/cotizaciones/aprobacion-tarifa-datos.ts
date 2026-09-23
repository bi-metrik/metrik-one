/**
 * La elección del cliente, escrita en `decisiones_combinacion` (evento `aceptacion`).
 *
 * La regla vive en `aprobacion-tarifa.ts` y la forma de la fila en
 * `armarFilaDeAceptacion`; aquí solo se lee lo que la fila congela (el viaje, quién
 * aprobó) y se escribe con el cliente de SERVICIO: la tabla guarda precios de proveedor y
 * no concede nada a `authenticated`. El `workspace_id` sale de la sesión, nunca del
 * navegador.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'
import { contextoDeCotizacion, leerItinerarios } from './itinerarios-datos'
import {
  armarFilaDeAceptacion,
  contextoDelViaje,
  registrarSalidaAlCliente,
  type ResultadoRegistro,
} from './registro-decisiones'
import { recomendadaDe } from './tarifas'
import { leerViajeDelNegocio } from './viaje-negocio'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

/**
 * Registra qué tarifa escogió el cliente frente a la Recomendada. **Nunca lanza y nunca
 * bloquea**: corre DESPUÉS de que la aprobación ya se escribió. Perder una fila de
 * aprendizaje es un aviso en la consola; convertir una aprobación buena en un error por
 * eso sería el peor intercambio (mismo criterio que `registrarSalidaAlCliente`).
 *
 * ⚠️ La elección que MANDA no es esta fila: es `cotizaciones.tarifa_aceptada_id` y
 * `negocios.precio_aprobado`, que se escriben antes y sí bloquean si fallan.
 */
export async function registrarEleccionDelCliente(
  supabase: Supabase,
  args: {
    servicio: () => Supabase
    workspaceId: string
    cotizacionId: string
    negocioId: string | null
    staffId: string | null
    elegidaId: string
  },
): Promise<ResultadoRegistro> {
  try {
    const filas = (await leerItinerarios(supabase, args.cotizacionId)) ?? []
    const elegida = filas.find(f => f.id === args.elegidaId)
    const ctx = await contextoDeCotizacion(supabase, args.cotizacionId)
    if (!elegida || !ctx) return { registradas: 0, error: 'No se encontró la tarifa elegida', faltaMigracion: false }

    const { viaje } = await leerViajeDelNegocio(supabase, args.negocioId)

    // Quién aprobó, con su nombre congelado. Sin ficha de staff queda en null: mejor sin
    // autor que con el equivocado.
    let nombre: string | null = null
    if (args.staffId) {
      const { data: staff } = await supabase.from('staff').select('full_name').eq('id', args.staffId).maybeSingle()
      nombre = (staff as { full_name: string | null } | null)?.full_name ?? null
    }

    const fila = armarFilaDeAceptacion({
      workspaceId: args.workspaceId,
      cotizacionId: args.cotizacionId,
      negocioId: args.negocioId,
      ctx,
      ofrecidas: filas.filter(f => f.vaEnPropuesta),
      elegida,
      recomendada: recomendadaDe(filas).fila,
      contexto: contextoDelViaje(viaje, todayBogotaISO()),
      quien: { staffId: args.staffId, nombre },
      aceptadaAt: new Date().toISOString(),
    })
    return await registrarSalidaAlCliente(args.servicio(), [fila])
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[aprobacion-tarifa] no se pudo registrar la elección del cliente:', msg)
    return { registradas: 0, error: msg, faltaMigracion: false }
  }
}
