/**
 * El IVA de una cotización, leído de la base: la liquidación de `iva-cotizacion.ts` sobre
 * la cascada de la cotización.
 *
 * Lo llaman el PDF y «Aprobar». El editor hace la misma cuenta con lo que ya tiene en
 * pantalla, con las mismas funciones puras: la cifra no se puede separar entre superficies
 * porque ninguna la calcula por su cuenta.
 *
 * ⚠️ Solo se llama con la base `ingreso_propio` encendida. Con la base apagada (el defecto
 * de todos los workspaces) nadie paga estas lecturas y cada superficie sigue por su camino
 * de siempre.
 *
 * El cliente de Supabase entra por parámetro, como en `itinerarios-datos.ts`: así se prueba
 * con un doble que escribe de verdad.
 */

import { calcularCascada } from '@/lib/cotizaciones/totales'
import { cascadaDeItinerario } from '@/lib/cotizaciones/itinerarios'
import {
  cascadaVigente,
  contextoDeCotizacion,
  leerItinerarios,
} from '@/lib/cotizaciones/itinerarios-datos'
import { lineaDeRecargo, politicaRecargoDeLinea } from '@/lib/cotizaciones/recargo-linea'
import { esRecomendada } from '@/lib/cotizaciones/tarifas'
import type { FiscalProfile } from '@/types/database'
import {
  ivaIncluidoEnElPrecio,
  ivaSobreIngresoPropio,
  leerConfigIvaCotizacion,
  lineasParaIva,
  liquidarIva,
  motivoIvaSinCalcular,
  tarifaIvaDelVendedor,
  type ConfigIvaCotizacion,
  type IvaDeLinea,
  type LiquidacionIva,
  type MetaDeLineaParaIva,
} from './iva-cotizacion'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

export interface IvaDeCotizacion {
  config: ConfigIvaCotizacion
  /** El perfil fiscal del vendedor. `null` si el workspace no tiene. */
  perfil: FiscalProfile | null
  /** El IVA de CADA línea de la cotización, también de las alternativas y los sugeridos. */
  porItem: Map<string, IvaDeLinea>
  /** El IVA de lo que la cotización cobra hoy: la cascada vigente (`valor_total`). */
  vigente: LiquidacionIva
  /**
   * El IVA de CADA tarifa marcada para la propuesta, por id de itinerario: lo que el
   * cliente pagaría si escoge esa. Es la suma del IVA de sus líneas, la misma que el PDF
   * le suma al precio de su tarjeta.
   */
  porTarifa: Map<string, LiquidacionIva>
  /**
   * `false` si alguna línea que el cliente puede comprar —la cascada vigente o una tarifa
   * marcada para la propuesta— tiene precio sin costo: su IVA no se calculó.
   */
  calculable: boolean
  /** Esas líneas, por nombre y sin repetir. */
  sinCosto: string[]
}

/**
 * La liquidación completa de una cotización. `null` si la cotización no se puede leer.
 */
export async function ivaDeLaCotizacion(
  supabase: Supabase,
  args: { workspaceId: string; cotizacionId: string; config: ConfigIvaCotizacion },
): Promise<IvaDeCotizacion | null> {
  const ctx = await contextoDeCotizacion(supabase, args.cotizacionId)
  if (!ctx) return null
  const filas = await leerItinerarios(supabase, args.cotizacionId)

  const { data: perfilRaw } = await supabase
    .from('fiscal_profiles')
    .select('*')
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()
  const perfil = (perfilRaw ?? null) as FiscalProfile | null

  // El recargo fijo es plata de la agencia aunque no tenga costo: se reconoce por su
  // nombre, igual que en el resto del producto (`lineaDeRecargo`).
  const recargo = lineaDeRecargo(ctx.items, politicaRecargoDeLinea(ctx.configLinea))
  const porId = new Map(ctx.items.map(i => [i.id, i]))
  const metaDe = (id: string): MetaDeLineaParaIva | undefined => {
    const item = porId.get(id)
    if (!item) return undefined
    return {
      nombre: item.nombre,
      baseIva: item.base_iva ?? null,
      esDeLaAgencia: item.id === recargo?.id || item.es_ajuste === true,
    }
  }
  const opciones = {
    tarifaPct: tarifaIvaDelVendedor(perfil),
    descuentoComercialPct: ctx.params.descuentoComercialPct,
    // Encima o adentro del precio: la misma cuenta que hace el editor con su pantalla.
    precio: args.config.precio,
  }

  const todas = liquidarIva(lineasParaIva(calcularCascada(ctx.items, ctx.params).lineas, metaDe), opciones)
  const vigente = liquidarIva(lineasParaIva(cascadaVigente(ctx, filas).lineas, metaDe), opciones)

  // Una línea sin costo solo importa si el cliente la puede comprar: la cotización de hoy
  // o una de las tarifas que salen en la propuesta. Una alternativa descartada no frena.
  const sinCosto = new Set(vigente.sinCosto)
  const porTarifa = new Map<string, LiquidacionIva>()
  for (const fila of filas ?? []) {
    if (!fila.vaEnPropuesta) continue
    const tarifa = liquidarIva(
      lineasParaIva(cascadaDeItinerario(ctx.items, fila.seleccion, ctx.params).lineas, metaDe),
      opciones,
    )
    porTarifa.set(fila.id, tarifa)
    for (const nombre of tarifa.sinCosto) sinCosto.add(nombre)
  }

  return {
    config: args.config,
    perfil,
    porItem: new Map(todas.lineas.map(l => [l.id, l])),
    vigente,
    porTarifa,
    calculable: sinCosto.size === 0,
    sinCosto: [...sinCosto],
  }
}

