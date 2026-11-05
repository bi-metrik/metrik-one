import { describe, it, expect } from 'vitest'
import type { CampoExtraccion, CampoResultado } from '@/lib/ai/extract-fields'
import { aplicarNormalizaciones, CONFIANZA_REVISAR } from './normalizaciones'
import { derivarCampos, revisarCoherenciaPct } from './derivar'

/**
 * SOE-041: la factura del vehículo extrae el descuento y el código hace la resta.
 *
 * Los fixtures son los montos impresos de los casos verificados contra el PDF (brief
 * `proyectos/soena/ve/2026-11-05_brief-max-descuento-factura.md`), sin PDF ni modelo:
 * lo que se prueba es la aritmética y las alertas sobre lo que el modelo devolvería.
 * La config replica la que deja el SQL `sql/soena/2026-11-05_soe041-factura-descuento.sql`.
 */

function campo(slug: string, extra: Partial<CampoExtraccion> = {}): CampoExtraccion {
  return { slug, label: slug, tipo: 'currency', required: false, descripcion_ai: '', ...extra }
}

const FACTURA: CampoExtraccion[] = [
  campo('valor_unitario_sin_iva', {
    required: true,
    derivar: { resta: ['valor_antes_descuento', 'descuento'] },
  }),
  campo('valor_antes_descuento'),
  campo('descuento'),
  campo('valor_iva', {
    coherencia_pct: { de: ['valor_unitario_sin_iva', 'valor_antes_descuento'], pct: [0.05, 0.19], tolerancia: 0.0002 },
  }),
]

/** Igual que extract-fields: bajo 0.70 el valor se descarta. */
function leido(value: string | null, confidence = 0.95): CampoResultado {
  return value === null || confidence < 0.7
    ? { value: null, confidence, manual: true }
    : { value, confidence, manual: false }
}

function factura(v: { valor: string | null; antes: string | null; descuento: string | null; iva: string | null }) {
  return {
    valor_unitario_sin_iva: leido(v.valor),
    valor_antes_descuento: leido(v.antes),
    descuento: leido(v.descuento),
    valor_iva: leido(v.iva),
  } as Record<string, CampoResultado>
}

const verificar = (c: CampoResultado) => c.confidence <= CONFIANZA_REVISAR && c.confidence >= 0.7 && !c.manual
const limpio = (c: CampoResultado) => c.confidence === 0.95

describe('SOE-041 — casos verificados contra el PDF', () => {
  it('V0263 (Distrikia, KIA): valor vehículo − descuento = lo que aprueba la UPME', () => {
    const r = factura({ valor: '116805310', antes: '116805310', descuento: '2790266', iva: '5700752' })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('114015044')
    expect(r.valor_unitario_sin_iva.derivado).toEqual({
      formula: 'valor_antes_descuento - descuento',
      leido: '116805310',
    })
    expect(limpio(r.valor_unitario_sin_iva)).toBe(true)
    expect(limpio(r.valor_iva)).toBe(true)
  })

  it('V0326 (Euro Marcali, Volvo): precio sin impuestos − descuento', () => {
    const r = factura({ valor: '264661157', antes: '264661157', descuento: '8462810', iva: '12809917' })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('256198347')
    expect(limpio(r.valor_iva)).toBe(true)
  })

  it('V0552 (BG Movilidad, Geely): descuento implícito de la línea (2.000.000)', () => {
    const r = factura({ valor: '114371429', antes: '114371429', descuento: '2000000', iva: '5618571' })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('112371429')
    expect(limpio(r.valor_iva)).toBe(true)
  })

  it('V0126 (Juanautos) régimen B: el valor sale bien y el IVA cuadra con la lista', () => {
    const r = factura({ valor: '107300886', antes: '112300885', descuento: '4999999', iva: '5615044' })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('107300886')
    expect(r.valor_unitario_sin_iva.derivado?.leido).toBe('107300886')
    // 5.615.044 / 107.300.886 = 5,23 %: no cuadra con el valor, sí con la lista.
    expect(limpio(r.valor_iva)).toBe(true)
    expect(limpio(r.valor_unitario_sin_iva)).toBe(true)
  })

  it('V0659 (Juanautos) régimen B', () => {
    const r = factura({ valor: '93132743', antes: '95132743', descuento: '2000000', iva: '4756637' })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('93132743')
    expect(limpio(r.valor_iva)).toBe(true)
  })

  it('V0650 (Massy, foto) sin descuento, un dígito de más: el valor no se toca y va a Verificar', () => {
    const r = factura({ valor: '117495575', antes: '111495575', descuento: '0', iva: '5574778' })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('117495575')
    expect(r.valor_unitario_sin_iva.derivado).toBeUndefined()
    expect(verificar(r.valor_unitario_sin_iva)).toBe(true)
  })

  it('V0650 sin el valor antes de descuento: lo agarra la coherencia del IVA', () => {
    const r = factura({ valor: '117495575', antes: null, descuento: '0', iva: '5574778' })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('117495575')
    expect(r.valor_iva.value).toBe('5574778')
    expect(verificar(r.valor_iva)).toBe(true)
    expect(verificar(r.valor_unitario_sin_iva)).toBe(true)
  })

  it('V0650 con el mismo dígito mal en las dos casillas: lo agarra la coherencia del IVA', () => {
    const r = factura({ valor: '117495575', antes: '117495575', descuento: '0', iva: '5574778' })
    aplicarNormalizaciones(FACTURA, r)
    expect(verificar(r.valor_iva)).toBe(true)
    expect(verificar(r.valor_unitario_sin_iva)).toBe(true)
  })

  it('V0531 (Tesla) sin descuento, restó el IVA e IVA 0: no se toca y alerta', () => {
    const r = factura({ valor: '112181429', antes: '118085714', descuento: null, iva: '0' })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('112181429')
    expect(r.valor_iva.value).toBe('0')
    expect(verificar(r.valor_unitario_sin_iva)).toBe(true)
    expect(verificar(r.valor_iva)).toBe(true)
  })

  it('V0531 sin el valor antes de descuento: el IVA en 0 basta para alertar', () => {
    const r = factura({ valor: '112181429', antes: null, descuento: null, iva: '0' })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('112181429')
    expect(verificar(r.valor_unitario_sin_iva)).toBe(true)
    expect(verificar(r.valor_iva)).toBe(true)
  })
})

