/**
 * Las reglas puras del recibo por concepto.
 *
 * Lo que este archivo fija y no se puede probar desde la emisión: que **un solo helper**
 * responde las tres preguntas que antes hacía cada consumidor por su cuenta (¿tiene
 * recibo?, ¿qué número muestro?, ¿qué PDF abro?), y que tolera las **17 marcas viejas**
 * —16 en `soena`, 1 en `metrik`, contadas contra producción el 2026-09-19— que están
 * guardadas como objeto suelto.
 *
 * Es el patrón de `esPorcionPendienteDeConfirmar` del PR #738: un criterio, y los
 * llamadores lo consumen sin repetirlo.
 */
import { describe, it, expect } from 'vitest'
import {
  abonosAManoDelCobro,
  componentesConValor,
  componentesEmitidos,
  conEntradaDeComponente,
  hayReciboPorElTotal,
  leerReciboPorConcepto,
  planDeEmision,
  primerRecibo,
  reciboCompleto,
  recibosDelCobro,
  repartoDeCobro,
  SUFIJO_IDEMPOTENCIA,
  SUFIJO_IDEMPOTENCIA_ABONO,
  tieneRecibo,
} from './recibo-componentes'

/** Tal cual está guardada en producción: objeto suelto, sin `componente`. */
const MARCA_VIEJA = {
  at: '2026-09-07T22:48:49.285Z',
  por: null,
  fecha: '2026-03-31',
  valor: 297_500,
  numero: 'RC-1-67',
  siigo_id: '8d45f2ef-40b4-45d9-b461-85a06d65785f',
  fecha_pago: '2026-03-31',
  archivo_url: 'https://drive.google.com/file/d/abc/view?usp=drivesdk',
}

const MARCA_HONORARIO = { numero: 'RC-1-70', siigo_id: 'a', valor: 400_000, archivo_url: null, at: '', por: null, componente: 'honorario' as const }
const MARCA_PASANTE = { numero: 'RC-9-3', siigo_id: 'b', valor: 600_000, archivo_url: null, at: '', por: null, componente: 'pasante' as const }

describe('la marca del cobro se lee igual en sus dos formas', () => {
  it('la forma VIEJA (objeto suelto) se lee como una lista de uno', () => {
    expect(recibosDelCobro(MARCA_VIEJA).map(m => m.numero)).toEqual(['RC-1-67'])
    expect(tieneRecibo(MARCA_VIEJA)).toBe(true)
    expect(primerRecibo(MARCA_VIEJA)?.numero).toBe('RC-1-67')
  })

  it('la forma nueva (lista) conserva el orden de emisión', () => {
    const lista = [MARCA_HONORARIO, MARCA_PASANTE]
    expect(recibosDelCobro(lista).map(m => m.numero)).toEqual(['RC-1-70', 'RC-9-3'])
    expect(primerRecibo(lista)?.numero).toBe('RC-1-70')
  })

  it('null, lista vacía y basura no son un recibo', () => {
    // ⚠️ Una lista VACÍA es `truthy`: quien pregunte con `if (siigo_recibo)` la lee como
    // "ya tiene recibo" y el cobro no volvería a emitir nunca.
    for (const v of [null, undefined, [], {}, 'RC-1-70', { numero: '' }, [{ numero: '' }]]) {
      expect(tieneRecibo(v)).toBe(false)
      expect(primerRecibo(v)).toBeNull()
    }
  })
})

