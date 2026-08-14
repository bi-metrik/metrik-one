import { describe, it, expect } from 'vitest'
import { refrescarVigenciaCrossCheck, type CrossCheckGuardado, type SpecVigencia } from './refrescar-vigencia'

const CHECK_CON_CITA: SpecVigencia = {
  label: 'Certificado vigente el día de la cita',
  slug: 'fecha_expedicion',
  match_mode: 'vigencia',
  vigencia_dias: 30,
  source_field: 'fecha_cita_dian',
  source_bloque_slug: 'fecha_cita_dian',
}

const CHECK_CON_MARGEN: SpecVigencia = { ...CHECK_CON_CITA, margen_sin_cita_dias: 10 }

/** Un `_cross_check` como el que quedó guardado el día de la carga. */
function guardado(over: Partial<CrossCheckGuardado['results'][number]> = {}): CrossCheckGuardado {
  return {
    passed: true,
    solo_alerta: true,
    results: [{
      slug: 'fecha_expedicion',
      label: 'Certificado vigente el día de la cita',
      expected: '',
      extracted: '2026-07-24',
      ok: true,
      mode: 'vigencia',
      estado: 'ok',
      vigencia: 'vigente',
      pedir_desde: null,
      criterio: 'margen',
      ...over,
    }],
  }
}

describe('refrescarVigenciaCrossCheck', () => {
  it('sin cita, el veredicto CADUCA con el paso del tiempo', () => {
    // Expedido el 24-jul. El 13-ago le quedan 20 días de los 30: con margen de
    // 10 todavía sirve. Es el estado que quedó guardado.
    const alDia = refrescarVigenciaCrossCheck(guardado(), [CHECK_CON_MARGEN], () => '', '2026-08-13')
    expect(alDia?.results[0].vigencia).toBe('vigente')

    // Diez días después el mismo documento ya no alcanza, y la pantalla tiene
    // que decirlo aunque nadie haya vuelto a tocar el bloque.
    const despues = refrescarVigenciaCrossCheck(guardado(), [CHECK_CON_MARGEN], () => '', '2026-08-24')
    expect(despues?.results[0].vigencia).toBe('reemplazar')
    expect(despues?.results[0].estado).toBe('falla')
    expect(despues?.results[0].ok).toBe(false)
    expect(despues?.results[0].criterio).toBe('margen')
    expect(despues?.passed).toBe(false)
  })

  it('la cita REPROGRAMADA se refleja: el objetivo sale del dato de hoy', () => {
    // Guardado contra una cita del 20-ago (26 días: vigente). La DIAN la corre
    // al 30-sep y el certificado deja de servir.
    const cc = guardado({ expected: '2026-08-20', criterio: 'cita' })
    const out = refrescarVigenciaCrossCheck(cc, [CHECK_CON_CITA], () => '2026-09-30', '2026-08-13')
    expect(out?.results[0].expected).toBe('2026-09-30')
    expect(out?.results[0].vigencia).toBe('esperar')
    expect(out?.results[0].criterio).toBe('cita')
    // Pedirlo hoy tampoco serviría: la pantalla dice desde cuándo tiene sentido.
    expect(out?.results[0].pedir_desde).toBe('2026-08-31')
  })

  it('un check sin cambios devuelve el MISMO objeto (no reescribe por gusto)', () => {
    const cc = guardado({ expected: '', criterio: 'margen', vigencia: 'vigente' })
    const out = refrescarVigenciaCrossCheck(cc, [CHECK_CON_MARGEN], () => '', '2026-08-13')
    expect(out).toBe(cc)
  })

  it('NO toca los modos que no son vigencia', () => {
    const cc: CrossCheckGuardado = {
      passed: false,
      results: [{ slug: 'nit', expected: '900', extracted: '901', ok: false, mode: 'exact', estado: 'falla' }],
    }
    const out = refrescarVigenciaCrossCheck(cc, [CHECK_CON_MARGEN], () => '2026-09-30', '2026-08-13')
    expect(out).toBe(cc)
  })

  it('con fuentes ALTERNATIVAS se respeta el veredicto guardado', () => {
    // Elegir entre alternativas es "la que pasa", no "la primera que existe":
    // reproducir ese criterio aquí sería una segunda copia de la misma regla.
    const spec: SpecVigencia = { ...CHECK_CON_MARGEN, source_alternatives: [{}] }
    const cc = guardado()
    const out = refrescarVigenciaCrossCheck(cc, [spec], () => '', '2026-08-24')
    expect(out).toBe(cc)
  })

  it('si el bloque fuente no se resuelve, la fila queda intacta', () => {
    // `null` (no se pudo resolver) es distinto de '' (no hay cita todavía, que
    // sí es una respuesta y activa el margen).
    const cc = guardado()
    const out = refrescarVigenciaCrossCheck(cc, [CHECK_CON_MARGEN], () => null, '2026-08-24')
    expect(out).toBe(cc)
  })

  it('sin resolvedor del extraído, un cross_check ausente pasa sin tocarse', () => {
    expect(refrescarVigenciaCrossCheck(null, [CHECK_CON_MARGEN], () => '', '2026-08-13')).toBeNull()
    const vacio: CrossCheckGuardado = { passed: true, results: [] }
    expect(refrescarVigenciaCrossCheck(vacio, [CHECK_CON_MARGEN], () => '', '2026-08-13')).toBe(vacio)
  })

  it('SINTETIZA el veredicto de un documento cargado antes de que el check existiera', () => {
    // Medido en SOENA: 136 abiertos con certificado y solo 22 con veredicto. Sin
    // esto la alerta llegaría a uno de cada seis.
    const out = refrescarVigenciaCrossCheck(
      null, [CHECK_CON_MARGEN], () => '', '2026-08-24', () => '2026-07-24',
    )
    expect(out?.results).toHaveLength(1)
    expect(out?.results[0].vigencia).toBe('reemplazar')
    expect(out?.results[0].label).toBe(CHECK_CON_MARGEN.label)
    expect(out?.passed).toBe(false)
  })

  it('NO sintetiza si el bloque tiene checks de otros modos sin evaluar', () => {
    // Un panel que dice "validado" afirmaría de más sobre comprobaciones que
    // nadie hizo: sin extracción no se puede recalcular un match de texto.
    const otro: SpecVigencia = { slug: 'nit', match_mode: 'exact' }
    const out = refrescarVigenciaCrossCheck(
      null, [CHECK_CON_MARGEN, otro], () => '', '2026-08-24', () => '2026-07-24',
    )
    expect(out).toBeNull()
  })

  it('no sintetiza cuando el documento no trajo la fecha de expedición', () => {
    const out = refrescarVigenciaCrossCheck(
      null, [CHECK_CON_MARGEN], () => '', '2026-08-24', () => null,
    )
    expect(out).toBeNull()
  })

  it('recuperarse también se ve: un certificado nuevo vuelve a vigente', () => {
    // El equipo reemplazó el documento y el bloque quedó guardado como vencido
    // por la corrida anterior; al releer con la expedición nueva, sale vigente.
    const cc = guardado({ extracted: '2026-08-20', vigencia: 'reemplazar', estado: 'falla', ok: false })
    const out = refrescarVigenciaCrossCheck(cc, [CHECK_CON_MARGEN], () => '', '2026-08-24')
    expect(out?.results[0].vigencia).toBe('vigente')
    expect(out?.passed).toBe(true)
  })
})
