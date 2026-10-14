/**
 * H9 de la prueba Europa (2026-10-14): un vuelo con escala (Air France BOG→CDG→MAD) abría
 * «Vuelo 2» en vez de entrar como opción del bloque BOG→MAD, y la ida se cobraba dos veces.
 *
 * Regla: es opción del mismo bloque si sale de la misma ciudad, llega al mismo destino FINAL y
 * sale el mismo día. Las escalas no cuentan. Cifras y vuelos inventados.
 *
 * Se vio fallar:
 *  · con `lugarDeOpcion` tomando el destino del PRIMER tramo, el caso de tramos guardados cae;
 *  · con `mismoLugar` sin la ciudad del código, el caso «MAD» contra «Madrid» cae.
 */
import { describe, expect, it } from 'vitest'

import { lecturaManual, type VueloManual } from './ingreso-manual'
import { ranuraPorSlug } from './ranuras-pantallazo'
import { mismoLugar } from './bandeja-capturas'
import { ubicarLectura, type LineaParaUbicar } from './ubicar-lectura'
import type { LecturaCasilla } from './tarifa-pasajero'

const VUELO = ranuraPorSlug('vuelo_detalle')!
const SIN_PISTAS = { lugar: null, origen: null, destino: null }
const GRUPO = { adultos: 2, ninos: 1, infantes: 1 }

function vuelo(over: Partial<VueloManual> = {}): LecturaCasilla {
  const r = lecturaManual({
    ranura: VUELO,
    entrada: {
      tipo: 'vuelo',
      datos: {
        aerolinea: 'Avianca', origen: 'Bogotá BOG', destino: 'Madrid MAD', ida: '2026-12-10', horaSalida: '', horaLlegada: '',
        numero: '', tarifa: '', regreso: '', horaSalidaRegreso: '', horaLlegadaRegreso: '', numeroRegreso: '',
        adultos: 2, ninos: 1, infantes: 1, netoAdulto: 3_000_000, netoNino: 2_500_000, netoInfante: 400_000, fuente: '', ...over,
      },
    },
    leidaEn: '2026-10-14T15:00:00Z',
    hoy: '2026-10-14',
    fuenteOpcional: true,
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

const avianca: LineaParaUbicar = { id: 'av', grupo: 'vuelo', tarifa_pax: { casillas: { grupo_completo: vuelo() } } }

describe('H9 · un vuelo con escala del mismo trayecto es OPCIÓN, no un bloque que suma', () => {
  it('Air France BOG→(CDG)→MAD el mismo día entra como opción de Avianca BOG→MAD', () => {
    const airFrance = vuelo({ aerolinea: 'Air France', destino: 'Madrid MAD' })
    // El detector nombró la llegada del primer tramo: la lectura (destino final) manda.
    const pistas = { lugar: null, origen: 'Bogotá', destino: 'París (CDG)' }
    expect(ubicarLectura({ tipo: 'vuelo', lectura: airFrance, pistas, lineas: [avianca], grupoViaje: GRUPO })).toEqual({ como: 'hermana', grupo: 'vuelo' })
  })

  it('con la escala guardada como dos tramos de ida, cuenta el destino del ÚLTIMO', () => {
    const tramos = [
      { sentido: 'ida', origen: 'Bogotá BOG', destino: 'París CDG', fecha: '2026-12-10', salida: null, llegada: null, numero: null, escala: null, directo: null, equipaje: { personal: null, mano: null, bodega: null } },
      { sentido: 'ida', origen: 'París CDG', destino: 'Madrid MAD', fecha: '2026-12-11', salida: null, llegada: null, numero: null, escala: null, directo: null, equipaje: { personal: null, mano: null, bodega: null } },
    ]
    const conEscala: LineaParaUbicar = { id: 'af', grupo: 'vuelo', tarifa_pax: { casillas: { grupo_completo: vuelo({ aerolinea: 'Air France' }) } }, tramos }
    const iberia = vuelo({ aerolinea: 'Iberia' })
    expect(ubicarLectura({ tipo: 'vuelo', lectura: iberia, pistas: SIN_PISTAS, lineas: [conEscala], grupoViaje: GRUPO })).toEqual({ como: 'hermana', grupo: 'vuelo' })
  })

  it('el regreso AMS→BOG no es opción de la ida BOG→MAD', () => {
    const regreso = vuelo({ origen: 'Ámsterdam AMS', destino: 'Bogotá BOG', ida: '2026-12-28' })
    expect(ubicarLectura({ tipo: 'vuelo', lectura: regreso, pistas: SIN_PISTAS, lineas: [avianca], grupoViaje: GRUPO })).toEqual({ como: 'nueva' })
  })

  it('la misma ruta OTRO día es otro tramo del viaje: suma aparte', () => {
    const otroDia = vuelo({ ida: '2026-12-20' })
    expect(ubicarLectura({ tipo: 'vuelo', lectura: otroDia, pistas: SIN_PISTAS, lineas: [avianca], grupoViaje: GRUPO })).toEqual({ como: 'nueva' })
  })

  it('el código y el nombre de la misma ciudad son el mismo lugar', () => {
    expect(mismoLugar('MAD', 'Madrid')).toBe(true)
    expect(mismoLugar('Paris', 'CDG')).toBe(true)
    expect(mismoLugar('MAD', 'Barcelona')).toBe(false)
    // Un código que no se conoce no se adivina.
    expect(mismoLugar('XYZ', 'Madrid')).toBeNull()
  })
})
