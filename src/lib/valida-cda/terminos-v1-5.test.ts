import { describe, expect, it } from 'vitest'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'
import { modificacionesPorAceptar, sinAvisosFuturos } from '@/lib/valida-api/terminos'
import { cuotasConEstado, proximoPago, type CuotaDeServicio } from './pago-pendiente'
import { estadoMora, moraPermiteConsultar, REGLA_MORA_CDA, vigenciaTransicion, type EstadoMora } from './plazos'
import {
  correoAvisoV15,
  datosDelTextoV15,
  deFechaLarga,
  esTerminosV15,
  fechaExigeAceptacion,
  finUltimoPeriodoPagado,
  periodosPendientesAntesDe,
  pospuestaHoy,
  textoPeriodos,
  textosPantallaV15,
} from './terminos-v1-5'

/**
 * La v1.5 de los Términos de los CDA: la transición de la mora (cláusula 11.7, el bloqueante de Vera), la
 * pantalla (anexo A) con sus variables calculadas del dato, y qué se ofrece aceptar.
 *
 * Los datos son los de producción al 2026-10-29 (Vera y Max, por SELECT): los 4 CDA renuevan el 23; El
 * Carmen pagó hasta el 22-nov; Caquetá, Puertotest y Maxitec hasta el 22-oct, con la cuota del 23-oct
 * (vencida el 27-oct) impaga. La v1.4 rige desde el 6-nov; la v1.5 se publica el 1-nov y rige el 1-dic.
 */

const CONCEPTO = 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS) · periodo del'
const cuota = (numero: number, vence: string, periodo: string): CuotaDeServicio => ({
  numero,
  tipo: 'cuota',
  monto: 150000,
  fechaVencimiento: vence,
  concepto: `${CONCEPTO} ${periodo}`,
  enlacePagoUrl: null,
  enlacePagoExpira: null,
  cuotaId: `c${numero}`,
})
/** Las cuotas de Caquetá, El Carmen y Puertotest (Maxitec no tiene la 4: su 12.1 termina el 21-dic). */
const CUOTAS = [
  cuota(1, '2026-09-30', '23-sep al 22-oct'),
  cuota(2, '2026-10-27', '23-oct al 22-nov'),
  cuota(3, '2026-11-27', '23-nov al 22-dic'),
  cuota(4, '2026-12-27', '23-dic al 22-ene'),
]
const pagado = (monto: number) => [{ monto, estado: 'pagado' as const }]

const RESTRICCION_V14 = '2026-11-06'
const VIGENCIA_V15 = '2026-12-01'

function mora(pagos: number, hoy: string, transicion: string | null, cuotas = CUOTAS): EstadoMora {
  const pago = proximoPago({ cuotas, cobros: pagado(pagos), hoy, ahoraISO: `${hoy}T15:00:00Z` })
  return estadoMora(pago, hoy, RESTRICCION_V14, REGLA_MORA_CDA, transicion)
}

