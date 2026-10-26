import { describe, expect, it } from 'vitest'
import {
  autorizadoHasta,
  avisoTiposDocumento,
  filasDesdeXlsx,
  claveIdempotenciaFila,
  concurrenciaDelLote,
  filaConsume,
  lotesSimultaneos,
  partesDelPdf,
  recortarAlSaldo,
  llamadaReintentable,
  FILA_RECLAMO_S,
  TIMEOUT_VALIDA_LOTE_MS,
  TURNO_MS,
  TURNO_RECLAMO_S,
  VALIDA_MAX_DURATION_S,
} from './lote'

describe('autorización del lote', () => {
  it('dos horas si caben en el día de Bogotá', () => {
    expect(autorizadoHasta(new Date('2026-10-15T15:00:00Z')).toISOString()).toBe('2026-10-15T17:00:00.000Z')
  })

  it('nunca más allá de la medianoche de Bogotá (la mora se mide por día)', () => {
    // 22:30 en Bogotá = 03:30 UTC del día siguiente; la medianoche de Bogotá es 05:00 UTC.
    expect(autorizadoHasta(new Date('2026-10-16T03:30:00Z')).toISOString()).toBe('2026-10-16T05:00:00.000Z')
  })
})

describe('bolsa', () => {
  it('una fila sin nombre de 2+ ni documento de 3+ no gasta consulta (Valida la rechaza sin cobrar)', () => {
    expect(filaConsume({ tipo: 'natural', nombre: 'Ana' })).toBe(true)
    expect(filaConsume({ tipo: 'natural', documento: { tipo: 'CC', numero: '123' } })).toBe(true)
    expect(filaConsume({ tipo: 'natural' })).toBe(false)
    expect(filaConsume({ tipo: 'natural', nombre: 'A' })).toBe(false)
  })

  it('recorta al saldo en el orden del archivo, sin contar las que no gastan', () => {
    const filas = [
      { input: { tipo: 'natural' as const, nombre: 'Uno' } },
      { input: { tipo: 'natural' as const } },
      { input: { tipo: 'natural' as const, nombre: 'Dos' } },
      { input: { tipo: 'natural' as const, nombre: 'Tres' } },
    ]
    expect(recortarAlSaldo(filas, 2).map((f) => f.input.nombre ?? '-')).toEqual(['Uno', '-', 'Dos'])
  })
})

describe('ritmo y piezas', () => {
  it('concurrencia: la del lote, la del entorno, o 8; nunca más de 20', () => {
    expect(concurrenciaDelLote(null, undefined)).toBe(8)
    expect(concurrenciaDelLote(null, '6')).toBe(6)
    expect(concurrenciaDelLote(4, '6')).toBe(4)
    expect(concurrenciaDelLote(null, '50')).toBe(8)
    expect(lotesSimultaneos(undefined)).toBe(3)
  })

  it('PDF en partes de 500; llave de idempotencia dentro del límite de Valida (64)', () => {
    expect([0, 1, 500, 501, 10_000].map(partesDelPdf)).toEqual([0, 1, 1, 2, 20])
    expect(claveIdempotenciaFila('00000000-0000-4000-8000-000000000001').length).toBeLessThanOrEqual(64)
  })
})

describe('tipo de documento en el parseo del XLSX', () => {
  // Datos inventados.
  const fila = (tipo_documento: string, numero_documento = '10000001', tipo_persona = 'natural') => ({
    tipo_persona,
    nombre_completo: 'Persona De Prueba',
    tipo_documento,
    numero_documento,
  })

  it('los alias salen con el código de Valida y sin error', () => {
    const [cc, pas, nit] = filasDesdeXlsx([fila('CEDULA'), fila('PP', 'AB123456'), fila('', '900000001', 'juridica')], new Map(), null)
    expect(cc.input.documento).toEqual({ tipo: 'CC', numero: '10000001' })
    expect(pas.input.documento).toEqual({ tipo: 'PAS', numero: 'AB123456' })
    expect(nit.input.documento).toEqual({ tipo: 'NIT', numero: '900000001' })
    expect([cc.error, pas.error, nit.error]).toEqual([null, null, null])
  })

  it('TI, PPT y RC se consultan con su código (metrik-valida#70)', () => {
    const [ti, ppt, rc] = filasDesdeXlsx([fila('Tarjeta de identidad'), fila('ppt'), fila('Registro civil')], new Map(), null)
    expect(ti.input.documento).toEqual({ tipo: 'TI', numero: '10000001' })
    expect(ppt.input.documento).toEqual({ tipo: 'PPT', numero: '10000001' })
    expect(rc.input.documento).toEqual({ tipo: 'RC', numero: '10000001' })
    expect([ti.error, ppt.error, rc.error]).toEqual([null, null, null])
    expect([filaConsume(ti.input), filaConsume(ppt.input), filaConsume(rc.input)]).toEqual([true, true, true])
  })

  it('X conserva lo que dijo la fila, trae la frase y no gasta consulta', () => {
    const [x] = filasDesdeXlsx([fila('x')], new Map(), null)
    expect(x.input.documento).toEqual({ tipo: 'X', numero: '10000001' })
    expect(x.error).toContain('Tipo de documento no reconocido')
    expect(filaConsume(x.input)).toBe(false)
  })

  it('el aviso previo cuenta las filas que no se consultan y da la fila del XLSX', () => {
    const filas = filasDesdeXlsx([fila('CC'), fila('X'), fila('PPT'), fila('PEP'), fila('', '')], new Map(), null)
    expect(avisoTiposDocumento(filas)).toEqual({
      filas: 2,
      ejemplos: [
        { fila: 3, valor: 'X', mensaje: expect.stringContaining('no reconocido') },
        { fila: 5, valor: 'PEP', mensaje: expect.stringContaining('no reconocido') },
      ],
    })
    expect(avisoTiposDocumento(filasDesdeXlsx([fila('CC'), fila('Pasaporte')], new Map(), null))).toBeNull()
  })
})

describe('topes del cargue masivo frente al maxDuration de Valida', () => {
  it('el tope de la llamada pasa el maxDuration de Valida: el reintento nunca corre a la par de la primera', () => {
    expect(TIMEOUT_VALIDA_LOTE_MS).toBeGreaterThan(VALIDA_MAX_DURATION_S * 1000)
  })

  it('el reclamo de la fila cubre dos llamadas con su tope y la espera; el del turno, el turno y una fila en vuelo', () => {
    expect(FILA_RECLAMO_S * 1000).toBeGreaterThanOrEqual(2 * TIMEOUT_VALIDA_LOTE_MS + 2_000)
    expect(TURNO_RECLAMO_S * 1000).toBeGreaterThanOrEqual(TURNO_MS + 2 * TIMEOUT_VALIDA_LOTE_MS + 2_000)
  })

  it('se reintenta un 5xx, un tope o un error de red (sin status); nunca un 4xx', () => {
    expect(llamadaReintentable({ ok: false, status: 503 })).toBe(true)
    expect(llamadaReintentable({ ok: false, status: 500 })).toBe(true)
    expect(llamadaReintentable({ ok: false })).toBe(true)
    expect(llamadaReintentable({ ok: false, status: 400 })).toBe(false)
    expect(llamadaReintentable({ ok: false, status: 402 })).toBe(false)
    expect(llamadaReintentable({ ok: true, status: 200 })).toBe(false)
  })
})
