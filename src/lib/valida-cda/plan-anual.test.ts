import { describe, expect, it } from 'vitest'
import { proximoPago, type CuotaDeServicio } from './pago-pendiente'
import { estadoMora } from './plazos'
import { ANEXO_PLAN_ANUAL_TERMINOS_V1, ANEXO_PLAN_ANUAL_TERMINOS_V2 } from './plan-anual-anexo'
import {
  descripcionEnlaceAnual,
  expiraEnlaceAnualMs,
  ofertaPlanAnual,
  PLAN_ANUAL,
  planAnualHabilitado,
  planDeActivacion,
  plantillaDelAnexo,
  plazoAnual,
  renderAnexoPlanAnual,
  textoMencionAutoriza,
  textoRevocacionMencion,
  TIPOS_CUOTA_SIN_MORA,
  validarAceptante,
  vigenteHastaConPlanAnual,
  type CuotaParaActivar,
} from './plan-anual'

/**
 * El Plan Anual de los CDA (decisión de Mauricio del 2026-10-06, Anexo v1). Contratos que arrancaron el
 * 23-sep-2026: períodos del 23 al 22.
 */

const VIGENTE_DESDE = '2026-09-23'

describe('el plazo anual', () => {
  it('son los 12 períodos que siguen al período en curso', () => {
    const p = plazoAnual('2026-10-06', VIGENTE_DESDE)
    expect(p.periodos).toHaveLength(12)
    expect(p.desde).toBe('2026-10-23')
    expect(p.hasta).toBe('2027-10-22')
    // El último día del período en curso: el plan empieza mañana.
    expect(plazoAnual('2026-10-22', VIGENTE_DESDE).desde).toBe('2026-10-23')
    // El primer día de un período: ese período está en curso y no entra (anexo 3.2).
    expect(plazoAnual('2026-10-23', VIGENTE_DESDE).desde).toBe('2026-11-23')
  })

  it('el enlace vence al empezar (00:00 de Bogotá) el día de inicio', () => {
    expect(new Date(expiraEnlaceAnualMs('2026-10-23')).toISOString()).toBe('2026-10-23T05:00:00.000Z')
  })

  it('el precio: 11 x $150.000 sobre una lista de 12', () => {
    expect(PLAN_ANUAL.monto).toBe(11 * 150_000)
    expect(PLAN_ANUAL.precioLista - PLAN_ANUAL.monto).toBe(PLAN_ANUAL.descuento)
  })

  it('el texto del enlace cabe en los 100 caracteres de la pasarela', () => {
    const t = descripcionEnlaceAnual({ desde: '2026-10-23', hasta: '2027-10-22' })
    expect(t).toBe('Suscripción VALIDA · Plan Anual · 12 períodos del 23/10/2026 al 22/10/2027')
    expect(t.length).toBeLessThanOrEqual(100)
  })
})

describe('cuándo se ofrece', () => {
  const plazo = plazoAnual('2026-10-06', VIGENTE_DESDE)
  const base = {
    habilitado: true,
    precioMensual: 150_000,
    hoy: '2026-10-06',
    ahoraMs: Date.parse('2026-10-06T15:00:00Z'),
    hayCuotasVencidas: false,
    planActivoHasta: null,
    plazo,
  }

  it('con el contrato encendido, a tiempo y sin cuotas vencidas: sí', () => {
    expect(ofertaPlanAnual(base)).toEqual({ disponible: true })
  })

  it('apagado por contrato hasta que MeTRIK lo encienda (el anexo sigue en borrador)', () => {
    expect(ofertaPlanAnual({ ...base, habilitado: false })).toEqual({ disponible: false, motivo: 'apagado' })
    expect(planAnualHabilitado({ plan_anual_habilitado: true })).toBe(true)
    expect(planAnualHabilitado({ plan_anual_habilitado: 'true' })).toBe(false)
    expect(planAnualHabilitado(null)).toBe(false)
  })

  it('solo sobre $150.000 mensuales: el 11 x 12 del anexo está escrito sobre ese precio', () => {
    expect(ofertaPlanAnual({ ...base, precioMensual: 180_000 })).toEqual({ disponible: false, motivo: 'precio_distinto' })
    expect(ofertaPlanAnual({ ...base, precioMensual: null })).toEqual({ disponible: false, motivo: 'precio_distinto' })
  })

  it('hasta el 31-mar-2027 (Bogotá), no después', () => {
    const p = plazoAnual('2027-03-31', VIGENTE_DESDE)
    expect(ofertaPlanAnual({ ...base, hoy: '2027-03-31', ahoraMs: Date.parse('2027-03-31T15:00:00Z'), plazo: p })).toEqual({ disponible: true })
    expect(ofertaPlanAnual({ ...base, hoy: '2027-04-01', ahoraMs: Date.parse('2027-04-01T15:00:00Z'), plazo: p })).toEqual({
      disponible: false,
      motivo: 'fuera_de_plazo',
    })
  })

  it('con una cuota vencida e impaga, no', () => {
    expect(ofertaPlanAnual({ ...base, hayCuotasVencidas: true })).toEqual({ disponible: false, motivo: 'cuotas_vencidas' })
  })

  it('con un plan anual que todavía corre, no', () => {
    expect(ofertaPlanAnual({ ...base, planActivoHasta: '2027-10-22' })).toEqual({ disponible: false, motivo: 'plan_activo' })
  })

  it('el último día del período en curso, ya tarde en la noche, no queda tiempo para pagar', () => {
    const p = plazoAnual('2026-10-22', VIGENTE_DESDE)
    expect(ofertaPlanAnual({ ...base, hoy: '2026-10-22', ahoraMs: Date.parse('2026-10-23T04:00:00Z'), plazo: p })).toEqual({
      disponible: false,
      motivo: 'sin_tiempo',
    })
  })
})

