import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  checksumEvento,
  codigoDesdeSku,
  completarTransaccion,
  fechaPagoBogota,
  leerTransaccion,
  verificarEventoWompi,
  type EventoWompi,
} from './wompi'

/** Secreto de PRUEBA con la forma de los de Wompi. No es de ningún comercio. */
const SECRETO = 'test_events_PruebaMetrikFerreteria0000000001'

function eventoFirmado(transaction: Record<string, unknown>, opciones: { secreto?: string; environment?: string; timestamp?: number } = {}) {
  const evento: EventoWompi = {
    event: 'transaction.updated',
    data: { transaction },
    environment: opciones.environment ?? 'prod',
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp: opciones.timestamp ?? 1790627311,
    sent_at: '2026-09-28T16:30:00.000Z',
  }
  evento.signature.checksum = checksumEvento(evento, opciones.secreto ?? SECRETO)
  return evento
}

const TX = {
  id: '1234-1790627311-49201',
  amount_in_cents: 32_190_000,
  reference: 'SoXVSa_1790627311_S6Wh9yfN4',
  customer_email: 'luis@example.com',
  currency: 'COP',
  payment_method_type: 'NEQUI',
  status: 'APPROVED',
  payment_link_id: 'SoXVSa',
  finalized_at: '2026-09-29T03:10:00.000Z',
  customer_data: { full_name: 'Luis Carlos Gómez', phone_number: '573001112233', legal_id: '1020304050', legal_id_type: 'CC' },
  shipping_address: { address_line_1: 'Calle 45 # 23-10', city: 'Medellín', region: 'Antioquia', country: 'CO', phone_number: '573001112233' },
}

describe('firma de los eventos de Wompi', () => {
  it('concatena propiedades (en el orden del evento) + timestamp + secreto y saca SHA256', () => {
    // Vector calculado aparte con Python (hashlib) sobre la cadena del ejemplo de la documentación:
    // "1234-1610641025-49201" + "APPROVED" + "4490000" + "1530291411" + secreto del ejemplo.
    const ejemplo = {
      data: { transaction: { id: '1234-1610641025-49201', status: 'APPROVED', amount_in_cents: 4490000 } },
      signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
      timestamp: 1530291411,
    }
    expect(checksumEvento(ejemplo, 'prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z')).toBe(
      '5A18EC5E8FDB7DF463E9F94774CBA8F583BA21BD04A09CEFF2EA68A4BC0AEFBE',
    )
    // El orden lo manda el evento, no el código: otro orden, otra cadena.
    const otroOrden = { ...ejemplo, signature: { ...ejemplo.signature, properties: ['transaction.status', 'transaction.id', 'transaction.amount_in_cents'] } }
    const esperado = createHash('sha256').update('APPROVED1234-1610641025-4920144900001530291411x').digest('hex').toUpperCase()
    expect(checksumEvento(otroOrden, 'x')).toBe(esperado)
  })

  it('acepta un evento bien firmado (checksum en el cuerpo, en minúsculas o solo en la cabecera)', () => {
    const e = eventoFirmado(TX)
    expect(verificarEventoWompi(JSON.stringify(e), SECRETO).ok).toBe(true)
    const minusculas = { ...e, signature: { ...e.signature, checksum: e.signature.checksum.toLowerCase() } }
    expect(verificarEventoWompi(JSON.stringify(minusculas), SECRETO).ok).toBe(true)
    const sinCuerpo = { ...e, signature: { properties: e.signature.properties } }
    expect(verificarEventoWompi(JSON.stringify(sinCuerpo), SECRETO, e.signature.checksum).ok).toBe(true)
  })

  it('rechaza un monto alterado, otro secreto, otra marca de tiempo y cabecera que contradice al cuerpo', () => {
    const e = eventoFirmado(TX)
    const alterado = JSON.parse(JSON.stringify(e))
    alterado.data.transaction.amount_in_cents = 100
    expect(verificarEventoWompi(JSON.stringify(alterado), SECRETO)).toEqual({ ok: false, motivo: 'firma_invalida' })
    expect(verificarEventoWompi(JSON.stringify(e), 'prod_events_otro')).toEqual({ ok: false, motivo: 'firma_invalida' })
    expect(verificarEventoWompi(JSON.stringify({ ...e, timestamp: 1790627312 }), SECRETO)).toEqual({ ok: false, motivo: 'firma_invalida' })
    expect(verificarEventoWompi(JSON.stringify(e), SECRETO, 'ABC')).toEqual({ ok: false, motivo: 'firma_invalida' })
  })

  it('un evento de sandbox firmado con otro secreto no pasa con el de producción', () => {
    const sandbox = eventoFirmado(TX, { secreto: 'test_events_otro', environment: 'test' })
    expect(verificarEventoWompi(JSON.stringify(sandbox), SECRETO).ok).toBe(false)
  })

  it('sin firma o sin cuerpo JSON no hay nada que verificar', () => {
    expect(verificarEventoWompi('no es json', SECRETO)).toEqual({ ok: false, motivo: 'cuerpo_invalido' })
    const e = eventoFirmado(TX)
    expect(verificarEventoWompi(JSON.stringify({ ...e, signature: { properties: [], checksum: 'X' } }), SECRETO)).toEqual({ ok: false, motivo: 'firma_ausente' })
    expect(verificarEventoWompi(JSON.stringify({ ...e, signature: { properties: e.signature.properties } }), SECRETO)).toEqual({ ok: false, motivo: 'firma_ausente' })
  })
})

