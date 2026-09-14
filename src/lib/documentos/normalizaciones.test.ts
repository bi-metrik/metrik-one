import { describe, it, expect } from 'vitest'
import type { CampoExtraccion, CampoResultado } from '@/lib/ai/extract-fields'
import { aplicarNormalizaciones, normalizarNitYDv, CONFIANZA_REVISAR, campoProtegido } from './normalizaciones'

/**
 * Normalización del NIT y el DV (2026-09-14).
 *
 * Los fixtures replican las configuraciones de producción de SOENA, leídas de
 * `bloque_configs.config_extra.campos_extraccion` el mismo día:
 *  - `rut`: `nit` sin normalizar, `dv` con `dv_desde_nit` desde `nit`, y
 *    `numero_identificacion`.
 *  - `rut_solicitante_2`: los mismos tres campos, SIN ninguna normalización.
 *  - `certificado_de_existencia_del_banco`: `nit` y `dv`, sin identificación.
 *
 * Vistas fallar contra el código anterior (`git show origin/main`, la función vivía
 * dentro de `documento-actions.ts`): con esa implementación caen 8 de 15, entre ellas
 * las 4 marcadas [ROJO EN MAIN], porque `dv_desde_nit` calculaba el DV sobre el NIT
 * crudo y nadie quitaba el dígito pegado.
 *
 * Mutaciones medidas el 2026-09-14 sobre esta suite más `nit.test.ts` (68 pruebas):
 *  - quitar la regla del NIT completo (recortar con solo el DV leído, como pedía el
 *    brief): 2 caen, las dos de Bancolombia.
 *  - que la identificación que calza no proteja: 3 caen.
 *  - recortar un NIT protegido: 1 cae.
 *  - calcular el DV sobre `nitC.value` en vez de `nitFinal`: 0 caen, y es correcto,
 *    porque `nitC` ES `resultado.nit` y ya viene recortado. Mutación equivalente.
 *  - un piso de 0.70 en `bajarConfianza`: 0 caen → código muerto, se quitó.
 */

function campo(slug: string, extra: Partial<CampoExtraccion> = {}): CampoExtraccion {
  return { slug, label: slug, tipo: 'texto', required: true, descripcion_ai: '', ...extra }
}

const RUT: CampoExtraccion[] = [
  campo('nit'),
  campo('dv', { normalizar: 'dv_desde_nit', normalizar_desde: 'nit' }),
  campo('numero_identificacion'),
  campo('razon_social'),
]

const RUT_SOLICITANTE_2: CampoExtraccion[] = [campo('nit'), campo('dv'), campo('numero_identificacion')]

const CERT_BANCO: CampoExtraccion[] = [campo('nit'), campo('dv', { required: false })]

function leido(value: string | null, confidence = 0.95): CampoResultado {
  return value === null || confidence < 0.7
    ? { value: null, confidence, manual: true }
    : { value, confidence, manual: false }
}

describe('aplicarNormalizaciones — RUT con el DV pegado', () => {
  it('[ROJO EN MAIN] quita el DV pegado y deja el DV correcto (52217225 / DV 2)', () => {
    const r: Record<string, CampoResultado> = {
      nit: leido('522172252'),
      dv: leido('2'),
      numero_identificacion: leido('52217225'),
    }
    aplicarNormalizaciones(RUT, r)
    expect(r.nit.value).toBe('52217225')
    expect(r.dv.value).toBe('2')
    // Nada que revisar: la identificación es testigo suficiente.
    expect(r.nit.confidence).toBe(0.95)
    expect(r.dv.confidence).toBe(0.95)
  })

  it('[ROJO EN MAIN] el DV sale del NIT limpio, nunca del número pegado', () => {
    // 1032392837 + DV 6 pegado. El DV de 10323928376 NO es 6: así nacía el DV malo.
    const r: Record<string, CampoResultado> = {
      nit: leido('10323928376'),
      dv: leido('6'),
      numero_identificacion: leido('1032392837'),
    }
    aplicarNormalizaciones(RUT, r)
    expect(r.nit.value).toBe('1032392837')
    expect(r.dv.value).toBe('6')
  })

  it('[ROJO EN MAIN] cubre también rut_solicitante_2, que no declara ninguna normalización', () => {
    const r: Record<string, CampoResultado> = {
      nit: leido('167270579'),
      dv: leido('9'),
      numero_identificacion: leido('16727057'),
    }
    aplicarNormalizaciones(RUT_SOLICITANTE_2, r)
    expect(r.nit.value).toBe('16727057')
    expect(r.dv.value).toBe('9')
  })

  it('un RUT limpio no se toca', () => {
    const r: Record<string, CampoResultado> = {
      nit: leido('75072970'),
      dv: leido('0'),
      numero_identificacion: leido('75072970'),
    }
    aplicarNormalizaciones(RUT, r)
    expect(r).toEqual({
      nit: leido('75072970'),
      dv: leido('0'),
      numero_identificacion: leido('75072970'),
    })
  })
})