describe('el anexo con sus datos', () => {
  const datos = {
    razonSocial: 'CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC',
    nit: '901234567-1',
    versionTerminos: '1.3',
    ordenNumero: null,
    precioUsuarioAdicional: null,
    plazo: { desde: '2026-10-23', hasta: '2027-10-22' },
    nombreUsuario: 'Carlos Arnulfo Castro Quintero',
    tipoDocumento: 'CC' as const,
    numeroDocumento: '12345678',
  }

  it('llena todas las llaves y no deja ninguna', () => {
    const { anexo, casilla } = renderAnexoPlanAnual(datos)
    expect(anexo).not.toMatch(/\{[a-z_]+\}/)
    expect(casilla).not.toMatch(/\{[a-z_]+\}/)
    expect(anexo).toContain('**CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC**, NIT 901234567-1')
    expect(anexo).toContain('(versión 1.3 y sus modificaciones')
    expect(anexo).toContain('del **23 de octubre de 2026 al 22 de octubre de 2027**')
    expect(anexo).not.toContain('Texto de aceptación')
  })

  it('la casilla es la del anexo, con la persona, el documento, el monto y las fechas, sin el botón', () => {
    const { casilla } = renderAnexoPlanAnual(datos)
    expect(casilla.slice(0, 111)).toBe('Yo, Carlos Arnulfo Castro Quintero, identificado con cédula de ciudadanía 12345678, en nombre de CENTRO DE DIAG')
    expect(casilla).toContain('un pago único de $1.650.000')
    expect(casilla).toContain('del 23 de octubre de 2026 al 22 de octubre de 2027')
    expect(casilla).toContain('sin devolución de lo pagado')
    expect(casilla).not.toMatch(/Acepto y voy a pagar|☐|\*\*/)
  })

  it('cada cliente ve el anexo de su serie de Términos, y la constancia guarda ESE documento', () => {
    expect(plantillaDelAnexo('1.3')).toBe(ANEXO_PLAN_ANUAL_TERMINOS_V1)
    expect(plantillaDelAnexo('v1.4')).toBe(ANEXO_PLAN_ANUAL_TERMINOS_V1)
    expect(plantillaDelAnexo('2.0')).toBe(ANEXO_PLAN_ANUAL_TERMINOS_V2)
    expect(plantillaDelAnexo('3.0')).toBeNull()
    expect(plantillaDelAnexo('')).toBeNull()
    const v1 = renderAnexoPlanAnual(datos)
    expect(v1.documento.version).toBe('v1')
    expect(v1.anexo).toContain('Términos de Suscripción al Servicio VALIDA · Plan CDA · Anexo v1')
    const v2 = renderAnexoPlanAnual({ ...datos, versionTerminos: '2.0', ordenNumero: 'OS-2026-014', precioUsuarioAdicional: 50_000 })
    expect(v2.documento.version).toBe('v1-terminos-v2.0')
    expect(v2.anexo).toContain('Variante CDA vía AFI · Versión 2.0')
    expect(v2.anexo).toContain('titular de la Orden de Suscripción No. OS-2026-014')
    expect(v2.anexo).toContain('al valor de la Orden ($50.000 mensuales)')
    expect(v2.anexo).not.toMatch(/\{[a-z_]+\}/)
    expect(v2.casilla).toContain('para la Orden OS-2026-014')
    expect(v2.casilla).toContain('que al terminar el plan la suscripción vuelve a ser mensual según la Orden')
  })

  it('un anexo a medias no se arma: la v2.0 sin la Orden lanza', () => {
    expect(() => renderAnexoPlanAnual({ ...datos, versionTerminos: '2.0' })).toThrow(/orden_numero/)
    expect(() => renderAnexoPlanAnual({ ...datos, versionTerminos: '9.9' })).toThrow(/No hay anexo/)
  })

  it('la casilla de mención (numeral 11) es aparte de la aceptación, con la razón social, y la misma en los dos anexos', () => {
    const { casilla, casillaMencion, anexo } = renderAnexoPlanAnual(datos)
    expect(casillaMencion).toBe(
      'Opcional. Autorizo a METRIK a decir que CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC usa VALIDA, mostrando su razón social y su logotipo, en los términos del numeral 11 del Anexo. No incluye datos de personas ni del precio. Puedo revocarla cuando quiera. Marcarla o no marcarla no cambia el precio ni el descuento.',
    )
    expect(casilla).not.toContain('Autorizo a METRIK')
    expect(casilla).not.toContain('Casilla separada')
    expect(anexo).toContain('## 11. Autorización de mención (voluntaria)')
    const v2 = renderAnexoPlanAnual({ ...datos, versionTerminos: '2.0', ordenNumero: 'OS-1', precioUsuarioAdicional: 50_000 })
    expect(v2.casillaMencion).toBe(casillaMencion)
    expect(textoMencionAutoriza(datos.razonSocial)).toBe(casillaMencion)
    expect(textoMencionAutoriza(datos.razonSocial, ANEXO_PLAN_ANUAL_TERMINOS_V2)).toBe(casillaMencion)
    expect(textoRevocacionMencion('CDA X')).toContain('Revoco la autorización para que METRIK diga que CDA X usa VALIDA')
  })

  it('el nombre y el documento se validan antes de armar la constancia', () => {
    expect(validarAceptante({ nombre: 'Ana', tipoDocumento: 'CC', numeroDocumento: '123456' }).ok).toBe(false)
    expect(validarAceptante({ nombre: 'Ana Pérez', tipoDocumento: 'NIT', numeroDocumento: '123456' }).ok).toBe(false)
    expect(validarAceptante({ nombre: 'Ana Pérez', tipoDocumento: 'CC', numeroDocumento: '12a456' }).ok).toBe(false)
    expect(validarAceptante({ nombre: '  Ana   Pérez ', tipoDocumento: 'CC', numeroDocumento: '1.234.567' })).toEqual({
      ok: true,
      nombre: 'Ana Pérez',
      tipoDocumento: 'CC',
      numeroDocumento: '1234567',
    })
    expect(validarAceptante({ nombre: 'Ana Pérez', tipoDocumento: 'PA', numeroDocumento: 'ab12345' })).toMatchObject({ ok: true, numeroDocumento: 'AB12345' })
  })
})