describe('el bloqueante de Vera: la transición de la cláusula 11.7', () => {
  describe('Caquetá, Puertotest y Maxitec (pagaron hasta el 22-oct; la cuota del 23-oct venció el 27-oct)', () => {
    const casos: [string, EstadoMora['estado']][] = [
      ['2026-11-01', 'al_dia'],
      ['2026-11-06', 'al_dia'],
      ['2026-11-27', 'al_dia'],
      ['2026-11-30', 'al_dia'],
      ['2026-12-01', 'en_mora'],
      ['2026-12-05', 'en_mora'],
      ['2026-12-06', 'restringido'],
      ['2026-12-30', 'restringido'],
      ['2026-12-31', 'suspendido'],
    ]
    for (const cuotas of [CUOTAS, CUOTAS.slice(0, 3)]) {
      for (const [hoy, estado] of casos) {
        it(`${cuotas.length === 3 ? 'Maxitec' : 'Caquetá/Puertotest'} el ${hoy}: ${estado}`, () => {
          const m = mora(150000, hoy, VIGENCIA_V15, cuotas)
          expect(m.estado).toBe(estado)
          expect(moraPermiteConsultar(m)).toBe(hoy < '2026-12-06')
        })
      }
    }

    it('el aviso del 1 al 5-dic dice que se restringe el 6-dic y se pausa el 31-dic', () => {
      expect(mora(150000, '2026-12-01', VIGENCIA_V15)).toEqual({
        estado: 'en_mora',
        vencio: '2026-11-30',
        restringeDesde: '2026-12-06',
        corteDesde: '2026-12-31',
      })
    })

    it('CONTROL sin la v1.5: la v1.4 restringe el 6-nov y pausa el 27-nov (lo que Vera encontró)', () => {
      expect(mora(150000, '2026-11-06', null).estado).toBe('restringido')
      expect(mora(150000, '2026-11-27', null).estado).toBe('suspendido')
    })
  })

  describe('El Carmen (pagó hasta el 22-nov; la cuota del 23-nov vence el 27-nov)', () => {
    it('sin restricción hasta el 5-dic, restringido del 6 al 30-dic, pausa el 31-dic', () => {
      expect(mora(300000, '2026-11-28', VIGENCIA_V15).estado).toBe('al_dia')
      expect(mora(300000, '2026-12-03', VIGENCIA_V15).estado).toBe('en_mora')
      expect(mora(300000, '2026-12-05', VIGENCIA_V15).estado).toBe('en_mora')
      expect(mora(300000, '2026-12-06', VIGENCIA_V15).estado).toBe('restringido')
      expect(mora(300000, '2026-12-30', VIGENCIA_V15).estado).toBe('restringido')
      expect(mora(300000, '2026-12-31', VIGENCIA_V15).estado).toBe('suspendido')
    })

    it('CONTROL sin la v1.5: la v1.4 lo restringiría el 3-dic', () => {
      expect(mora(300000, '2026-12-03', null).estado).toBe('restringido')
    })
  })

  it('pagados los períodos de la transición, el del 23-dic sigue la regla de su vencimiento (27-dic)', () => {
    expect(mora(450000, '2027-01-01', VIGENCIA_V15).estado).toBe('en_mora')
    expect(mora(450000, '2027-01-02', VIGENCIA_V15).estado).toBe('restringido')
  })

  it('una cuota sin período en el concepto se juzga por su vencimiento', () => {
    const sinConcepto = CUOTAS.map((c) => ({ ...c, concepto: null }))
    expect(mora(150000, '2026-11-27', VIGENCIA_V15, sinConcepto).estado).toBe('al_dia')
    expect(mora(150000, '2026-12-06', VIGENCIA_V15, sinConcepto).estado).toBe('restringido')
  })

  it('la vigencia sale de la v1.5 registrada (cualquier versión ≥ 1.5 de la serie), no de una constante', () => {
    const doc = (version: string, vigenteDesde: string, slug = 'terminos-suscripcion-valida-cda') => ({ slug, version, vigenteDesde })
    expect(vigenciaTransicion([doc('v1.3', '2026-09-24'), doc('v1.4', '2026-11-06')])).toBeNull()
    expect(vigenciaTransicion([doc('v1.4', '2026-11-06'), doc('v1.5', '2026-12-03')])).toBe('2026-12-03')
    expect(vigenciaTransicion([doc('v1.5', '2026-12-01', 'otra-serie')])).toBeNull()
    expect(vigenciaTransicion([doc('v2.0', '2027-02-01'), doc('v1.5', '2026-12-01')])).toBe('2026-12-01')
  })
})

// ── Lo que se ofrece aceptar ──────────────────────────────────────────────────────────

