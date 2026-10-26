import { describe, expect, it } from 'vitest'
import {
  ANTELACION_AVISO_MS,
  antelacionAvisoMs,
  correoAvisoCobro,
  entornoDeCobro,
  fechaYHoraBogota,
  minutosDePruebaAcortada,
  momentoDelCobro,
  pasoDelCobro,
  constanciaConfirmacion,
  correoCobroConfirmado,
  permiteCobroAlConfirmar,
  puedeCancelar,
  textoConfirmacionCobro,
} from './cobro-prueba'

const H = 3_600_000
// Una prueba que abrió un martes a las 15:00 de Bogotá (20:00 UTC).
const APERTURA = Date.parse('2026-10-13T20:00:00Z')
const VENCE = '2026-10-20T20:00:00.000Z'
// Las corridas del cron: 07:00 de Bogotá = 12:00 UTC.
const cron = (dia: string) => Date.parse(`${dia}T12:00:00Z`)

function registro(extra: Partial<{ cobro_estado: string | null; cobro_programado_at: string | null; cobro_aviso_enviado_at: string | null }> = {}) {
  return { cobro_estado: 'programado', cobro_programado_at: VENCE, cobro_aviso_enviado_at: null, ...extra }
}

describe('la fecha fija del cobro (opción A)', () => {
  it('es el vence_en de la prueba, con su hora', () => {
    expect(momentoDelCobro({ venceEn: VENCE, aperturaMs: APERTURA }, { VERCEL_ENV: 'production' })).toBe(VENCE)
  })
  it('sin vence_en, la apertura más 7 días', () => {
    expect(momentoDelCobro({ venceEn: null, aperturaMs: APERTURA }, {})).toBe(VENCE)
  })
  it('agotar las 10 consultas no la adelanta: la fecha solo depende de la apertura', () => {
    // No hay entrada de consultas: el cálculo no las conoce, a propósito.
    expect(momentoDelCobro.length).toBeLessThanOrEqual(2)
  })
})

describe('el cron diario de las 07:00 nunca cobra antes del instante exacto (fila 13 de Vera)', () => {
  const avisado = registro({ cobro_aviso_enviado_at: new Date(cron('2026-10-18')).toISOString() })

  it('el martes 07:00 (8 horas antes de las 15:00) NO cobra', () => {
    expect(pasoDelCobro(avisado, cron('2026-10-20'), ANTELACION_AVISO_MS)).toBe('esperar')
  })
  it('el miércoles 07:00 cobra', () => {
    expect(pasoDelCobro(avisado, cron('2026-10-21'), ANTELACION_AVISO_MS)).toBe('cobrar')
  })
  it('un segundo antes del instante no cobra; en el instante sí', () => {
    expect(pasoDelCobro(avisado, Date.parse(VENCE) - 1000, ANTELACION_AVISO_MS)).toBe('esperar')
    expect(pasoDelCobro(avisado, Date.parse(VENCE), ANTELACION_AVISO_MS)).toBe('cobrar')
  })
})