describe('normalizarNitYDv — el DV', () => {
  it('[ROJO EN MAIN] DV leído distinto del calculado: guarda el calculado y baja a "Verificar"', () => {
    // V0309 real: rut_solicitante_2 con 34545752 y dv guardado 2; el real es 3.
    const r: Record<string, CampoResultado> = {
      nit: leido('34545752'),
      dv: leido('2', 0.98),
      numero_identificacion: leido('34545752'),
    }
    const cambios = normalizarNitYDv(RUT_SOLICITANTE_2, r)
    expect(r.nit.value).toBe('34545752')
    expect(r.dv.value).toBe('3')
    expect(r.dv.confidence).toBe(CONFIANZA_REVISAR)
    expect(r.dv.manual).toBe(false)
    expect(cambios.map((c) => c.motivo)).toEqual(['dv_leido_no_coincide'])
  })

  it('DV que la extracción no pudo leer: se completa con confianza plena', () => {
    const r: Record<string, CampoResultado> = {
      nit: leido('43970194'),
      dv: leido(null, 0.3),
      numero_identificacion: leido('43970194'),
    }
    normalizarNitYDv(RUT_SOLICITANTE_2, r)
    expect(r.dv).toEqual({ value: '8', confidence: 1, manual: false })
  })

  it('"Verificar" nunca queda por debajo de 0.70: los formularios lo descartarían como faltante', () => {
    const r: Record<string, CampoResultado> = {
      nit: leido('34545752'),
      dv: leido('2', 0.72),
      numero_identificacion: leido('34545752'),
    }
    normalizarNitYDv(RUT_SOLICITANTE_2, r)
    expect(r.dv.confidence).toBeGreaterThanOrEqual(0.7)
    expect(r.dv.confidence).toBeLessThanOrEqual(CONFIANZA_REVISAR)
  })

  it('bloque sin campo `dv`: no lo inventa', () => {
    const r: Record<string, CampoResultado> = { nit: leido('890903938') }
    normalizarNitYDv([campo('nit')], r)
    expect(r.dv).toBeUndefined()
  })

  it('bloque sin campo `nit`: no hace nada', () => {
    const r: Record<string, CampoResultado> = { nit_proveedor: leido('8600190638') }
    expect(normalizarNitYDv([campo('nit_proveedor')], r)).toEqual([])
    expect(r.nit_proveedor.value).toBe('8600190638')
  })
})

describe('normalizarNitYDv — sin identificación (certificado del banco)', () => {
  it('Bancolombia (890903938, DV 8): NO recorta, lo marca para revisar', () => {
    const r: Record<string, CampoResultado> = { nit: leido('890903938'), dv: leido('8') }
    normalizarNitYDv(CERT_BANCO, r)
    expect(r.nit.value).toBe('890903938')
    expect(r.nit.confidence).toBe(CONFIANZA_REVISAR)
    expect(r.dv.value).toBe('8')
    expect(r.dv.confidence).toBe(0.95)
  })

  it('NIT con el DV pegado y el DV leído que lo confirma: recorta', () => {
    const r: Record<string, CampoResultado> = { nit: leido('522172252'), dv: leido('2') }
    normalizarNitYDv(CERT_BANCO, r)
    expect(r.nit.value).toBe('52217225')
    expect(r.dv.value).toBe('2')
  })

  it('un NIT de empresa limpio con su DV correcto no se toca', () => {
    const r: Record<string, CampoResultado> = { nit: leido('899999068'), dv: leido('1') }
    normalizarNitYDv(CERT_BANCO, r)
    expect(r).toEqual({ nit: leido('899999068'), dv: leido('1') })
  })
})

describe('campos protegidos', () => {
  const edicion = { editado_por_id: 'p1', editado_por_nombre: 'Deisy', editado_en: '2026-09-14T00:00:00Z' }

  it('un NIT corregido a mano no se recorta aunque parezca pegado', () => {
    const r: Record<string, CampoResultado> = {
      nit: { value: '522172252', confidence: 1, manual: true, edicion },
      dv: leido('2'),
      numero_identificacion: leido('52217225'),
    }
    normalizarNitYDv(RUT, r)
    expect(r.nit.value).toBe('522172252')
  })

  it('un DV corregido a mano no se recalcula', () => {
    const r: Record<string, CampoResultado> = {
      nit: leido('16727057'),
      dv: { value: '1', confidence: 1, manual: true },
      numero_identificacion: leido('16727057'),
    }
    aplicarNormalizaciones(RUT, r)
    expect(r.dv.value).toBe('1')
  })

  it('manual con valor null (confianza baja de la IA) NO es protegido', () => {
    expect(campoProtegido({ value: null, confidence: 0.4, manual: true })).toBe(false)
    expect(campoProtegido({ value: '1', confidence: 1, manual: true })).toBe(true)
    expect(campoProtegido({ value: '1', confidence: 0.9, manual: false, edicion })).toBe(true)
  })
})
