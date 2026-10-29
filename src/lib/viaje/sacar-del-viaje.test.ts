/** Confirmaciones del tablero de servicios (QA 2026-10-29: N9-9, H9-3, H9-4). */
import { describe, expect, it } from 'vitest'
import { confirmacionCambioLocalizador, confirmacionSacarDelViaje, rastroCambioLocalizador, rastroSacarDelViaje } from './sacar-del-viaje'

describe('sacar un servicio del viaje (N9-9, H9-3)', () => {
  it('pregunta con el efecto en la plata', () => {
    expect(confirmacionSacarDelViaje({ nombre: 'Air France MAD-PAR', costoCotizado: 2_947_500, pagadoProveedor: 0 })).toBe(
      '¿Estás seguro? Vas a sacar «Air France MAD-PAR» del viaje. Va en el precio que aceptó el cliente con un costo de $2.947.500: el precio y el plan de pagos no cambian solos, y esa plata queda como margen hasta que se decida si se le devuelve al cliente.',
    )
    expect(confirmacionSacarDelViaje({ nombre: 'Tren', costoCotizado: 0, pagadoProveedor: 500_000 })).toBe(
      '¿Estás seguro? Vas a sacar «Tren» del viaje. Al proveedor ya se le pagaron $500.000: pide la devolución o queda como costo del viaje.',
    )
  })

  it('deja rastro al sacar y al devolver', () => {
    expect(rastroSacarDelViaje({ nombre: 'Air France', costoCotizado: 2_947_500, pagadoProveedor: 0, vuelve: false })).toBe(
      'Sacado del viaje: Air France (cotizado $2.947.500). El precio y el plan de pagos no cambiaron: esos $2.947.500 quedan en el margen hasta decidir si se devuelven al cliente.',
    )
    expect(rastroSacarDelViaje({ nombre: 'Air France', costoCotizado: 1, pagadoProveedor: 0, vuelve: true })).toBe('Volvió al viaje: Air France.')
  })
})

describe('localizador ya guardado (H9-4)', () => {
  it('cambiarlo o borrarlo se confirma; ponerlo por primera vez, no', () => {
    expect(confirmacionCambioLocalizador(null, 'IBP-662310')).toBeNull()
    expect(confirmacionCambioLocalizador('IBP-662310', 'IBP-662310')).toBeNull()
    expect(confirmacionCambioLocalizador('IBP-662310', 'HQ-88123')).toBe('¿Estás seguro? Este servicio ya tiene el localizador IBP-662310: lo vas a cambiar por HQ-88123.')
    expect(confirmacionCambioLocalizador('IBP-662310', '')).toBe('¿Estás seguro? Vas a borrar el localizador IBP-662310 de este servicio.')
    expect(rastroCambioLocalizador('Ibis París', 'IBP-662310', 'HQ-88123')).toBe('Ibis París: localizador IBP-662310 cambiado por HQ-88123.')
    expect(rastroCambioLocalizador('Ibis París', null, 'HQ-88123')).toBeNull()
  })
})