describe('el aviso del 7.2, al menos 48 horas antes del cobro', () => {
  it('antes de las 72 h previas, espera; la corrida diaria que cae entre 72 y 48 h, avisa', () => {
    expect(pasoDelCobro(registro(), cron('2026-10-16'), ANTELACION_AVISO_MS)).toBe('esperar')
    expect(pasoDelCobro(registro(), cron('2026-10-17'), ANTELACION_AVISO_MS)).toBe('esperar') // 80 h antes
    expect(pasoDelCobro(registro(), cron('2026-10-18'), ANTELACION_AVISO_MS)).toBe('avisar') // 56 h antes
  })
  it('con cualquier hora de apertura hay una corrida diaria que avisa con 48 h o más', () => {
    for (let h = 0; h < 24; h++) {
      const vence = Date.parse('2026-10-20T00:00:00Z') + h * H
      const r = registro({ cobro_programado_at: new Date(vence).toISOString() })
      let avisoMs: number | null = null
      for (let d = 13; d <= 21 && avisoMs === null; d++) {
        const t = cron(`2026-10-${String(d).padStart(2, '0')}`)
        if (pasoDelCobro(r, t, ANTELACION_AVISO_MS) === 'avisar') avisoMs = t
      }
      expect(avisoMs).not.toBeNull()
      expect(vence - (avisoMs as number)).toBeGreaterThanOrEqual(48 * H)
    }
  })
  it('sin aviso no se cobra nunca, aunque ya pasó el instante: primero avisa', () => {
    expect(pasoDelCobro(registro(), cron('2026-10-25'), ANTELACION_AVISO_MS)).toBe('avisar')
  })
  it('si el aviso salió tarde, el cobro se corre a 48 h después del aviso', () => {
    const tarde = Date.parse(VENCE) - 10 * H
    const r = registro({ cobro_aviso_enviado_at: new Date(tarde).toISOString() })
    expect(pasoDelCobro(r, Date.parse(VENCE) + H, ANTELACION_AVISO_MS)).toBe('esperar')
    expect(pasoDelCobro(r, tarde + 48 * H, ANTELACION_AVISO_MS)).toBe('cobrar')
  })
})

describe('qué registros no tocan nada', () => {
  it('cancelado, ya cobrado, cobrando o sin cobro', () => {
    for (const e of ['cancelado', 'cobrado', 'cobrando', 'rechazado', 'revisar', null]) {
      expect(pasoDelCobro(registro({ cobro_estado: e, cobro_aviso_enviado_at: VENCE }), cron('2026-10-30'), ANTELACION_AVISO_MS)).toBe('nada')
    }
  })
  it('solo se cancela mientras está programado', () => {
    expect(puedeCancelar('programado')).toBe(true)
    for (const e of ['cobrando', 'cobrado', 'cancelado', null]) expect(puedeCancelar(e)).toBe(false)
  })
})

describe('la prueba acortada de un preview', () => {
  it('se ignora en producción', () => {
    expect(minutosDePruebaAcortada({ VERCEL_ENV: 'production', VALIDA_COBRO_PRUEBA_MINUTOS: '10' })).toBeNull()
    expect(momentoDelCobro({ venceEn: VENCE, aperturaMs: APERTURA }, { VERCEL_ENV: 'production', VALIDA_COBRO_PRUEBA_MINUTOS: '10' })).toBe(VENCE)
    expect(antelacionAvisoMs({ VERCEL_ENV: 'production', VALIDA_COBRO_PRUEBA_MINUTOS: '10' })).toBe(48 * H)
  })
  it('en un preview pone el cobro N minutos después y escala el aviso (48/168)', () => {
    const env = { VERCEL_ENV: 'preview', VALIDA_COBRO_PRUEBA_MINUTOS: '14' }
    expect(momentoDelCobro({ venceEn: VENCE, aperturaMs: APERTURA }, env)).toBe(new Date(APERTURA + 14 * 60_000).toISOString())
    expect(antelacionAvisoMs(env)).toBe(4 * 60_000)
  })
  it('un valor raro se ignora', () => {
    expect(minutosDePruebaAcortada({ VERCEL_ENV: 'preview', VALIDA_COBRO_PRUEBA_MINUTOS: 'pronto' })).toBeNull()
    expect(minutosDePruebaAcortada({ VERCEL_ENV: 'preview', VALIDA_COBRO_PRUEBA_MINUTOS: '0' })).toBeNull()
  })
  it('cada despliegue procesa lo suyo', () => {
    expect(entornoDeCobro({ VERCEL_ENV: 'production' })).toBe('production')
    expect(entornoDeCobro({ VERCEL_ENV: 'preview' })).toBe('preview')
    expect(entornoDeCobro({})).toBe('development')
  })
})