describe('coherencia_pct — descuento NO extraído (el modelo devolvió 0 y el valor de lista)', () => {
  // Con ±0,002 ninguno alertaba: 4,88 %, 4,84 % y 4,91 % quedan a menos de 0,2 pp del 5 %.
  it.each([
    ['V0263', '116805310', '5700752'],
    ['V0326', '264661157', '12809917'],
    ['V0552', '114371429', '5618571'],
  ])('%s alerta por coherencia', (_caso, valor, iva) => {
    const r = factura({ valor, antes: valor, descuento: '0', iva })
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe(valor)
    expect(verificar(r.valor_iva)).toBe(true)
    expect(verificar(r.valor_unitario_sin_iva)).toBe(true)
  })

  it('el default del código es el mismo ±0,0002 (config sin tolerancia)', () => {
    const sinTol = FACTURA.map((c) => c.coherencia_pct
      ? { ...c, coherencia_pct: { de: c.coherencia_pct.de, pct: c.coherencia_pct.pct } }
      : c)
    const r = factura({ valor: '116805310', antes: '116805310', descuento: '0', iva: '5700752' })
    expect(revisarCoherenciaPct(sinTol, r)).toHaveLength(1)
  })
})

describe('derivar.resta — bordes', () => {
  it('no pisa un campo protegido (corregido a mano)', () => {
    const r = factura({ valor: null, antes: '116805310', descuento: '2790266', iva: '5700752' })
    r.valor_unitario_sin_iva = {
      value: '116000000', confidence: 1, manual: true,
      edicion: { editado_por_id: 'x', editado_por_nombre: 'Deisy', editado_en: '2026-11-05T00:00:00Z' },
    }
    aplicarNormalizaciones(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('116000000')
    expect(r.valor_unitario_sin_iva.confidence).toBe(1)
    expect(r.valor_unitario_sin_iva.derivado).toBeUndefined()
  })

  it('descuento sin valor antes de descuento: no se toca y va a Verificar', () => {
    const r = factura({ valor: '116805310', antes: null, descuento: '2790266', iva: '5700752' })
    derivarCampos(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('116805310')
    expect(verificar(r.valor_unitario_sin_iva)).toBe(true)
  })

  it('descuento mayor o igual al valor: no se toca y va a Verificar', () => {
    const r = factura({ valor: '5000000', antes: '5000000', descuento: '5000000', iva: null })
    derivarCampos(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('5000000')
    expect(verificar(r.valor_unitario_sin_iva)).toBe(true)
  })

  it('sin descuento y valor = valor antes: no cambia nada', () => {
    const r = factura({ valor: '118085714', antes: '118085714', descuento: '0', iva: '5904286' })
    const antes = structuredClone(r)
    aplicarNormalizaciones(FACTURA, r)
    expect(r).toEqual(antes)
  })

  it('montos con formato colombiano pasan por parseMontoCop', () => {
    const r = factura({ valor: '114371429', antes: '$ 114.371.429', descuento: '2.000.000,00', iva: '5618571' })
    derivarCampos(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('112371429')
  })

  it('la confianza del derivado es la menor de las fuentes', () => {
    const r = factura({ valor: '116805310', antes: '116805310', descuento: '2790266', iva: '5700752' })
    r.descuento.confidence = 0.8
    derivarCampos(FACTURA, r)
    expect(r.valor_unitario_sin_iva.confidence).toBe(0.8)
  })

  it('el campo derivado se crea si el modelo no lo devolvió', () => {
    const r = factura({ valor: null, antes: '116805310', descuento: '2790266', iva: null })
    delete (r as Record<string, unknown>).valor_unitario_sin_iva
    derivarCampos(FACTURA, r)
    expect(r.valor_unitario_sin_iva).toMatchObject({ value: '114015044', manual: false })
    expect(r.valor_unitario_sin_iva.derivado?.leido).toBeNull()
  })

  it('un bloque sin la config no cambia nada (la misma factura, sin derivar ni coherencia)', () => {
    const sinConfig = FACTURA.map(({ derivar: _d, coherencia_pct: _c, ...resto }) => resto)
    const r = factura({ valor: '117495575', antes: '116805310', descuento: '2790266', iva: '0' })
    const antes = structuredClone(r)
    aplicarNormalizaciones(sinConfig, r)
    expect(r).toEqual(antes)
  })
})

describe('derivar.resta — corrección a mano de una fuente (soloDesde)', () => {
  const aMano = (value: string): CampoResultado => ({
    value, confidence: 1, manual: true,
    edicion: { editado_por_id: 'x', editado_por_nombre: 'Deisy', editado_en: '2026-11-05T00:00:00Z' },
  })

  it('corregir el descuento recalcula el valor', () => {
    const r = factura({ valor: '116805310', antes: '116805310', descuento: '2790266', iva: '5700752' })
    aplicarNormalizaciones(FACTURA, r)
    r.descuento = aMano('2790000')
    derivarCampos(FACTURA, r, 'descuento')
    expect(r.valor_unitario_sin_iva.value).toBe('114015310')
    // El testigo sigue siendo lo que leyó el modelo, no el derivado anterior.
    expect(r.valor_unitario_sin_iva.derivado?.leido).toBe('116805310')
  })

  it('poner el descuento en 0 devuelve lo que había leído el modelo', () => {
    const r = factura({ valor: '116805310', antes: '116805310', descuento: '2790266', iva: '5700752' })
    aplicarNormalizaciones(FACTURA, r)
    r.descuento = aMano('0')
    derivarCampos(FACTURA, r, 'descuento')
    expect(r.valor_unitario_sin_iva.value).toBe('116805310')
    expect(r.valor_unitario_sin_iva.derivado).toBeUndefined()
  })

  it('no recalcula si el resultado ya lo fijó una persona', () => {
    const r = factura({ valor: null, antes: '116805310', descuento: '2790266', iva: '5700752' })
    r.valor_unitario_sin_iva = aMano('114015044')
    r.descuento = aMano('3000000')
    derivarCampos(FACTURA, r, 'descuento')
    expect(r.valor_unitario_sin_iva.value).toBe('114015044')
  })

  it('corregir un campo que no es fuente no recalcula nada', () => {
    const r = factura({ valor: '116805310', antes: '116805310', descuento: '2790266', iva: '5700752' })
    expect(derivarCampos(FACTURA, r, 'valor_iva')).toEqual([])
    expect(r.valor_unitario_sin_iva.value).toBe('116805310')
  })
})

describe('coherencia_pct — bordes', () => {
  it('sin ninguna base presente no dice nada', () => {
    const r = factura({ valor: null, antes: null, descuento: null, iva: '5700752' })
    expect(revisarCoherenciaPct(FACTURA, r)).toEqual([])
    expect(limpio(r.valor_iva)).toBe(true)
  })

  it('acepta el 19 %', () => {
    const r = factura({ valor: '100000000', antes: null, descuento: null, iva: '19000000' })
    expect(revisarCoherenciaPct(FACTURA, r)).toEqual([])
  })

  it('no baja un IVA protegido, pero sí el valor', () => {
    const r = factura({ valor: '117495575', antes: null, descuento: null, iva: null })
    r.valor_iva = { value: '5574778', confidence: 1, manual: true }
    const alertas = revisarCoherenciaPct(FACTURA, r)
    expect(alertas).toHaveLength(1)
    expect(r.valor_iva.confidence).toBe(1)
    expect(verificar(r.valor_unitario_sin_iva)).toBe(true)
  })

  it('solo alerta: no cambia ningún valor', () => {
    const r = factura({ valor: '117495575', antes: null, descuento: null, iva: '5574778' })
    revisarCoherenciaPct(FACTURA, r)
    expect(r.valor_unitario_sin_iva.value).toBe('117495575')
    expect(r.valor_iva.value).toBe('5574778')
  })
})