// ── La activación ───────────────────────────────────────────────────────────────────────

describe('la fecha de la cláusula 12.1 con el plan anual (anexo 3.3)', () => {
  it('Maxitec: plazo hasta el 21-dic-2026, paga el año el 10-oct → la 12.1 pasa al 22-oct-2027', () => {
    const plazo = plazoAnual('2026-10-10', VIGENTE_DESDE)
    expect(plazo).toMatchObject({ desde: '2026-10-23', hasta: '2027-10-22' })
    expect(vigenteHastaConPlanAnual('2026-12-21', plazo.hasta)).toBe('2027-10-22')
  })

  it('sin fecha (renovación mensual) también pasa al fin del Plazo Anual; una fecha más lejana no se acorta', () => {
    expect(vigenteHastaConPlanAnual(null, '2027-10-22')).toBe('2027-10-22')
    expect(vigenteHastaConPlanAnual('2028-01-15', '2027-10-22')).toBe('2028-01-15')
  })
})

const PLAZO = { desde: '2026-10-23', hasta: '2027-10-22' }
const cuota = (numero: number, desde: string, hasta: string, venc: string, over: Partial<CuotaParaActivar> = {}): CuotaParaActivar => ({
  id: `q${numero}`,
  numero,
  tipo: 'cuota',
  monto: 150000,
  fechaVencimiento: venc,
  concepto: `Suscripción VALIDA · Plan CDA — servicio · periodo del ${desde.slice(8)}/${desde.slice(5, 7)}/${desde.slice(0, 4)} al ${hasta.slice(8)}/${hasta.slice(5, 7)}/${hasta.slice(0, 4)}`,
  cobroVivo: null,
  conPlata: false,
  cargos: [],
  ...over,
})
// El plan de los CDA: cuota 1 (pagada) y las de oct, nov y dic; la 4 vence en el plazo.
const CUOTAS = [
  cuota(1, '2026-09-23', '2026-10-22', '2026-09-30', { conPlata: true, cobroVivo: { id: 'c1', pagado: true } }),
  cuota(2, '2026-10-23', '2026-11-22', '2026-10-30'),
  cuota(3, '2026-11-23', '2026-12-22', '2026-11-30'),
]

