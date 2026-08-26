import { describe, it, expect } from 'vitest'
import { campoSeccionalDelBloque, textoSeccionalDeCampos } from './seccional-desde-documento'

/**
 * Las dos configs son las REALES de la línea VE de SOENA (`cita_dian_requerida` y
 * `cita_dian_iva`, medidas el 2026-08-25): las dos apuntan al mismo bloque de RUT.
 */
const CONFIGS_SOENA = [
  { rut_slug: 'rut', seccional_field: 'direccion_seccional' },
  { rut_slug: 'rut', seccional_field: 'direccion_seccional' },
]

describe('campoSeccionalDelBloque', () => {
  it('reconoce el bloque de RUT que la línea declara', () => {
    expect(campoSeccionalDelBloque('rut', CONFIGS_SOENA)).toBe('direccion_seccional')
  })

  it('NO reconoce ningún otro bloque', () => {
    // El RUT del segundo solicitante NO es el del negocio: su seccional es la de otra
    // persona, y sembrarla dejaría el caso apuntando a la seccional equivocada.
    expect(campoSeccionalDelBloque('rut_solicitante_2', CONFIGS_SOENA)).toBeNull()
    expect(campoSeccionalDelBloque('factura_venta_vehiculo', CONFIGS_SOENA)).toBeNull()
    expect(campoSeccionalDelBloque('certificado_upme', CONFIGS_SOENA)).toBeNull()
  })

  it('sigue el slug que la config declara, no el nombre "rut"', () => {
    // Si una línea renombra su bloque, el sembrado la sigue. Hardcodear 'rut' habría
    // dejado de escribir en silencio.
    const cfg = [{ rut_slug: 'rut_del_titular', seccional_field: 'seccional_dian' }]
    expect(campoSeccionalDelBloque('rut_del_titular', cfg)).toBe('seccional_dian')
    expect(campoSeccionalDelBloque('rut', cfg)).toBeNull()
  })

  it('aplica los mismos defaults que el auto-init cuando la config no los declara', () => {
    expect(campoSeccionalDelBloque('rut', [{}])).toBe('direccion_seccional')
    expect(campoSeccionalDelBloque('rut', [{ seccional_field: 'otro' }])).toBe('otro')
  })

  it('basta que UNA de las configs de la línea lo declare', () => {
    expect(campoSeccionalDelBloque('rut', [null, undefined, { rut_slug: 'rut' }]))
      .toBe('direccion_seccional')
  })

  it('sin configs de cita no siembra nada', () => {
    expect(campoSeccionalDelBloque('rut', [])).toBeNull()
    expect(campoSeccionalDelBloque('rut', [null, undefined])).toBeNull()
  })

  it('un bloque sin slug no resuelve', () => {
    expect(campoSeccionalDelBloque(null, CONFIGS_SOENA)).toBeNull()
    expect(campoSeccionalDelBloque('', CONFIGS_SOENA)).toBeNull()
    expect(campoSeccionalDelBloque('   ', CONFIGS_SOENA)).toBeNull()
  })
})

describe('textoSeccionalDeCampos', () => {
  it('saca el texto crudo del campo extraído', () => {
    expect(textoSeccionalDeCampos({ direccion_seccional: { value: 'Impuestos de Cali' } }, 'direccion_seccional'))
      .toBe('Impuestos de Cali')
  })

  it('devuelve vacío cuando el campo no está o vino nulo', () => {
    expect(textoSeccionalDeCampos({}, 'direccion_seccional')).toBe('')
    expect(textoSeccionalDeCampos({ direccion_seccional: { value: null } }, 'direccion_seccional')).toBe('')
    expect(textoSeccionalDeCampos({ direccion_seccional: {} }, 'direccion_seccional')).toBe('')
    expect(textoSeccionalDeCampos(null, 'direccion_seccional')).toBe('')
  })

  it('un campo en blanco no cuenta como valor', () => {
    // Si contara, `fijarSeccionalNegocio` recibiría "   " y el sembrado haría una
    // consulta por cada documento procesado sin nada que escribir.
    expect(textoSeccionalDeCampos({ direccion_seccional: { value: '   ' } }, 'direccion_seccional')).toBe('')
  })
})