describe('lectura de la transacción', () => {
  it('saca monto, link, comprador (con documento) y envío', () => {
    const tx = leerTransaccion(eventoFirmado(TX))!
    expect(tx).toMatchObject({
      id: TX.id,
      estado: 'APPROVED',
      entorno: 'prod',
      montoCentavos: 32_190_000,
      moneda: 'COP',
      paymentLinkId: 'SoXVSa',
      pagadoAt: '2026-09-29T03:10:00.000Z',
      comprador: { nombre: 'Luis Carlos Gómez', email: 'luis@example.com', telefono: '573001112233', documento: 'CC 1020304050' },
      envio: { direccion: 'Calle 45 # 23-10', ciudad: 'Medellín', region: 'Antioquia' },
    })
  })

  it('el documento también sale del campo propio «Cedula o NIT» del link', () => {
    const tx = leerTransaccion(
      eventoFirmado({ ...TX, customer_data: { full_name: 'Ana', customer_references: [{ label: 'Cedula o NIT', value: '900123456' }] } }),
    )!
    expect(tx.comprador.documento).toBe('900123456')
  })

  it('tolera lo que falta: sin link, sin comprador, sin envío; entorno desconocido = sandbox', () => {
    const tx = leerTransaccion({ event: 'transaction.updated', data: { transaction: { id: 'x-1', status: 'DECLINED', amount_in_cents: 100 } } })!
    expect(tx).toMatchObject({ estado: 'DECLINED', entorno: 'test', paymentLinkId: null, envio: null, comprador: { nombre: null, documento: null } })
  })

  it('no es una transacción: otro evento, sin id o con un estado que no existe', () => {
    expect(leerTransaccion({ event: 'nequi_token.updated', data: { transaction: TX } })).toBeNull()
    expect(leerTransaccion({ event: 'transaction.updated', data: { transaction: { ...TX, id: '' } } })).toBeNull()
    expect(leerTransaccion({ event: 'transaction.updated', data: { transaction: { ...TX, status: 'OTRO' } } })).toBeNull()
  })

  it('completar solo llena huecos y solo con la misma transacción', () => {
    const pobre = leerTransaccion(eventoFirmado({ ...TX, customer_data: null, shipping_address: null }))!
    const llena = completarTransaccion(pobre, TX)
    expect(llena.comprador.nombre).toBe('Luis Carlos Gómez')
    expect(llena.envio?.ciudad).toBe('Medellín')
    expect(completarTransaccion(pobre, { ...TX, id: 'otra' }).comprador.nombre).toBeNull()
  })
})

describe('fecha y código', () => {
  it('el día del pago es el de Bogotá (03:10 UTC del 29 = 28 en Bogotá)', () => {
    expect(fechaPagoBogota('2026-09-29T03:10:00.000Z', '2026-09-29T12:00:00.000Z')).toBe('2026-09-28')
    expect(fechaPagoBogota('2026-09-29 03:10:00 UTC', '2026-09-29T12:00:00.000Z')).toBe('2026-09-28')
    expect(fechaPagoBogota(null, '2026-09-29T12:00:00.000Z')).toBe('2026-09-29')
    expect(fechaPagoBogota('basura', '2026-09-29T12:00:00.000Z')).toBe('2026-09-29')
  })

  it('el sku del link se lee como código de publicación', () => {
    expect(codigoDesdeSku(' mp-26 ')).toBe('MP-26')
    expect(codigoDesdeSku('')).toBeNull()
    expect(codigoDesdeSku(null)).toBeNull()
  })
})