describe('planDeActivacion', () => {
  const base = { plazo: PLAZO, vigenteDesde: VIGENTE_DESDE, fechaPago: '2026-10-10', cuotas: CUOTAS, hayCuotasVencidas: false }

  it('las cuotas del plazo pasan a usuarios adicionales en cero, se crean las que faltan y nace UNA cuota anual', () => {
    const r = planDeActivacion(base)
    if (!r.ok) throw new Error(r.motivo)
    expect(r.actualizar.map((c) => [c.id, c.monto])).toEqual([
      ['q2', 0],
      ['q3', 0],
    ])
    expect(r.actualizar[0].concepto).toBe('Usuarios adicionales · periodo del 23/10/2026 al 22/11/2026')
    // Los 10 períodos sin cuota (dic-2026 a sep-2027), en cero, con el mismo desfase de vencimiento (7 días).
    expect(r.insertar).toHaveLength(10)
    expect(r.insertar.every((c) => c.tipo === 'usuarios_adicionales' && c.monto === 0)).toBe(true)
    expect(r.insertar[0]).toMatchObject({ numero: 4, fechaVencimiento: '2026-12-30' })
    expect(r.insertar[9]).toMatchObject({ numero: 13, fechaVencimiento: '2027-09-30', concepto: 'Usuarios adicionales · periodo del 23/09/2027 al 22/10/2027' })
    expect(r.cuotaAnual).toEqual({
      numero: 14,
      tipo: 'anual',
      monto: 1_650_000,
      // El día ANTERIOR al pago: el reparto FIFO la cubre antes que la cuota del período en curso.
      fechaVencimiento: '2026-10-09',
      concepto: 'Suscripción VALIDA · Plan CDA — Plan Anual (12 períodos) · periodo del 23/10/2026 al 22/10/2027',
    })
    expect(r.anularCobros).toEqual([])
  })

  it('una cuota del plazo con usuarios adicionales queda cobrando solo esos usuarios, con su desglose', () => {
    const cargos = [{ tipo: 'periodo' as const, periodoDesde: '2026-11-23', periodoHasta: '2026-12-22', dias: 30, diasPeriodo: 30, monto: 50000 }]
    const r = planDeActivacion({ ...base, cuotas: [CUOTAS[0], CUOTAS[1], { ...CUOTAS[2], monto: 200000, cargos }] })
    if (!r.ok) throw new Error(r.motivo)
    const q3 = r.actualizar.find((c) => c.id === 'q3')
    expect(q3).toMatchObject({ monto: 50000, montoEsperado: 200000, tipoEsperado: 'cuota' })
    expect(q3?.concepto).toBe(
      'Usuarios adicionales · periodo del 23/11/2026 al 22/12/2026 · Incluye: 1 usuario adicional, periodo del 23/11/2026 al 22/12/2026 $50.000',
    )
  })

  it('un enlace mensual ya emitido y sin pagar en una cuota del plazo se anula', () => {
    const r = planDeActivacion({ ...base, cuotas: [CUOTAS[0], { ...CUOTAS[1], cobroVivo: { id: 'c2', pagado: false } }, CUOTAS[2]] })
    expect(r.ok && r.anularCobros).toEqual(['c2'])
  })

  it('una cuota del plazo ya pagada como mensualidad: no se activa (el período quedaría pagado dos veces)', () => {
    const r = planDeActivacion({ ...base, cuotas: [CUOTAS[0], { ...CUOTAS[1], conPlata: true }, CUOTAS[2]] })
    expect(r.ok).toBe(false)
  })

  it('pagado con cuotas vencidas e impagas: no se activa y se devuelve (anexo 2.2)', () => {
    const r = planDeActivacion({ ...base, hayCuotasVencidas: true })
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.motivo).toContain('2.2')
  })

  it('pagado el día de inicio o después, o después de la oferta: no se activa', () => {
    expect(planDeActivacion({ ...base, fechaPago: '2026-10-23' }).ok).toBe(false)
    expect(planDeActivacion({ ...base, fechaPago: '2027-04-01' }).ok).toBe(false)
  })

  it('con la cuota del período en curso pendiente y que vence el mismo día del pago, la plata del anual cubre el anual', () => {
    const r = planDeActivacion({ ...base, fechaPago: '2026-09-30', plazo: PLAZO })
    if (!r.ok) throw new Error(r.motivo)
    // El plan de los CDA tras activar: la 1 (en curso, sin pagar, vence el día del pago), las del plazo y la anual.
    const despues: CuotaDeServicio[] = [
      { numero: 1, tipo: 'cuota', monto: 150000, fechaVencimiento: '2026-09-30', concepto: null, enlacePagoUrl: null, enlacePagoExpira: null },
      ...r.actualizar.map((c, i) => ({ numero: 2 + i, tipo: 'usuarios_adicionales', monto: c.monto, fechaVencimiento: '2026-10-30', concepto: c.concepto, enlacePagoUrl: null, enlacePagoExpira: null })),
      { ...r.cuotaAnual, enlacePagoUrl: null, enlacePagoExpira: null },
    ]
    const pago = proximoPago({ cuotas: despues, cobros: [{ monto: 1_650_000, estado: 'pagado' }], hoy: '2026-09-30', ahoraISO: '2026-09-30T15:00:00Z' })
    // Lo pendiente es la cuota 1 (la mensualidad en curso), no el anual.
    expect(pago).toMatchObject({ estado: 'pendiente', numero: 1, saldo: 150000 })
  })
})