describe('qué cubre una marca', () => {
  it('una marca sin componente acusa el TOTAL y cubre el cobro entero', () => {
    // Los 3 mixtos que ya tienen recibo se quedan como están: re-emitir consume
    // numeración en la contabilidad del cliente y no se deshace.
    expect(hayReciboPorElTotal(MARCA_VIEJA)).toBe(true)
    expect(reciboCompleto(MARCA_VIEJA, ['honorario', 'pasante'])).toBe(true)
  })

  it('con componentes declarados, tener UNO de DOS no es estar completo', () => {
    expect(reciboCompleto([MARCA_HONORARIO], ['honorario', 'pasante'])).toBe(false)
    expect(reciboCompleto([MARCA_HONORARIO, MARCA_PASANTE], ['honorario', 'pasante'])).toBe(true)
  })

  it('sin componentes declarados basta un recibo cualquiera, que es el criterio de siempre', () => {
    expect(reciboCompleto([MARCA_HONORARIO], [])).toBe(true)
    expect(reciboCompleto(null, [])).toBe(false)
  })

  it('componentesEmitidos ignora las marcas que no declaran componente', () => {
    expect([...componentesEmitidos([MARCA_VIEJA, MARCA_PASANTE])]).toEqual(['pasante'])
  })
})

describe('leerReciboPorConcepto: el interruptor de toda la regla', () => {
  it('una línea que no lo declara devuelve null, y eso deja el camino de siempre', () => {
    expect(leerReciboPorConcepto(undefined)).toBeNull()
    expect(leerReciboPorConcepto({ recibo_concepto: 'Dinero recibido del cliente' })).toBeNull()
    expect(leerReciboPorConcepto({ recibo_por_concepto: {} })).toBeNull()
    // Declararlo como lista o como texto no es declararlo.
    expect(leerReciboPorConcepto({ recibo_por_concepto: [] })).toBeNull()
    expect(leerReciboPorConcepto({ recibo_por_concepto: 'sí' })).toBeNull()
  })

  it('lee los dos componentes y descarta lo que no está en la lista cerrada', () => {
    const cfg = leerReciboPorConcepto({
      recibo_por_concepto: {
        honorario: { document_id: 101, concepto: 'Honorarios de asesoría' },
        pasante: { document_id: 202, concepto: 'Recaudo para tercero', bloque_slug: 'recibo_terceros' },
        inventado: { document_id: 999, concepto: 'No existe' },
      },
    })
    expect(Object.keys(cfg!)).toEqual(['honorario', 'pasante'])
    expect(cfg!.pasante).toEqual({
      document_id: 202, concepto: 'Recaudo para tercero', bloque_slug: 'recibo_terceros',
    })
  })

  // ⚠️ Es el estado real de la configuración mientras el comprobante no exista.
  it('un `document_id` en 0 NO es un comprobante: se lee como ausente', () => {
    const cfg = leerReciboPorConcepto({
      recibo_por_concepto: {
        honorario: { document_id: 4594, concepto: 'Honorarios de asesoría' },
        pasante: { document_id: 0, concepto: 'Recaudo para tercero' },
      },
    })
    expect(cfg!.pasante?.document_id).toBeUndefined()
  })
})

describe('el reparto se consume, no se inventa', () => {
  const FILA = { a_tramo1: 400_000, a_tramo2: 50_000, a_tarifa: 600_000, excedente: 10_000 }

  it('honorario es tramo1 + tramo2 + excedente; pasante es la tarifa', () => {
    // Las dos bolsas que `ImputacionPago` ya expone con esos mismos nombres.
    expect(repartoDeCobro(FILA, { monto: 1_060_000 })).toEqual({ honorario: 460_000, pasante: 600_000 })
  })

  it('sin fila no se adivina: devuelve null para que quien llama PARE', () => {
    expect(repartoDeCobro(null, { monto: 1_000_000, tipo_cobro: 'anticipo' })).toBeNull()
  })

  it('salvo `tipo_cobro = pasante`, que es 100% de terceros por definición', () => {
    // `v_cobro_valor` lo excluye a propósito. Medido el 2026-09-19: cero cobros así en
    // toda la base, pero la regla queda escrita para el día que haya uno.
    expect(repartoDeCobro(null, { monto: 600_000, tipo_cobro: 'pasante' })).toEqual({
      honorario: 0, pasante: 600_000,
    })
  })
})

