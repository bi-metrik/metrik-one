/**
 * H23 de la prueba Europa (2026-10-14): un traslado privado (mismo precio para 3 o 4 pasajeros)
 * pedía la resta de 3 pantallazos y quedaba en $0 con «Falta el costo»; escrito a mano, el aviso
 * «Falta el 2» seguía. Regla: en un traslado, el total del pantallazo del grupo es el costo.
 * Cifras inventadas.
 *
 * Se vio fallar: sin `trasladoPorGrupo` en `casillasDe` y en `resolverTarifa`, las dos primeras
 * pruebas caen (pide «Sin el infante» y queda en `falta`).
 */
import { describe, expect, it } from 'vitest'

import { lecturaManual, type TrasladoManual } from './ingreso-manual'
import { ranuraPorSlug } from './ranuras-pantallazo'
import { casillasDe, resolverTarifa, type LecturaCasilla } from './tarifa-pasajero'

const TRASLADO = ranuraPorSlug('traslado_detalle')!
const GRUPO = { adultos: 2, ninos: 1, infantes: 1 }

function traslado(over: Partial<TrasladoManual> = {}): LecturaCasilla {
  const r = lecturaManual({
    ranura: TRASLADO,
    entrada: {
      tipo: 'traslado',
      datos: {
        ruta: 'Aeropuerto Barajas - Hotel', fecha: '2026-12-11', adultos: 2, ninos: 1, infantes: 1, cobro: 'por_vehiculo',
        precio: 'por_trayecto', neto: 612_000, netoNino: null, netoInfante: null, idaYRegreso: false, fuente: 'Prueba', ...over,
      },
    },
    leidaEn: '2026-10-14T15:00:00Z',
    hoy: '2026-10-14',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

describe('H23 · un traslado por vehículo no pide la resta', () => {
  it('solo se pide un pantallazo: el del grupo', () => {
    expect(casillasDe(GRUPO, 'traslado_detalle').map(c => c.clave)).toEqual(['grupo_completo'])
    // El hotel sigue pidiendo la resta: es otra regla.
    expect(casillasDe(GRUPO, 'hotel_detalle').length).toBeGreaterThan(1)
  })

  it('el costo es el total del pantallazo, repartido entre los 4 sin perder un peso', () => {
    const e = resolverTarifa(GRUPO, { grupo_completo: traslado() }, 'traslado_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costoTotal).toBe(612_000)
    expect(e.costos.reduce((a, c) => a + c.total, 0)).toBeCloseTo(612_000, 2)
    expect(e.costos.map(c => [c.tipo, c.cantidad])).toEqual([['adulto', 2], ['nino', 1], ['infante', 1]])
  })

  it('un proveedor que sí separa por persona conserva su desglose', () => {
    const porPersona = traslado({ cobro: 'por_persona', neto: 100_000, netoNino: 50_000, netoInfante: 0 })
    const e = resolverTarifa(GRUPO, { grupo_completo: porPersona }, 'traslado_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.origen).toBe('desglose')
    expect(e.costoTotal).toBe(250_000)
  })
})