describe('la mora con el plan anual pagado (anexo 5.2 y 6.1)', () => {
  const q = (numero: number, tipo: string, monto: number, venc: string): CuotaDeServicio => ({
    numero,
    tipo,
    monto,
    fechaVencimiento: venc,
    concepto: null,
    enlacePagoUrl: null,
    enlacePagoExpira: null,
  })
  // Cuota 1 pagada, plan anual pagado, y una cuota de usuarios adicionales de dic-2026 sin pagar.
  const cuotas = [q(1, 'cuota', 150000, '2026-09-30'), q(14, 'anual', 1_650_000, '2026-10-09'), q(4, 'usuarios_adicionales', 50000, '2026-12-30'), q(5, 'usuarios_adicionales', 0, '2027-01-30')]
  const cobros = [
    { monto: 150000, estado: 'pagado' as const },
    { monto: 1_650_000, estado: 'pagado' as const },
  ]

  it('un usuario adicional impago no restringe ni suspende el servicio pagado por el plan', () => {
    for (const hoy of ['2027-01-10', '2027-02-15', '2027-06-01']) {
      const delServicio = proximoPago({ cuotas, cobros, hoy, ahoraISO: `${hoy}T15:00:00Z`, ignorarTipos: TIPOS_CUOTA_SIN_MORA })
      expect(estadoMora(delServicio, hoy)).toEqual({ estado: 'al_dia' })
    }
  })

  it('CONTROL — sin ignorar los usuarios adicionales, esa misma cuota sí llevaría a restricción y pausa', () => {
    const todo = proximoPago({ cuotas, cobros, hoy: '2027-02-15', ahoraISO: '2027-02-15T15:00:00Z' })
    expect(todo).toMatchObject({ estado: 'pendiente', numero: 4 })
    expect(estadoMora(todo, '2027-02-15').estado).toBe('suspendido')
  })

  it('la tarjeta de pago sigue mostrando la cuota de usuarios adicionales pendiente', () => {
    expect(proximoPago({ cuotas, cobros, hoy: '2026-12-20', ahoraISO: '2026-12-20T15:00:00Z' })).toMatchObject({ estado: 'pendiente', numero: 4, saldo: 50000 })
  })
})
