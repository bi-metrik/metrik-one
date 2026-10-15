/**
 * El CIERRE de toda acción de la cotización por pasos que toca opciones o tarifas (C2): las
 * tarifas quedan completas y con la Recomendada en la propuesta, la autorización del dueño se
 * revisa contra la huella nueva y el total se recalcula UNA vez.
 *
 * No es un archivo `'use server'` a propósito: `tarifasTrasAceptar` recibe la foto de ANTES
 * (con funciones adentro) y la llama la ruta de la bandeja, no el navegador. Si fuera una
 * server action, cualquiera podría mandarle una foto inventada.
 *
 * ⚠️ Ningún lector de plata importa este archivo (N4).
 */

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import { exigirPorPasos } from './por-pasos-datos'
import { fotoDeTarifas, sincronizarTarifas, type FotoDeTarifas } from './tarifas-por-pasos-datos'
import {
  aceptarCapturaDeBandeja,
  type BorradorParaAceptar,
  type ResultadoAceptarCaptura,
} from '@/app/(app)/negocios/tarifa-pax-actions'
import { revisarExcepcionTrasCambio } from './piso-salida-datos'
import { createServiceClient } from '@/lib/supabase/server'
import { piezaEncendida, type EstadoPorPasos } from './por-pasos'
import { cambiosDeEstado, estadosPermitidos } from './estado-servicio'
import { conRecalculoDiferido, diferirRecalculoActivo } from './recalculo-diferido'
import { normalizarGrupo } from './itinerarios'
import { medirEtapa } from '@/lib/actions/tiempos-de-ruta'
import { ranuraDeGrupo } from './ranuras-pantallazo'

export type ResultadoPorPasos<T = object> = ({ success: true } & T) | { success: false; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

/**
 * Lo que corre después de toda acción de la forma nueva que toca opciones o tarifas: las
 * tarifas quedan completas y con la Recomendada en la propuesta (`sincronizarTarifas`), la
 * autorización del dueño se revisa contra la huella nueva, y el total se recalcula UNA vez.
 */
export async function cerrarAccionPorPasos(
  supabase: Supabase,
  args: { workspaceId: string; cotizacionId: string; antes: FotoDeTarifas | null; staffId?: string | null },
): Promise<ResultadoPorPasos<{ valorTotal: number | null }>> {
  const s = await sincronizarTarifas(supabase, { workspaceId: args.workspaceId, cotizacionId: args.cotizacionId, antes: args.antes })
  if (!s.ok) return { success: false, error: s.error }
  // La autorización del dueño se revisa contra la huella nueva DENTRO de `recalcularTotales`, después
  // de escribir el total (y con quien hizo el cambio como autor). Hasta H2 (verificación D) se
  // revisaba además aquí, antes: la misma consulta dos veces en cada cierre.
  // Si el recálculo está diferido (dentro de un lote), lo revisa el cierre del lote.
  if (diferirRecalculoActivo()) {
    try {
      await revisarExcepcionTrasCambio(supabase, {
        servicio: createServiceClient,
        workspaceId: args.workspaceId,
        cotizacionId: args.cotizacionId,
        staffId: args.staffId ?? null,
      })
    } catch (e) {
      console.error('[por-pasos] no se pudo revisar la excepción de margen:', e instanceof Error ? e.message : String(e))
    }
  }
  const r = await recalcularTotales(args.cotizacionId)
  const negocioId = s.despues.ctx.negocioId
  if (negocioId) revalidatePath(`/negocios/${negocioId}`)
  return { success: true, valorTotal: 'valorVenta' in r ? (r.valorVenta as number) : null }
}

/**
 * Después de aceptar uno o varios pantallazos desde la bandeja de la forma nueva: la opción
 * nueva entra en las tarifas (propuesta de ONE) y la Recomendada queda en la propuesta. Lo
 * llaman las rutas de la bandeja con la foto de ANTES de aceptar. Comprueba el interruptor.
 */
export async function tarifasTrasAceptar(
  cotizacionId: string,
  antes: FotoDeTarifas | null,
): Promise<ResultadoPorPasos<{ valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  return cerrarAccionPorPasos(supabase, { workspaceId, cotizacionId, antes, staffId })
}

/**
 * «Aceptar» de la bandeja de la forma por pasos: el de siempre (`aceptarCapturaDeBandeja`) y,
 * después, las tarifas con la opción nueva. El interruptor se relee ANTES de aceptar: con él
 * apagado (una pestaña vieja) no se acepta nada y se pide recargar.
 */
export async function aceptarPorPasos(
  cotizacionId: string,
  borrador: BorradorParaAceptar,
  /** P11 · el desplegable de la fila: un servicio NUEVO llega «Opcional» si así se aceptó. */
  estado?: EstadoAlAceptar | null,
): Promise<ResultadoAceptarCaptura & { tarifas?: string }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, codigo: 'CONTEXTO', mensaje: 'No autenticado' }
  // H2 (verificación D) · el guard y la foto de ANTES no dependen uno de otro: en paralelo. Con el
  // interruptor apagado la foto se lee y se descarta; no se escribe nada.
  const [guard, antes] = await Promise.all([
    medirEtapa('guard', () => exigirPorPasos(supabase, cotizacionId)),
    medirEtapa('foto', () => fotoDeTarifas(supabase, cotizacionId)),
  ])
  if (!guard.ok) return { ok: false, codigo: 'POR_PASOS', mensaje: guard.error }
  // Un solo recálculo, en el cierre (como el lote): el de `confirmarTarifaPorPasajero` se difiere.
  // Antes eran dos recálculos completos por aceptación.
  const { resultado: aceptada } = await conRecalculoDiferido(() => aceptarCapturaDeBandeja(cotizacionId, borrador))
  if (!aceptada.ok) return aceptada
  await estadoDelServicioNuevo(supabase, guard.estado, aceptada, estado)
  // El interruptor ya se comprobó en ESTA petición: el cierre no lo vuelve a leer.
  const t = await medirEtapa('cierre', () => cerrarAccionPorPasos(supabase, { workspaceId, cotizacionId, antes, staffId }))
  return t.success ? aceptada : { ...aceptada, tarifas: t.error }
}