const base: DocumentoContractual = {
  documentoId: 'v13',
  slug: 'terminos-suscripcion-valida-cda',
  titulo: 'Términos de Suscripción al Servicio VALIDA · Plan CDA',
  version: 'v1.3',
  textoMd: '# v1.3',
  pdfSha256: 'a'.repeat(64),
  vigenteDesde: '2026-09-24',
  vigenteHasta: '2026-11-05',
  aceptadoAt: '2026-10-02T13:43:15Z',
  aceptadoPor: 'Alba',
  aceptadoCalidad: 'representante_legal',
  aceptadoCanal: 'modulo',
}
const v14: DocumentoContractual = {
  ...base,
  documentoId: 'v14',
  version: 'v1.4',
  pdfSha256: 'b'.repeat(64),
  vigenteDesde: '2026-11-06',
  vigenteHasta: '2026-11-30',
  aceptadoAt: null,
  aceptadoPor: null,
  aceptadoCalidad: null,
  aceptadoCanal: null,
  rigePorAviso: true,
  reemplazaId: 'v13',
  publicadaAt: '2026-10-07T17:59:49Z',
}
const v15: DocumentoContractual = {
  ...v14,
  documentoId: 'v15',
  version: 'v1.5',
  pdfSha256: 'c'.repeat(64),
  vigenteDesde: '2026-12-01',
  vigenteHasta: null,
  reemplazaId: 'v14',
  publicadaAt: '2026-11-01T05:00:00Z',
}

describe('qué se muestra y qué se ofrece aceptar', () => {
  it('registrada el viernes para el domingo 00:00, no existe para el cliente hasta ese instante', () => {
    expect(sinAvisosFuturos([base, v14, v15], '2026-10-30T20:00:00Z').map((d) => d.version)).toEqual(['v1.3', 'v1.4'])
    expect(sinAvisosFuturos([base, v14, v15], '2026-11-01T04:59:59Z').map((d) => d.version)).toEqual(['v1.3', 'v1.4'])
    expect(sinAvisosFuturos([base, v14, v15], '2026-11-01T05:00:00Z').map((d) => d.version)).toEqual(['v1.3', 'v1.4', 'v1.5'])
  })

  it('una por aviso sin fecha de publicación legible no se muestra; una de entrada, siempre', () => {
    expect(sinAvisosFuturos([{ ...v15, publicadaAt: 'mañana' }], '2026-11-02T00:00:00Z')).toEqual([])
    expect(sinAvisosFuturos([base], '2026-11-02T00:00:00Z')).toEqual([base])
  })

  it('Caquetá (no aceptó la v1.4): publicada la v1.5, solo se ofrece la v1.5', () => {
    expect(modificacionesPorAceptar([base, v14], '2026-10-29').map((d) => d.version)).toEqual(['v1.4'])
    expect(modificacionesPorAceptar([base, v14, v15], '2026-11-01').map((d) => d.version)).toEqual(['v1.5'])
  })

  it('El Carmen (aceptó la v1.4): se ofrece la v1.5', () => {
    const v14Aceptada = { ...v14, aceptadoAt: '2026-10-16T14:37:53Z' }
    expect(modificacionesPorAceptar([base, v14Aceptada, v15], '2026-11-01').map((d) => d.version)).toEqual(['v1.5'])
  })

  it('aceptada la v1.5, no queda nada por aceptar (ni la v1.4)', () => {
    expect(modificacionesPorAceptar([base, v14, { ...v15, aceptadoAt: '2026-11-02T15:00:00Z' }], '2026-11-02')).toEqual([])
  })

  it('esTerminosV15 reconoce la v1.5 por aviso de la serie, no la v1.4 ni otra serie', () => {
    expect(esTerminosV15(v15)).toBe(true)
    expect(esTerminosV15(v14)).toBe(false)
    expect(esTerminosV15({ ...v15, slug: 'otra' })).toBe(false)
    expect(esTerminosV15({ ...v15, rigePorAviso: false })).toBe(false)
  })
})

// ── La pantalla (anexo A) ─────────────────────────────────────────────────────────────

const TEXTO_MAXITEC = [
  '**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S., NIT 900.158.425-0, domiciliada en …',
  '2.4. **Pago y período.** … La fecha de renovación del Cliente es el día 23 de cada mes, que es el día …',
  '12.1. **Plazo de los compromisos de METRIK.** … Hasta el **21 de diciembre de 2026**, fecha en que vencía el contrato …',
  '16.4. … Desde el **22 de diciembre de 2026**, o desde el día siguiente al fin del último período pagado si es posterior, …',
].join('\n\n')