/**
 * Lo que «Aprobar» escribe en `negocios.precio_aprobado`: lo que el cliente paga.
 *
 * Con la base apagada es `valor_total`, exactamente lo de siempre. Con la base encendida
 * y el IVA encima (`iva_aparte`) es `valor_total` + el IVA sobre el ingreso propio; con el
 * IVA adentro (`iva_incluido`) es `valor_total` a secas, porque el precio ya lo trae. En los
 * dos casos es el mismo TOTAL que imprime el PDF, así que el cobro y el documento no pueden
 * decir cifras distintas.
 *
 * Si el IVA no se puede calcular (una línea sin costo), no se aprueba, tampoco con el IVA
 * adentro: el precio sería el correcto, pero la cotización no tiene un documento que se
 * pueda enviar (el PDF sale como borrador) y aprobarla fijaría un cobro cuyo IVA nadie sabe.
 */
export async function precioAprobadoDeCotizacion(
  supabase: Supabase,
  args: { workspaceId: string; cotizacionId: string; valorTotal: number | null },
): Promise<{ ok: true; precio: number | null } | { ok: false; error: string }> {
  const { data: ws } = await supabase
    .from('workspaces')
    .select('config_extra')
    .eq('id', args.workspaceId)
    .maybeSingle()
  const config = leerConfigIvaCotizacion((ws as { config_extra?: unknown } | null)?.config_extra)
  if (!ivaSobreIngresoPropio(config)) return { ok: true, precio: args.valorTotal }

  const iva = await ivaDeLaCotizacion(supabase, { ...args, config })
  if (!iva) return { ok: false, error: 'No se pudo leer la cotización para calcular su IVA' }
  if (!iva.calculable) return { ok: false, error: motivoIvaSinCalcular(iva.sinCosto) }
  if (ivaIncluidoEnElPrecio(config)) return { ok: true, precio: args.valorTotal }
  return { ok: true, precio: (Number(args.valorTotal) || 0) + iva.vigente.iva }
}

/** Una tarifa de la propuesta con lo que costaría si el cliente la escoge. */
export interface PrecioDeTarifa {
  itinerarioId: string
  nombre: string | null
  orden: number
  esRecomendada: boolean
  /**
   * El precio de su cascada: la misma cifra de la tabla de tarifas. Con el IVA encima
   * (`iva_aparte`) no lo trae; con el IVA adentro (`iva_incluido`, #831) ya lo trae.
   */
  precioCascada: number
  /**
   * El IVA sobre el ingreso propio de SUS líneas: el que se SUMA con `iva_aparte` y el que
   * va ADENTRO con `iva_incluido`. 0 con la base apagada.
   */
  iva: number
  /**
   * Lo que «Aprobar» escribe en `negocios.precio_aprobado` si el cliente la escoge. `null`
   * si su IVA no se pudo calcular (una línea con precio y sin costo): no se inventa.
   */
  precio: number | null
  /** Por qué `precio` es `null`, en lenguaje de operadora. */
  motivo: string | null
}

/**
 * Lo que costaría cada tarifa de la propuesta si el cliente la escoge: la pregunta de
 * «Aprobar» cuando la cotización tiene tarifas (decisión del 2026-09-22).
 *
 * Es la MISMA regla que `precioAprobadoDeCotizacion`, aplicada a una tarifa en vez de a
 * `valor_total`: con la base apagada, el precio de su cascada; con `ingreso_propio` y el
 * IVA encima (#830), más el IVA de sus líneas; con el IVA adentro (#831), el precio de su
 * cascada a secas, porque ya lo trae. Es la cifra de su tarjeta en el PDF. Para la
 * Recomendada da exactamente lo de antes, porque su cascada ES `valor_total`
 * (`totalDelPrincipal`).
 *
 * Solo las marcadas «va en propuesta»: son las que el cliente vio en el documento.
 */
export async function preciosDeLasTarifas(
  supabase: Supabase,
  args: { workspaceId: string; cotizacionId: string },
): Promise<{ ok: true; tarifas: PrecioDeTarifa[] } | { ok: false; error: string }> {
  const ctx = await contextoDeCotizacion(supabase, args.cotizacionId)
  if (!ctx) return { ok: false, error: 'Cotización no encontrada' }
  const filas = (await leerItinerarios(supabase, args.cotizacionId)) ?? []
  const enPropuesta = [...filas].filter(f => f.vaEnPropuesta).sort((a, b) => a.orden - b.orden)
  if (enPropuesta.length === 0) return { ok: true, tarifas: [] }

  const { data: ws } = await supabase
    .from('workspaces')
    .select('config_extra')
    .eq('id', args.workspaceId)
    .maybeSingle()
  const config = leerConfigIvaCotizacion((ws as { config_extra?: unknown } | null)?.config_extra)
  let iva: IvaDeCotizacion | null = null
  if (ivaSobreIngresoPropio(config)) {
    iva = await ivaDeLaCotizacion(supabase, { ...args, config })
    if (!iva) return { ok: false, error: 'No se pudo leer la cotización para calcular su IVA' }
  }

  return {
    ok: true,
    tarifas: enPropuesta.map(fila => {
      const precioCascada = cascadaDeItinerario(ctx.items, fila.seleccion, ctx.params).precioVenta
      const liq = iva?.porTarifa.get(fila.id) ?? null
      const calculable = !liq || liq.calculable
      const encima = liq && !ivaIncluidoEnElPrecio(config) ? liq.iva : 0
      return {
        itinerarioId: fila.id,
        nombre: fila.nombre,
        orden: fila.orden,
        esRecomendada: esRecomendada(fila.nombre),
        precioCascada,
        iva: liq?.iva ?? 0,
        precio: calculable ? precioCascada + encima : null,
        motivo: calculable ? null : motivoIvaSinCalcular(liq!.sinCosto),
      }
    }),
  }
}
