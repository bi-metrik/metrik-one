// ============================================================
// La LECTURA de plata de una cotización, corrida sobre el doble de igualdad: lo mismo que fija
// C0 (`igualdad-servidor-e2e.test.ts`), empaquetado para la PRUEBA DE IDA Y VUELTA de la etapa C:
// una cotización armada con el interruptor encendido se abre, suma, imprime y se aprueba igual con
// el interruptor apagado.
//
// Las funciones del servidor se reciben por parámetro: las importa la prueba DESPUÉS de sus
// `vi.mock` (el doble de sesión, la captura de props del PDF), que aquí no se pueden declarar.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

import path from 'node:path'

import { base, escrituras, tomarRegistro, type Fila, type Ida } from './igualdad-servidor-doble'

export interface Lectores {
  recalcularTotales: (cotizacionId: string) => Promise<unknown>
  generateCotizacionPDF: (cotizacionId: string) => Promise<unknown>
  opcionesDeAprobacion: (cotizacionId: string) => Promise<unknown>
  aceptarCotizacionNegocio: (cotizacionId: string, negocioId: string, tarifa: string | null) => Promise<unknown>
}

export interface CapturaPdf { activa: boolean; props: unknown }

const RAIZ_REPO = path.resolve(__dirname, '..')
export const plano = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null).split(RAIZ_REPO).join('<repo>'))

function ordenadas(registro: readonly Ida[]): Ida[] {
  return [...escrituras(registro)].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

/** Prende o apaga `cotizacion_por_pasos.activo` en el workspace del doble, sin tocar lo demás. */
export function ponerInterruptor(encendido: boolean): void {
  for (const ws of base.tablas.workspaces ?? []) {
    const extra = { ...((ws.config_extra ?? {}) as Fila) }
    const actual = (extra.cotizacion_por_pasos ?? {}) as Fila
    extra.cotizacion_por_pasos = { ...actual, activo: encendido }
    ws.config_extra = extra
  }
}

/**
 * Total, precio de cada tarifa, props del PDF y aprobación, sobre las tablas que haya en el doble.
 * Escribe (el recálculo, el PDF y la aprobación escriben): quien la use parte de una copia.
 */
export async function leerPlata(
  l: Lectores,
  captura: CapturaPdf,
  args: { cotizacionId: string; negocioId: string; tarifaAprobada: string | null },
): Promise<{ recalculo: unknown; tarifas: unknown; pdf: unknown; aprobacion: unknown }> {
  tomarRegistro()
  const resRecalculo = await l.recalcularTotales(args.cotizacionId)
  const regRecalculo = tomarRegistro()
  const c = base.tablas.cotizaciones.find(x => x.id === args.cotizacionId) as Fila
  const recalculo = {
    resultado: resRecalculo,
    escrituras: ordenadas(regRecalculo),
    cotizacion: { valor_total: c.valor_total, costo_total: c.costo_total, descuento_valor: c.descuento_valor },
  }
  const tarifas = await l.opcionesDeAprobacion(args.cotizacionId)
  tomarRegistro()
  captura.activa = true
  captura.props = null
  const resPdf = (await l.generateCotizacionPDF(args.cotizacionId)) as Fila
  captura.activa = false
  const regPdf = tomarRegistro()
  const { pdf: _bytes, ...resultadoPdf } = resPdf
  void _bytes
  const pdf = { props: captura.props, resultado: resultadoPdf, escrituras: ordenadas(regPdf) }
  const resAprobar = await l.aceptarCotizacionNegocio(args.cotizacionId, args.negocioId, args.tarifaAprobada)
  const regAprobar = tomarRegistro()
  const aprobacion = {
    resultado: resAprobar,
    precio_aprobado: (base.tablas.negocios.find(n => n.id === args.negocioId) as Fila).precio_aprobado,
    escrituras: ordenadas(regAprobar),
  }
  return plano({ recalculo, tarifas, pdf, aprobacion })
}