/** Cómo entra un servicio nuevo desde la bandeja (decisión M). `incluido` = lo de siempre. */
export type EstadoAlAceptar = 'incluido' | 'opcional'

export function esEstadoAlAceptar(v: unknown): v is EstadoAlAceptar {
  return v === 'incluido' || v === 'opcional'
}

/**
 * P11 · un servicio NUEVO aceptado como «Opcional» queda fuera del precio y se ofrece aparte, con
 * los mismos dos interruptores de «Incluido · Opcional · No va» (C3). Una opción que se suma a un
 * servicio que ya estaba toma el estado de ese servicio: no se toca. El traslado Opcional exige
 * su pieza (`opcional_traslado`), como en la tarjeta.
 */
async function estadoDelServicioNuevo(
  supabase: Supabase,
  estado: EstadoPorPasos,
  aceptada: ResultadoAceptarCaptura,
  pedido: EstadoAlAceptar | null | undefined,
): Promise<void> {
  if (!aceptada.ok || aceptada.como !== 'nueva' || pedido !== 'opcional') return
  const { data: item } = await supabase.from('items').select('id, grupo, entra_al_precio, mostrar_en_sugeridos').eq('id', aceptada.itemId).maybeSingle()
  const grupo = normalizarGrupo((item?.grupo ?? null) as string | null)
  if (!item || !grupo || !estadosPermitidos(grupo).includes('opcional')) return
  if (ranuraDeGrupo(grupo)?.slug === 'traslado_detalle' && !piezaEncendida(estado, 'opcional_traslado')) return
  const cambios = cambiosDeEstado(item, 'opcional')
  if (!cambios) return
  const { error } = await supabase.from('items').update({ entra_al_precio: cambios.entra_al_precio, mostrar_en_sugeridos: cambios.mostrar_en_sugeridos }).eq('id', aceptada.itemId)
  if (error) console.error('[por-pasos] no se pudo dejar Opcional el servicio aceptado:', error.message)
}