describe('planDeEmision: un recibo por componente con valor mayor a cero', () => {
  const CFG = {
    honorario: { document_id: 101, concepto: 'Honorarios de asesoría' },
    pasante: { document_id: 202, concepto: 'Recaudo para tercero' },
  }

  it('un mixto produce dos, en orden de imputación y con claves distintas', () => {
    const p = planDeEmision({ honorario: 400_000, pasante: 600_000 }, CFG, 'recibo_caja')
    expect(p.ok && p.componentes.map(c => c.componente)).toEqual(['honorario', 'pasante'])
    expect(p.ok && p.componentes.map(c => c.documentId)).toEqual([101, 202])
    expect(p.ok && new Set(p.componentes.map(c => c.sufijoIdempotencia)).size).toBe(2)
  })

  it('un componente en cero no produce recibo, y tampoco produce error', () => {
    const p = planDeEmision({ honorario: 400_000, pasante: 0 }, CFG)
    expect(p.ok && p.componentes.map(c => c.componente)).toEqual(['honorario'])
  })

  it('un componente con plata y sin comprobante configurado FRENA, no emite a medias', () => {
    const p = planDeEmision({ honorario: 400_000, pasante: 600_000 }, { honorario: CFG.honorario })
    expect(p.ok).toBe(false)
    expect(!p.ok && p.faltantes.join(' ')).toContain('pasante')
  })

  it('cada componente puede archivar en su propio bloque, y si no, en el de la línea', () => {
    const p = planDeEmision({ honorario: 1, pasante: 1 }, {
      honorario: CFG.honorario,
      pasante: { ...CFG.pasante, bloque_slug: 'recibo_terceros' },
    }, 'recibo_caja')
    expect(p.ok && p.componentes.map(c => c.bloqueSlug)).toEqual(['recibo_caja', 'recibo_terceros'])
  })
})

/**
 * ⚠️ Estos sufijos NO se cambian nunca.
 *
 * `claveIdempotencia` es determinista desde el cobro: si el sufijo cambia entre
 * despliegues, un reintento deja de reconocer el recibo que ya existe en Siigo y emite
 * otro, consumiendo numeración en la contabilidad del cliente. Eso no se deshace.
 */
describe('la clave de idempotencia de cada componente es estable', () => {
  it('son los valores con los que se emitió la primera vez', () => {
    expect(SUFIJO_IDEMPOTENCIA).toEqual({ honorario: 'rchon', pasante: 'rcpas' })
  })

  it('y no chocan con el sufijo del recibo por el total', () => {
    expect(Object.values(SUFIJO_IDEMPOTENCIA)).not.toContain('rc')
  })
})

