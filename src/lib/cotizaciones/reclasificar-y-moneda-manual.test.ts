/**
 * H19 y H20 de la prueba Europa (2026-10-14).
 *
 *  · H19: el AVE Madrid→Barcelona se detectó como vuelo y la lectura lo rechazó («la captura no
 *    corresponde a vuelo»): la fila quedaba sin salida. Ahora pregunta qué es.
 *  · H20: el traslado escrito a mano no tenía moneda: un tren en EUR se cargaba convertido a ojo.
 *    Ahora entra en su moneda y la tasa se escribe en la opción, como con un pantallazo.
 *
 * Se vio fallar: sin la rama RX4 de `leerCaptura` la primera prueba queda en «rechazada»; con
 * `moneda: 'COP'` fijo en `crudaDeTrasladoManual` la de EUR cae.
 */
import { describe, expect, it } from 'vitest'

import { lecturaManual, leerTrasladoManual, type TrasladoManual } from './ingreso-manual'
import { MENSAJE_OTRO_TIPO, procesarCaptura, type CambioDeCaptura, type DependenciasDeProceso } from './proceso-captura'
import { ranuraPorSlug } from './ranuras-pantallazo'

function deps(codigo: string): { d: DependenciasDeProceso; cambios: CambioDeCaptura[] } {
  const cambios: CambioDeCaptura[] = []
  return {
    cambios,
    d: {
      detectar: async () => ({ ok: true, tipo: 'vuelo', lugar: null, origen: 'Madrid', destino: 'Barcelona' }),
      leer: async () => ({ ok: false, codigo, mensaje: 'Esta captura no es de vuelo.', detalle: 'Es un tren AVE.' }),
      revisar: () => { throw new Error('no debería revisar') },
      vigente: () => true,
      informar: c => cambios.push(c),
    },
  }
}

describe('H19 · «no es lo que ONE creyó» siempre deja reclasificar', () => {
  it('la lectura que dice que es OTRO tipo pregunta qué es, abierta', async () => {
    const { d, cambios } = deps('RX4')
    await procesarCaptura(d)
    const fin = cambios[cambios.length - 1]
    expect(fin.estado).toEqual({ fase: 'eligiendo_tipo', motivo: `${MENSAJE_OTRO_TIPO} Es un tren AVE.` })
    expect(fin.abierta).toBe(true)
    expect(fin.borrador).toBeNull()
  })

  it('otro rechazo (no es pantalla de precio) sigue como rechazo', async () => {
    const { d, cambios } = deps('RX5')
    await procesarCaptura(d)
    expect(cambios[cambios.length - 1].estado).toMatchObject({ fase: 'rechazada' })
  })
})

const TRASLADO = ranuraPorSlug('traslado_detalle')!
const AVE: TrasladoManual = {
  ruta: 'Madrid - Barcelona', fecha: '2026-12-15', adultos: 2, ninos: 1, infantes: 1, cobro: 'por_vehiculo',
  precio: 'por_trayecto', neto: 480, netoNino: null, netoInfante: null, idaYRegreso: false, fuente: 'Renfe',
}

describe('H20 · el traslado a mano lleva su moneda', () => {
  it('en EUR, la lectura queda en EUR con el valor escrito (la tasa se pone en la opción)', () => {
    const r = lecturaManual({ ranura: TRASLADO, entrada: { tipo: 'traslado', datos: { ...AVE, moneda: 'EUR' } }, leidaEn: '2026-10-14T15:00:00Z', hoy: '2026-10-14' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lectura.moneda).toBe('EUR')
    expect(r.lectura.total).toBe(480)
  })

  it('sin moneda es COP, como antes; una moneda desconocida también', () => {
    expect(leerTrasladoManual({ ...AVE }).moneda).toBe('COP')
    expect(leerTrasladoManual({ ...AVE, moneda: 'eur' }).moneda).toBe('EUR')
    expect(leerTrasladoManual({ ...AVE, moneda: 'BTC' }).moneda).toBe('COP')
    const r = lecturaManual({ ranura: TRASLADO, entrada: { tipo: 'traslado', datos: AVE }, leidaEn: '2026-10-14T15:00:00Z', hoy: '2026-10-14' })
    expect(r.ok && r.lectura.moneda).toBe('COP')
  })
})
