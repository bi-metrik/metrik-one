import { describe, expect, it } from 'vitest'
import {
  AVISO_INTERNO_PARA,
  avisarFallaCron,
  correoAvisoLote,
  correoFallaCron,
  debeVigilarLotes,
  fallasDeResumen,
  lotesParaAvisar,
  vigilarLotesValida,
  type LoteVigilado,
} from './vigias'

const AHORA = Date.parse('2026-10-26T15:00:00Z')
const haceMin = (m: number) => new Date(AHORA - m * 60_000).toISOString()

function lote(estado: string, minutos: number, extra: Partial<LoteVigilado> = {}): LoteVigilado {
  return {
    id: `lote-${estado}-${minutos}`,
    workspace_id: 'ws-1',
    estado,
    motivo_pausa: estado === 'pausado' ? 'bolsa_agotada' : null,
    detalle_pausa: null,
    total: 5000,
    procesadas: 1200,
    updated_at: haceMin(minutos),
    ...extra,
  }
}

describe('fallas de un cron', () => {
  it('solo los campos *_error con valor', () => {
    expect(
      fallasDeResumen({ ok: true, cobro_prueba: { x: 1 }, cobro_prueba_error: null, cobro_tarjeta_error: 'ePayco 502', renovacion_por_ciclo_error: '' }),
    ).toEqual(['cobro_tarjeta_error: ePayco 502'])
  })

  it('un correo por cron y por hora (o día): la llave de Resend lo deduplica', () => {
    const a = correoFallaCron('valida-lotes', ['x'], new Date('2026-10-26T15:01:00Z'), 'hora')
    const b = correoFallaCron('valida-lotes', ['y'], new Date('2026-10-26T15:59:00Z'), 'hora')
    const c = correoFallaCron('valida-lotes', ['x'], new Date('2026-10-26T16:00:00Z'), 'hora')
    expect(a.idempotencyKey).toBe(b.idempotencyKey)
    expect(a.idempotencyKey).not.toBe(c.idempotencyKey)
    expect(correoFallaCron('procesar-planes-cobro', ['x'], new Date('2026-10-26T12:00:00Z'), 'dia').idempotencyKey).toBe(
      'one-cron-procesar-planes-cobro-2026-10-26',
    )
    expect(a.to).toBe(AVISO_INTERNO_PARA)
    expect(a.subject).toBe('[ONE] El cron valida-lotes falló')
  })

  it('sin fallas no manda nada; con fallas manda y nunca lanza', async () => {
    const enviados: string[] = []
    const enviar = async (m: { subject: string }) => {
      enviados.push(m.subject)
      return { ok: true as const }
    }
    expect(await avisarFallaCron('x', [], { ventana: 'hora', enviar })).toBe(false)
    expect(await avisarFallaCron('x', ['falla'], { ventana: 'hora', enviar })).toBe(true)
    expect(enviados).toHaveLength(1)
    const revienta = async () => {
      throw new Error('red')
    }
    expect(await avisarFallaCron('x', ['falla'], { ventana: 'hora', enviar: revienta })).toBe(false)
  })
})

describe('cargues masivos quietos', () => {
  it('el vigía corre en los minutos 0, 15, 30 y 45', () => {
    expect(debeVigilarLotes(new Date('2026-10-26T15:00:20Z'))).toBe(true)
    expect(debeVigilarLotes(new Date('2026-10-26T15:45:00Z'))).toBe(true)
    expect(debeVigilarLotes(new Date('2026-10-26T15:07:00Z'))).toBe(false)
  })

  it('pausado de 30 a 59 min y activo sin avanzar de 15 a 44 min; ni antes ni después', () => {
    const avisos = lotesParaAvisar(
      [
        lote('pausado', 29),
        lote('pausado', 30),
        lote('pausado', 59),
        lote('pausado', 60),
        lote('procesando', 14),
        lote('procesando', 15),
        lote('en_cola', 44),
        lote('en_cola', 45),
        lote('completado', 40),
      ],
      AHORA,
    )
    expect(avisos.map((a) => `${a.lote.id}:${a.tipo}`)).toEqual([
      'lote-pausado-30:pausado',
      'lote-pausado-59:pausado',
      'lote-procesando-15:atascado',
      'lote-en_cola-44:atascado',
    ])
  })

  it('el correo dice qué pasa, y la llave es por lote y por estado', () => {
    const [a] = lotesParaAvisar([lote('pausado', 35, { detalle_pausa: 'Saldo en cero' })], AHORA)
    const c = correoAvisoLote(a, 'cda-ejemplo')
    expect(c.subject).toBe('[ONE] Cargue de Valida pausado en cda-ejemplo')
    expect(c.text).toContain('está pausado hace 35 min (motivo: bolsa_agotada — Saldo en cero)')
    expect(c.text).toContain('Avance: 1200 de 5000 filas.')
    expect(c.idempotencyKey).toBe(`one-lote-pausado-lote-pausado-35-${haceMin(35)}`)
  })

  it('vigilarLotesValida: lee, avisa lo que toca y no lanza si la base falla', async () => {
    const enviados: string[] = []
    const enviar = async (m: { subject: string }) => {
      enviados.push(m.subject)
      return { ok: true as const }
    }
    const filas = [lote('pausado', 31), lote('procesando', 20)]
    const consulta = {
      select: () => consulta,
      in: () => consulta,
      lte: () => consulta,
      gte: () => consulta,
      eq: () => consulta,
      limit: async () => ({ data: filas, error: null }),
      maybeSingle: async () => ({ data: { slug: 'cda-ejemplo' }, error: null }),
    }
    const db = { from: () => consulta }
    expect(await vigilarLotesValida(db, { ahoraMs: AHORA, enviar })).toEqual({ revisados: 2, avisados: 2 })
    expect(enviados).toEqual(['[ONE] Cargue de Valida pausado en cda-ejemplo', '[ONE] Cargue de Valida atascado en cda-ejemplo'])

    const caida = { from: () => { throw new Error('sin red') } }
    expect(await vigilarLotesValida(caida, { ahoraMs: AHORA, enviar })).toEqual({ revisados: 0, avisados: 0, error: 'sin red' })
  })
})
