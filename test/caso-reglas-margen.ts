// ============================================================
// Un viaje FICTICIO con las reglas de margen (brief del 2026-10-27): un vuelo nacional para dos,
// tres opciones de hotel (una por tarifa), un paseo, un traslado y un tour de tarifa Pública con su
// comisión. Lo comparten la prueba de la pantalla y el arnés de las capturas del PR.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

import { POLITICA_REGLAS_POR_DEFECTO, type ReglasDeCotizacion } from '@/lib/cotizaciones/reglas-margen'
import type { LineaDeCascada, TarifaDeLaPantalla } from '@/lib/cotizaciones/por-pasos-vista'
import type { ParametrosCascada } from '@/lib/cotizaciones/totales'

const ruta = (origen: string, destino: string) => ({
  casillas: { grupo_completo: { moneda: 'COP', total: 1, campos: [{ label: 'Origen', valor: origen }, { label: 'Destino', valor: destino }] } },
})

function linea(id: string, nombre: string, grupo: string, costo: number, orden: number, extra: Partial<LineaDeCascada> = {}): LineaDeCascada {
  return {
    id, nombre, grupo, opcion_de: null, es_ajuste: false, orden, dia_relativo: null, entra_al_precio: true,
    cantidad: 1, subtotal: costo, numeroDeRubros: 0, costoDeRubros: 0, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_venta: 0, precio_manual: false, base_iva: null, pasajeros: null, tarifa_pax: null, adicionales: [],
    ...extra,
  }
}

/** El descuento del hotel de la Recomendada: 3 puntos (queda en 12 %) o 7 (queda en 8 %, pide autorización). */
export function lineasDelCaso(descuentoRecomendada: 3 | 7 = 3): LineaDeCascada[] {
  return [
    linea('v-ida', 'Vuelo Bogotá San Andrés ida y regreso', 'vuelo', 1_200_000, 1, {
      tarifa_pax: ruta('BOG', 'ADZ'),
      pasajeros: [{ cantidad: 2, peso: 1_200_000 }],
    }),
    linea('h-eco', 'Hotel Ficticio Arena', 'hotel', 2_400_000, 2),
    linea('h-rec', 'Hotel Ficticio Coral', 'hotel', 3_400_000, 3, {
      tarifa_pax: { descuentoCliente: { motivo: 'Reserva esta semana', tipo: 'pct', valor: descuentoRecomendada } },
    }),
    linea('h-pre', 'Hotel Ficticio Brisa Premium', 'hotel', 5_100_000, 4),
    linea('a-lancha', 'Paseo ficticio en lancha', 'actividad', 400_000, 5),
    linea('t-aeropuerto', 'Traslado aeropuerto hotel', 'traslado', 120_000, 6),
    linea('a-tour', 'Tour ficticio por la isla', 'actividad 2', 350_000, 7, {
      margen_porcentaje: 0,
      tarifa_pax: { tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '', comisionPct: 15 } },
    }),
  ]
}

export function reglasDelCaso(r: Partial<ReglasDeCotizacion> = {}): ReglasDeCotizacion {
  return {
    politica: POLITICA_REGLAS_POR_DEFECTO,
    puntosExtra: 5,
    descuentos: [{ id: 'd1', descripcion: 'Cliente recurrente', pct: 2 }],
    ...r,
  }
}

export function paramsDelCaso(r: Partial<ReglasDeCotizacion> = {}): ParametrosCascada {
  return { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta', reglas: reglasDelCaso(r) }
}

export const TARIFAS_DEL_CASO: TarifaDeLaPantalla[] = [
  { id: 'tf-eco', nombre: 'Económica', orden: 1, vaEnPropuesta: true, seleccion: ['h-eco'] },
  { id: 'tf-rec', nombre: 'Recomendada', orden: 2, vaEnPropuesta: true, seleccion: ['h-rec'] },
  { id: 'tf-pre', nombre: 'Premium', orden: 3, vaEnPropuesta: true, seleccion: ['h-pre'] },
]

export const NOMBRES_DEL_CASO: Record<string, string> = {
  'h-eco': 'Hotel Ficticio Arena', 'h-rec': 'Hotel Ficticio Coral', 'h-pre': 'Hotel Ficticio Brisa Premium',
}
