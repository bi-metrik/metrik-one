import { describe, expect, it } from 'vitest'
import { conceptoSinPeriodo, htmlAvisoEnlace, periodoEnLetras, textoAvisoEnlace } from './aviso-enlace-cuota'
import { descripcionCuota } from './enlace-pago-cuota'
import { leerPeriodoEnConcepto, quitarPeriodo } from './periodo-en-concepto'
import { periodoDeCuota } from '@/lib/seccion-suscripcion/periodos'
import { periodoCorto } from '@/lib/seccion-suscripcion/estado'
import { PLAN_CDA } from '@/lib/valida-cda/redaccion-fiscal'

/**
 * El concepto de las cuotas de los CDA pasó el 2026-09-24 a la redacción fiscal de Felipe:
 * «Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS) · periodo del 23-sep al 22-oct».
 * Sin año. Todo lo que leía el periodo del concepto numérico tiene que leer también este, o la
 * cuota se queda sin periodo en el correo, en la pasarela, en el aviso de mora y en el cobro de
 * usuarios adicionales.
 */

const NUEVO = `${PLAN_CDA} · periodo del 23-sep al 22-oct`
const VIEJO = 'Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026'

describe('leerPeriodoEnConcepto', () => {
  it('la forma numérica vieja trae sus fechas', () => {
    expect(leerPeriodoEnConcepto(VIEJO)).toEqual({
      texto: 'periodo del 23/09/2026 al 22/10/2026',
      corto: '23-sep al 22-oct',
      desde: '2026-09-23',
      hasta: '2026-10-22',
    })
  })

  it('la forma nueva, anclada en el vencimiento', () => {
    expect(leerPeriodoEnConcepto(NUEVO, '2026-09-30')).toEqual({
      texto: 'periodo del 23-sep al 22-oct',
      corto: '23-sep al 22-oct',
      desde: '2026-09-23',
      hasta: '2026-10-22',
    })
  })

  it('sin vencimiento, la forma nueva da el texto pero no inventa el año', () => {
    expect(leerPeriodoEnConcepto(NUEVO)).toMatchObject({ corto: '23-sep al 22-oct', desde: null, hasta: null })
  })

  it('un periodo que cruza el año termina en el año siguiente', () => {
    const c = `${PLAN_CDA} · periodo del 23-dic al 22-ene`
    expect(leerPeriodoEnConcepto(c, '2026-12-30')).toMatchObject({ desde: '2026-12-23', hasta: '2027-01-22' })
    // Vencida ya en enero, el inicio sigue siendo el diciembre anterior.
    expect(leerPeriodoEnConcepto(c, '2027-01-05')).toMatchObject({ desde: '2026-12-23', hasta: '2027-01-22' })
  })

  it('sin periodo, null', () => {
    expect(leerPeriodoEnConcepto(PLAN_CDA, '2026-09-30')).toBeNull()
    expect(leerPeriodoEnConcepto(null)).toBeNull()
  })
})

describe('quitarPeriodo', () => {
  it('quita el periodo y su separador, en las dos formas', () => {
    expect(quitarPeriodo(NUEVO)).toBe(PLAN_CDA)
    expect(quitarPeriodo(VIEJO)).toBe('Licencia VALIDA · Starter')
  })
})

describe('los consumidores leen la forma nueva', () => {
  it('el correo del enlace: concepto sin periodo y periodo en letras', () => {
    expect(conceptoSinPeriodo(NUEVO, 1)).toBe(PLAN_CDA)
    expect(periodoEnLetras(NUEVO, '2026-09-30')).toBe('del 23 de septiembre al 22 de octubre de 2026')
    const datos = {
      nombre: 'Alba Rosas',
      correo: 'alba@cda.co',
      espacioNombre: 'CDA del Caquetá',
      concepto: NUEVO,
      numeroCuota: 1,
      monto: 150000,
      fechaVencimiento: '2026-09-30',
      hoy: '2026-09-25',
      enlaceExpira: null,
      urlSuscripcion: 'https://cda-caqueta.metrikone.co/suscripcion',
    }
    const texto = textoAvisoEnlace(datos)
    expect(texto).toContain(`Concepto: ${PLAN_CDA}`)
    expect(texto).toContain('Periodo: del 23 de septiembre al 22 de octubre de 2026')
    expect(texto).not.toMatch(/licencia/i)
    expect(htmlAvisoEnlace(datos)).not.toMatch(/licencia/i)
  })

  it('la pasarela: el concepto completo no cabe en 100, queda el nombre corto con el periodo', () => {
    expect(NUEVO.length).toBeGreaterThan(100)
    expect(descripcionCuota({ numero: 1, concepto: NUEVO, fechaVencimiento: '2026-09-30', totalCuotas: 4 })).toBe(
      'Suscripción VALIDA · Plan CDA · periodo del 23-sep al 22-oct',
    )
  })

  it('el cobro de usuarios adicionales: el periodo que paga la cuota', () => {
    expect(periodoDeCuota({ concepto: NUEVO, fechaVencimiento: '2026-09-30' }, 23)).toEqual({
      desde: '2026-09-23',
      hasta: '2026-10-22',
      dias: 30,
    })
  })

  it('el aviso de mora: el periodo corto', () => {
    expect(periodoCorto(NUEVO, '2026-09-30')).toBe('23-sep al 22-oct')
  })
})