describe('el correo del aviso (pendiente de Vera)', () => {
  it('dice la fecha y la hora, el valor y cómo cancelar', () => {
    const c = correoAvisoCobro({ razonSocial: 'ACME S.A.S.', cobroDesde: VENCE, urlCuenta: 'https://acme.metrikone.co/valida' })
    const fecha = fechaYHoraBogota(VENCE)
    expect(fecha).toMatch(/martes, 20 de octubre de 2026, 3:00/)
    expect(c.subject).toContain(fecha)
    expect(c.text).toContain('$150.000 (valor total, sin IVA que sumar)')
    expect(c.text).toContain('después cada mes hasta que te retires')
    expect(c.text).toContain('"Cancelar prueba"')
    expect(c.text).toContain('https://acme.metrikone.co/valida')
    expect(c.html).not.toContain('<script')
  })
})

describe('el cobro al confirmar (Condiciones v2.1, 7.1 literal a)', () => {
  it('solo a quien aceptó la v2.1 o posterior: la v2.0 dice «no se adelanta»', () => {
    expect(permiteCobroAlConfirmar('condiciones-2.1+aviso-1.3+terminos-auto-2.1')).toBe(true)
    expect(permiteCobroAlConfirmar('condiciones-2.10+aviso-1.2')).toBe(true)
    expect(permiteCobroAlConfirmar('condiciones-3.0+aviso-1.3')).toBe(true)
    expect(permiteCobroAlConfirmar('condiciones-2.0+aviso-1.2+terminos-auto-2.0')).toBe(false)
    expect(permiteCobroAlConfirmar('condiciones-1.0+aviso-1.1')).toBe(false)
    expect(permiteCobroAlConfirmar(null)).toBe(false)
    expect(permiteCobroAlConfirmar('2.1')).toBe(false)
  })

  it('la pantalla de la consulta 11 (C7 de Emilio): valor, 4 dígitos, renovación y fecha de corte, con UN botón', () => {
    expect(textoConfirmacionCobro({ valor: 150_000, ultimos4: '0326', agotada: true, consultasPrueba: 10 })).toEqual({
      titulo: 'Usaste tus 10 consultas de prueba',
      detalle: 'Activa tu plan ahora: se cobran $150.000 a tu tarjeta terminada en 0326 por el primer mes, y después cada mes en esta misma fecha hasta que te retires.',
      boton: 'Activar y pagar $150.000',
    })
  })

  it('desde «Activar plan» con consultas todavía: además, el plan activo desde el pago y el fin de la prueba', () => {
    const t = textoConfirmacionCobro({ valor: 150_000, ultimos4: '0326', agotada: false, consultasPrueba: 10 })
    expect(t.titulo).toBe('Activa tu plan antes de que termine la prueba')
    expect(t.detalle).toBe(
      'Activa tu plan ahora: se cobran $150.000 a tu tarjeta terminada en 0326 por el primer mes, y después cada mes en esta misma fecha hasta que te retires. Tu plan queda activo desde este pago y la prueba termina.',
    )
    expect(t.boton).toBe('Activar y pagar $150.000')
  })

  it('la constancia es el texto de la pantalla en un renglón', () => {
    const t = textoConfirmacionCobro({ valor: 150_000, ultimos4: '0326', agotada: true, consultasPrueba: 10 })
    expect(constanciaConfirmacion(t)).toBe(`Usaste tus 10 consultas de prueba. ${t.detalle} [Activar y pagar $150.000]`)
  })

  it('el correo del cobro (C3): fecha, valor y los 4 dígitos', () => {
    const c = correoCobroConfirmado({
      razonSocial: 'ACME S.A.S.',
      cobradoAt: '2026-10-15T23:00:00.000Z',
      valor: 150_000,
      ultimos4: '0326',
      urlCuenta: 'https://acme.metrikone.co/valida',
    })
    expect(c.subject).toBe('Cobramos $150.000 por tu plan de Valida (tarjeta terminada en 0326)')
    expect(c.text).toMatch(/El jueves, 15 de octubre de 2026, 6:00\s?p\.\s?m\. \(hora de Colombia\) cobramos \$150\.000/)
    expect(c.text).toContain('por el primer mes a tu tarjeta terminada en 0326')
    expect(c.text).toContain('Después se cobra cada mes en esta misma fecha a la misma tarjeta, hasta que te retires.')
    expect(c.html).not.toContain('<script')
  })
})