describe('las variables de la pantalla salen del dato', () => {
  it('del texto registrado: día de renovación, 12.1, 16.4 y razón social', () => {
    expect(datosDelTextoV15(TEXTO_MAXITEC)).toEqual({
      diaRenovacion: 23,
      fin12_1: '2026-12-21',
      exigeDesde: '2026-12-22',
      razonSocial: 'CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S.',
    })
    expect(datosDelTextoV15('# otro texto')).toEqual({ diaRenovacion: null, fin12_1: null, exigeDesde: null, razonSocial: null })
    expect(deFechaLarga('31 de febrero de 2027')).toBeNull()
  })

  it('períodos pendientes al 30-nov: Caquetá, Puertotest y Maxitec deben dos ($300.000); El Carmen uno', () => {
    const conEstado = (pagos: number) =>
      cuotasConEstado({ cuotas: CUOTAS, cobros: pagado(pagos), hoy: '2026-11-01', ahoraISO: '2026-11-01T15:00:00Z' })
    expect(textoPeriodos(periodosPendientesAntesDe(conEstado(150000), VIGENCIA_V15))).toBe(
      '23-oct al 22-nov de 2026 y 23-nov al 22-dic de 2026 ($300.000)',
    )
    expect(textoPeriodos(periodosPendientesAntesDe(conEstado(300000), VIGENCIA_V15))).toBe('23-nov al 22-dic de 2026 ($150.000)')
    expect(periodosPendientesAntesDe(conEstado(450000), VIGENCIA_V15)).toEqual([])
  })

  it('16.4: la fecha exigible no bloquea un período pagado', () => {
    const conEstado = (pagos: number) =>
      cuotasConEstado({ cuotas: CUOTAS, cobros: pagado(pagos), hoy: '2026-11-01', ahoraISO: '2026-11-01T15:00:00Z' })
    // Maxitec: 22-dic; si paga el período del 23-nov al 22-dic, el 23-dic.
    expect(fechaExigeAceptacion('2026-12-22', finUltimoPeriodoPagado(conEstado(150000)))).toBe('2026-12-22')
    expect(fechaExigeAceptacion('2026-12-22', finUltimoPeriodoPagado(conEstado(450000)))).toBe('2026-12-23')
    // Los otros tres: 16-ene; si pagan el del 23-dic al 22-ene, el 23-ene.
    expect(fechaExigeAceptacion('2027-01-16', finUltimoPeriodoPagado(conEstado(600000)))).toBe('2027-01-23')
    expect(fechaExigeAceptacion(null, '2027-01-22')).toBeNull()
  })

  it('el texto de la pantalla de Maxitec el 1-nov, con sus fechas', () => {
    const cuotas = cuotasConEstado({ cuotas: CUOTAS.slice(0, 3), cobros: pagado(150000), hoy: '2026-11-01', ahoraISO: '2026-11-01T15:00:00Z' })
    const t = textosPantallaV15({
      doc: { ...v15 },
      texto: datosDelTextoV15(TEXTO_MAXITEC),
      periodos: { estado: 'ok', periodos: periodosPendientesAntesDe(cuotas, VIGENCIA_V15) },
      fechaExige: fechaExigeAceptacion('2026-12-22', finUltimoPeriodoPagado(cuotas)),
    })
    expect(t.titulo).toBe('Nuevos Términos de tu suscripción a Valida (versión 1.5)')
    expect(t.queCambia).toHaveLength(6)
    expect(t.queCambia[0]).toContain('el día 23 de cada mes.')
    expect(t.queCambia[5]).toBe(
      '**Para estar al día:** a más tardar el **30 de noviembre de 2026** debes tener pagados: 23-oct al 22-nov de 2026 ' +
        'y 23-nov al 22-dic de 2026 ($300.000). Hasta el 5 de diciembre no se restringen tus consultas por esos períodos.',
    )
    expect(t.siNoAceptas).toContain('desde el **1 de diciembre de 2026** por la cláusula 13.1')
    expect(t.siNoAceptas).toContain('Hasta el **21 de diciembre de 2026** METRIK mantiene')
    expect(t.siNoAceptas).toContain('**desde el 22 de diciembre de 2026 necesitarás haberla aceptado para seguir consultando.**')
    expect(t.siNoAceptas).toContain('antes del 1 de diciembre de 2026, con reembolso a prorrata')
    expect(t.publicado).toBe('Aviso publicado en la plataforma el 1 de noviembre de 2026.')
    expect(t.huella).toBe('c'.repeat(64))
  })

  it('sin poder leer las cuotas, dice la regla sin lista; al día, lo dice', () => {
    const sinDato = textosPantallaV15({ doc: v15, texto: datosDelTextoV15(TEXTO_MAXITEC), periodos: { estado: 'sin_dato' }, fechaExige: null })
    expect(sinDato.queCambia[5]).toContain('los períodos que empiezan antes del 1 de diciembre de 2026 que no estén pagados')
    expect(sinDato.siNoAceptas).toContain('desde el 22 de diciembre de 2026 (o el día siguiente al fin de tu último período pagado, si es posterior)')
    const alDia = textosPantallaV15({ doc: v15, texto: datosDelTextoV15(TEXTO_MAXITEC), periodos: { estado: 'ok', periodos: [] }, fechaExige: '2026-12-23' })
    expect(alDia.queCambia[5]).toBe('**Para estar al día:** ya tienes pagados los períodos que empiezan antes del 1 de diciembre de 2026.')
  })

  it('las fechas de la transición siguen a la vigencia registrada (aviso publicado otro día)', () => {
    const t = textosPantallaV15({
      doc: { ...v15, vigenteDesde: '2026-12-03', publicadaAt: '2026-11-03T13:00:00Z' },
      texto: datosDelTextoV15(TEXTO_MAXITEC),
      periodos: { estado: 'sin_dato' },
      fechaExige: null,
    })
    expect(t.queCambia[5]).toContain('a más tardar el **2 de diciembre de 2026**')
    expect(t.queCambia[5]).toContain('Hasta el 7 de diciembre no se restringen')
    expect(t.publicado).toBe('Aviso publicado en la plataforma el 3 de noviembre de 2026.')
  })
})

