/**
 * Los menores que vio Vera en la re-verificación D (2026-10-14, «Observaciones nuevas»).
 */
import { describe, expect, it } from 'vitest'

import { resolverTarifa, type LecturaCasilla } from './tarifa-pasajero'
import { autorizacionDeLaSalida, CAUSA_RETIRADA, textoDePerdida } from './autorizacion-vista'
import { listaUnica, type EntradaDeLista } from './lista-unica'
import { nombreNuevo, pistasConLugarDelServicio } from './bandeja-por-pasos'
import { onceDelCasoFijo } from '../../../test/caso-once-pantallazos'

const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }

/** SATENA con un solo total para el grupo (el pantallazo de «solo adultos» de V4). */
const satena = {
  moneda: 'COP', total: 2_821_884, aPagarAgencia: null, porTipo: [],
  ocupacion: { adultos: 6, ninos: 1, infantes: 1, total: 8 }, ocupacionDelItem: false,
  identidad: { aerolinea: 'SATENA' }, notasCliente: [], alertas: [], campos: [],
  nombre: 'SATENA', descripcion: '', leidaEn: '2026-10-14T12:00:00.000Z', paraComposicion: VIAJE,
} as unknown as LecturaCasilla

describe('después de «Completa», la tarjeta de SATENA pide solo lo que falta', () => {
  it('sin nada escrito: el mensaje de siempre (TP4)', () => {
    const e = resolverTarifa(VIAJE, { grupo_completo: satena }, 'vuelo_detalle')
    expect(e.estado).toBe('falta')
    expect(e.mensaje).toBe('Este pantallazo tiene un solo total para el grupo. Falta el 2: busca con 6 adultos y 1 niño.')
  })

  it('con el niño completado: falta el precio del infante, no «busca con 6 adultos y 1 niño»', () => {
    const e = resolverTarifa(VIAJE, { grupo_completo: satena }, 'vuelo_detalle', { aMano: { nino: 470_312 } })
    expect(e.estado).toBe('falta')
    expect(e.mensaje).toBe('Falta el precio del infante: escríbelo o pega su pantallazo.')
  })

  it('con el infante «No paga»: resuelta, igual que en el servidor', () => {
    const e = resolverTarifa(VIAJE, { grupo_completo: satena }, 'vuelo_detalle', { aMano: { nino: 470_312, infante: 0 } })
    expect(e.estado).toBe('resuelta')
  })
})

describe('al retirar la autorización, dice que la retiró el dueño', () => {
  const salida = (perdida: unknown) => ({
    aplica: true, bloquea: true, dueno: 'Dueña', puedeAutorizar: true, esDueno: true,
    excepcion: null, perdida, excepcionesDisponibles: true,
  })
  it('retirada por el dueño', () => {
    expect(textoDePerdida({ causa: CAUSA_RETIRADA })).toBe('El dueño retiró la autorización.')
    expect(autorizacionDeLaSalida(salida({ causa: CAUSA_RETIRADA }), null)?.textoPerdida).toBe('El dueño retiró la autorización.')
  })
  it('perdida por un cambio: como siempre', () => {
    expect(autorizacionDeLaSalida(salida({ causa: 'Cambió el margen de la Premium.' }), null)?.textoPerdida)
      .toBe('La autorización se perdió: cambió el margen o un costo.')
    expect(autorizacionDeLaSalida(salida(null), null)?.textoPerdida).toBeNull()
  })
})

describe('la lista no manda a un párrafo marcado que no existe', () => {
  const base: EntradaDeLista = {
    sinPrecio: [], capturas: null, tarifas: [], salida: null, pantallazosPorAceptar: 0, texto: 'viejo',
    noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
  }
  const texto = (e: Partial<EntradaDeLista>) => listaUnica({ ...base, ...e }).revisar.find(r => r.clave === 'texto')?.texto
  it('ningún párrafo nombra lo que salió', () => {
    expect(texto({ parrafosMarcados: 0 })).toBe('El texto se escribió con otros servicios: léelo o actualízalo con ONE.')
  })
  it('hay un párrafo marcado, o no se sabe: como siempre', () => {
    expect(texto({ parrafosMarcados: 1 })).toBe('El texto se escribió con otros servicios: revisa el párrafo marcado.')
    expect(texto({})).toBe('El texto se escribió con otros servicios: revisa el párrafo marcado.')
  })
})

describe('el pantallazo que vuelve a la bandeja conserva «en San Andrés»', () => {
  const sinLugar = { lugar: null, origen: null, destino: null }
  it('toma el lugar del servicio del que salió', () => {
    const traslado = onceDelCasoFijo().find(p => p.tipo === 'traslado' && /San Andr/i.test(JSON.stringify(p.lectura)))!
    const pistas = pistasConLugarDelServicio(sinLugar, 'traslado 2: Traslado en San Andrés')
    expect(pistas.lugar).toBe('San Andrés')
    const b = { tipo: 'traslado' as const, lectura: traslado.lectura, lecturaJson: '', firma: '', pistas }
    expect(nombreNuevo(b, 'San Andrés y Providencia')).toBe('Traslado en San Andrés')
    // Antes: «Traslado», sin el lugar.
    expect(nombreNuevo({ ...b, pistas: sinLugar }, 'San Andrés y Providencia')).toBe('Traslado')
  })
  it('una pista con lugar no se toca; un vuelo no se nombra por lugar', () => {
    expect(pistasConLugarDelServicio({ ...sinLugar, lugar: 'Providencia' }, 'traslado: Traslado en San Andrés').lugar).toBe('Providencia')
    expect(pistasConLugarDelServicio(sinLugar, 'vuelo: Vuelo en San Andrés').lugar).toBeNull()
    expect(pistasConLugarDelServicio(sinLugar, 'traslado: Traslado').lugar).toBeNull()
  })
})