// ── «Aceptar los N» (C5, nota técnica §5.3) ─────────────────────────────────

/** Una fila del lote: la captura, su borrador firmado y lo que dice su desplegable. */
export interface FilaDelLote {
  /** El id de la captura en la bandeja: con él vuelve su resultado. */
  id: string
  borrador: BorradorParaAceptar
  estado?: EstadoAlAceptar | null
  /**
   * «Otra opción de» una captura de ESTE MISMO lote que todavía no estaba en la cotización (la
   * lancha privada como opción de la compartida, pegadas juntas). Se resuelve al id que dejó esa
   * captura al aceptarse, que va antes en el orden.
   */
  destinoCaptura?: string | null
}

export type ResultadoDelLote =
  | {
      ok: true
      resultados: { id: string; resultado: ResultadoAceptarCaptura }[]
      /** El cierre (tarifas y total) no pudo correr: las aceptadas quedaron igual. */
      tarifas: string | null
      valorTotal: number | null
    }
  | { ok: false; codigo: string; mensaje: string }

/** El tope de un lote: la bandeja muestra pocas filas y la ruta tiene 60 s. */
export const MAX_LOTE = 20

/**
 * «Aceptar los N»: las N en ORDEN y en serie, con la misma aceptación de siempre y la llave de
 * cada una (la idempotencia no cambia). En serie porque el orden importa: la segunda habitación se
 * une al hotel que creó la primera.
 *
 * El total se recalcula UNA vez, al final (`recalculo-diferido.ts`), también si alguna falló; las
 * que fallan vuelven con su causa y se quedan en la bandeja. El interruptor se comprueba antes.
 */
export async function aceptarLotePorPasos(cotizacionId: string, filas: readonly FilaDelLote[]): Promise<ResultadoDelLote> {
  if (filas.length === 0) return { ok: false, codigo: 'PETICION', mensaje: 'No hay capturas para aceptar.' }
  if (filas.length > MAX_LOTE) return { ok: false, codigo: 'PETICION', mensaje: `Acepta hasta ${MAX_LOTE} a la vez.` }
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, codigo: 'CONTEXTO', mensaje: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { ok: false, codigo: 'POR_PASOS', mensaje: guard.error }
  const antes = await fotoDeTarifas(supabase, cotizacionId)

  const creados = new Map<string, string>()
  const { resultado: resultados } = await conRecalculoDiferido(async () => {
    const out: { id: string; resultado: ResultadoAceptarCaptura }[] = []
    for (const f of filas) {
      let b = f.borrador
      if (f.destinoCaptura) {
        const itemId = creados.get(f.destinoCaptura)
        if (!itemId) {
          out.push({ id: f.id, resultado: { ok: false, codigo: 'DESTINO', mensaje: 'La captura de la que es opción no se aceptó. Acéptala primero o toca la frase y elige otra.' } })
          continue
        }
        b = { ...b, destinoId: itemId }
      }
      let r: ResultadoAceptarCaptura
      try {
        r = await aceptarCapturaDeBandeja(cotizacionId, b)
      } catch (e) {
        console.error('[aceptar-lote] una captura falló:', e instanceof Error ? e.message : String(e))
        r = { ok: false, codigo: 'ERROR', mensaje: 'ONE no pudo agregar esta captura. Sigue aquí: toca «Aceptar» otra vez.' }
      }
      if (r.ok) {
        creados.set(f.id, r.itemId)
        await estadoDelServicioNuevo(supabase, guard.estado, r, f.estado)
      }
      out.push({ id: f.id, resultado: r })
    }
    return out
  })

  // Un solo cierre: tarifas, autorización del dueño y el total, una vez.
  const cierre = await cerrarAccionPorPasos(supabase, { workspaceId, cotizacionId, antes, staffId })
  return {
    ok: true,
    resultados,
    tarifas: cierre.success ? null : cierre.error,
    valorTotal: cierre.success ? cierre.valorTotal : null,
  }
}