describe('«Ahora no, recordármelo»', () => {
  it('pospone solo esa versión y ese día', () => {
    expect(pospuestaHoy('v15:2026-11-01', 'v15', '2026-11-01')).toBe(true)
    expect(pospuestaHoy('v15:2026-11-01', 'v15', '2026-11-02')).toBe(false)
    expect(pospuestaHoy('v14:2026-11-01', 'v15', '2026-11-01')).toBe(false)
    expect(pospuestaHoy(undefined, 'v15', '2026-11-01')).toBe(false)
  })
})

describe('el correo del aviso (anexo C)', () => {
  const c = correoAvisoV15({ doc: v15, texto: datosDelTextoV15(TEXTO_MAXITEC), urlValida: 'https://maxitec.metrikone.co/valida' })

  it('el asunto es el del anexo C y el cuerpo es la pantalla sin la casilla, con el enlace a Valida', () => {
    expect(c.asunto).toBe('Nuevos Términos de tu suscripción a Valida (versión 1.5)')
    expect(c.texto).toContain('Hola, equipo de CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S.:')
    expect(c.texto).toContain('3. Del día 6 al 30 sin pago, la suscripción queda Suspendida por pago')
    expect(c.texto).toContain('https://maxitec.metrikone.co/valida')
    expect(c.texto).toContain(`Huella SHA-256 del PDF: ${'c'.repeat(64)}`)
    expect(c.texto).toContain('aviso publicado en la plataforma el 1 de noviembre de 2026')
    expect(c.texto).not.toContain('He leído')
    expect(c.texto).not.toContain('**')
    expect(c.html).toContain('<strong>El precio, las consultas ilimitadas y los tres usuarios no cambian.</strong>')
  })

  it('no lleva la lista de períodos (un pago entre la programación y la salida la volvería falsa)', () => {
    expect(c.texto).not.toContain('$300.000')
    expect(c.texto).toContain('la persona designada ve en Suscripción cuáles tiene pendientes')
  })
})