describe('componentesConValor', () => {
  it('sin reparto no hay componentes que exigir', () => {
    expect(componentesConValor(null)).toEqual([])
  })

  it('devuelve solo las bolsas con plata, en orden de imputación', () => {
    expect(componentesConValor({ honorario: 0, pasante: 600_000 })).toEqual(['pasante'])
    expect(componentesConValor({ honorario: 1, pasante: 1 })).toEqual(['honorario', 'pasante'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// El honorario como ABONO a la factura (2026-09-22)
// ─────────────────────────────────────────────────────────────────────────────

describe('leerReciboPorConcepto: el honorario puede declararse abono', () => {
  it('honorario con tipo abono se lee como abono', () => {
    const cfg = leerReciboPorConcepto({
      recibo_por_concepto: { honorario: { document_id: 4594, concepto: 'Honorarios de asesoría', tipo: 'abono' } },
    })
    expect(cfg?.honorario?.tipo).toBe('abono')
  })

  it('sin tipo es anticipo, el de siempre: la config de hoy no cambia de significado', () => {
    // Es la config que SOENA tiene en producción el 2026-09-22.
    const cfg = leerReciboPorConcepto({
      recibo_por_concepto: {
        honorario: { document_id: 4594, concepto: 'Honorarios de asesoría' },
        pasante: { document_id: 33546, concepto: 'Recaudo pago certificación UPME' },
      },
    })
    expect(cfg?.honorario?.tipo).toBeUndefined()
    expect(cfg?.pasante?.tipo).toBeUndefined()
  })

  it('el componente PASANTE nunca es abono: la tarifa no está en la factura', () => {
    const cfg = leerReciboPorConcepto({
      recibo_por_concepto: { pasante: { document_id: 33546, concepto: 'x', tipo: 'abono' } },
    })
    expect(cfg?.pasante?.tipo).toBeUndefined()
  })

  it('un tipo desconocido tampoco es abono', () => {
    const cfg = leerReciboPorConcepto({
      recibo_por_concepto: { honorario: { document_id: 4594, concepto: 'x', tipo: 'Abono ' } },
    })
    expect(cfg?.honorario?.tipo).toBeUndefined()
  })
})

describe('planDeEmision: el abono sale con su propio sufijo', () => {
  const cfg = {
    honorario: { document_id: 4594, concepto: 'Honorarios de asesoría', tipo: 'abono' as const },
    pasante: { document_id: 33546, concepto: 'Recaudo pago certificación UPME' },
  }

  it('el honorario sale como abono y la tarifa como anticipo', () => {
    const plan = planDeEmision({ honorario: 637_500, pasante: 701_812 }, cfg)
    expect(plan.ok && plan.componentes.map(c => [c.componente, c.tipo ?? 'anticipo', c.sufijoIdempotencia]))
      .toEqual([['honorario', 'abono', 'abhon'], ['pasante', 'anticipo', 'rcpas']])
  })

  it('⚠️ el sufijo del abono NO se cambia nunca, y no es el del anticipo', () => {
    // Si cambiara entre despliegues, un reintento dejaría de reconocer el abono que ya
    // existe en Siigo y cruzaría la factura dos veces.
    expect(SUFIJO_IDEMPOTENCIA_ABONO).toBe('abhon')
    expect(SUFIJO_IDEMPOTENCIA_ABONO).not.toBe(SUFIJO_IDEMPOTENCIA.honorario)
  })
})

describe('las entradas «a mano» viven en la lista sin contar como recibo', () => {
  const A_MANO = {
    componente: 'honorario' as const,
    abono_a_mano: { motivo: 'retencion', detalle: 'El pago trae retención…' },
    valor: 637_500, at: '', por: null,
  }
  const MARCA_PASANTE = {
    numero: 'RC-3-5', siigo_id: 'b', valor: 701_812, archivo_url: null, at: '', por: null,
    componente: 'pasante' as const,
  }

  it('no cuenta como recibo en ninguno de los criterios', () => {
    expect(recibosDelCobro([A_MANO])).toEqual([])
    expect(tieneRecibo([A_MANO])).toBe(false)
    expect(componentesEmitidos([A_MANO]).has('honorario')).toBe(false)
    expect(primerRecibo([A_MANO, MARCA_PASANTE])?.numero).toBe('RC-3-5')
  })

  it('se lee con su propio helper', () => {
    expect(abonosAManoDelCobro([MARCA_PASANTE, A_MANO])).toEqual([A_MANO])
    expect(abonosAManoDelCobro(MARCA_VIEJA)).toEqual([])
    expect(abonosAManoDelCobro(null)).toEqual([])
  })

  it('⚠️ escribir el recibo de la TARIFA no borra el «a mano» del honorario', () => {
    // Reconstruir la lista con `recibosDelCobro` lo habría borrado, y el pendiente quedaba
    // sin su explicación.
    expect(conEntradaDeComponente([A_MANO], MARCA_PASANTE)).toEqual([A_MANO, MARCA_PASANTE])
  })

  it('el recibo del honorario que por fin sale REEMPLAZA su «a mano»', () => {
    const abono = { ...MARCA_HONORARIO, tipo: 'abono' as const }
    expect(conEntradaDeComponente([A_MANO, MARCA_PASANTE], abono)).toEqual([MARCA_PASANTE, abono])
  })

  it('la marca vieja por el total entra a la lista y no se toca', () => {
    expect(conEntradaDeComponente(MARCA_VIEJA, MARCA_PASANTE)).toEqual([MARCA_VIEJA, MARCA_PASANTE])
  })
})
