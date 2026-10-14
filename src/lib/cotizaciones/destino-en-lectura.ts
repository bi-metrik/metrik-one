/**
 * La decisión del modelo DENTRO de la lectura de un pantallazo (cotización por pasos, C5; nota
 * técnica de Max §5.2). La llama la ruta `leer-captura` cuando la bandeja de la forma por pasos
 * manda el viaje. Solo con la pieza `modelo_destino` encendida, que pide `true` explícito (M4).
 *
 * Nunca lanza y nunca escribe: cualquier cosa que falle es `null`, y la fila se queda con la frase
 * de las reglas.
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getServerKey } from '@/lib/server-keys'
import { decidirDestinoConModelo, leerServiciosDelViaje } from '@/lib/ai/decidir-destino'
import { lecturaParaDecidir, type DecisionDelModelo } from './destino-por-pasos'
import { exigirPorPasos } from './por-pasos-datos'
import type { TipoRanura } from './ranuras-cotizacion'
import type { LecturaCasilla } from './tarifa-pasajero'

/** ¿La pieza está encendida para esta cotización? Se pregunta EN PARALELO con la lectura. */
export async function modeloDeDestinoEncendido(cotizacionId: string): Promise<boolean> {
  try {
    const { supabase, error } = await getWorkspace()
    if (error) return false
    return (await exigirPorPasos(supabase, cotizacionId, 'modelo_destino')).ok
  } catch {
    return false
  }
}

/** Pregunta al modelo con su corte de 2,5 s. `null` = la fila se queda con las reglas. */
export async function decisionEnLaLectura(
  tipo: TipoRanura,
  lectura: LecturaCasilla,
  serviciosCrudos: unknown,
  opciones: { corteMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<DecisionDelModelo | null> {
  try {
    return await decidirDestinoConModelo(lecturaParaDecidir(tipo, lectura), leerServiciosDelViaje(serviciosCrudos), getServerKey('gemini'), opciones)
  } catch {
    return null
  }
}
