import { describe, it, expect } from 'vitest'
import {
  esCampoDeIdentidad,
  etiquetaDeCampo,
  valorDeCampo,
  resumenDelFormulario,
  detectarTipoPersona,
  type CampoFormulario,
} from './campos-formulario'

/**
 * Los dos formularios son reales. El VIEJO es el que la ficha esperaba con su
 * lista quemada (135 interacciones de SOENA hasta julio de 2026); el NUEVO es el
 * que Meta empezó a mandar a finales de julio (620 interacciones entre agosto y
 * septiembre), y con el que la ficha se quedó en blanco.
 *
 * Los nombres de campo están copiados de la migración
 * `proyectos/soena/ve/migrations/20260818_nombres_alternativos_campos_meta.sql`,
 * que es donde se dejaron escritos los dos juegos al arreglar el bloque del
 * negocio. Aquí no se inventa ninguno.
 */
const FORM_VIEJO: CampoFormulario[] = [
  { name: 'full_name', values: ['JUAN PEREZ'] },
  { name: 'email', values: ['juan@example.com'] },
  { name: 'phone_number', values: ['+573001234567'] },
  { name: '¿qué_tipo_de_vehículo_adquiriste?', values: ['electrico'] },
  { name: 'marca_-línea_-modelo__(_byd_-yuan_-2026)', values: ['BYD Yuan 2026'] },
  { name: 'precio_de_el(los)_vehículo(s)._pesos_colombianos', values: ['$ 132.734.513'] },
  { name: 'persona_natural_o_jurídica', values: ['natural'] },
]

const FORM_NUEVO: CampoFormulario[] = [
  { name: 'nombre_completo', values: ['ANA GOMEZ'] },
  { name: 'correo_electrónico', values: ['ana@example.com'] },
  { name: 'número_de_teléfono', values: ['+573109876543'] },
  { name: '¿en_qué_ciudad_reside?', values: ['Medellín'] },
  { name: '¿qué_tipo_de_vehículo_tiene?', values: ['hibrido_enchufable'] },
  { name: '¿el_vehículo_es_nuevo_o_usado?', values: ['nuevo'] },
  { name: 'marca,_línea_y_modelo_de_su_vehículo', values: ['Volvo XC40 2026'] },
  { name: 'valor_de_compra_del_vehículo', values: ['$100 - $200 millones'] },
  { name: '¿la_compra_se_realizó_como_persona_natural_o_jurídica?', values: ['persona_natural'] },
]

describe('esCampoDeIdentidad', () => {
  it('reconoce la identidad de los DOS formularios', () => {
    for (const n of ['full_name', 'email', 'phone_number', 'nombre_completo', 'correo_electrónico', 'número_de_teléfono']) {
      expect(esCampoDeIdentidad(n), n).toBe(true)
    }
  })

  it('NO se lleva por delante ninguna pregunta real de los dos formularios', () => {
    const preguntas = [...FORM_VIEJO, ...FORM_NUEVO]
      .map((fd) => fd.name!)
      .filter((n) => !['full_name', 'email', 'phone_number', 'nombre_completo', 'correo_electrónico', 'número_de_teléfono'].includes(n))
    for (const n of preguntas) expect(esCampoDeIdentidad(n), n).toBe(false)
  })

  it('no confunde "automóvil" con un teléfono móvil', () => {
    // Por esto `movil` no está entre los fragmentos, aunque el webhook sí lo use:
    // allá un acierto de más rellena un hueco, aquí borra una respuesta.
    expect(esCampoDeIdentidad('¿qué_tipo_de_automóvil_tiene?')).toBe(false)
  })

  it('tolera un campo sin nombre', () => {
    expect(esCampoDeIdentidad(undefined)).toBe(false)
  })
})

describe('etiquetaDeCampo', () => {
  it('deriva la etiqueta del propio nombre del campo', () => {
    expect(etiquetaDeCampo('¿en_qué_ciudad_reside?')).toBe('En qué ciudad reside')
    expect(etiquetaDeCampo('valor_de_compra_del_vehículo')).toBe('Valor de compra del vehículo')
    expect(etiquetaDeCampo('marca,_línea_y_modelo_de_su_vehículo')).toBe('Marca, línea y modelo de su vehículo')
  })

  it('colapsa el relleno de guiones bajos del nombre viejo', () => {
    expect(etiquetaDeCampo('marca_-línea_-modelo__(_byd_-yuan_-2026)')).toBe('Marca -línea -modelo ( byd -yuan -2026)')
  })
})

describe('valorDeCampo', () => {
  it('formatea como COP el precio que SÍ es un número', () => {
    expect(valorDeCampo('$ 132.734.513')).toBe('$ 132.734.513')
    expect(valorDeCampo('132734513')).toBe('$ 132.734.513')
  })

  it('⚠️ un rango de texto se pinta TAL CUAL, nunca como cifra', () => {
    // La regla vieja daba "$100.200": un precio falso donde el comercial cree
    // que hay uno. Es la razón de ser de esta función.
    expect(valorDeCampo('$100 - $200 millones')).toBe('$100 - $200 millones')
    expect(valorDeCampo('más de $200 millones')).toBe('Más de $200 millones')
  })

  it('limpia el relleno de guiones bajos de los enums', () => {
    expect(valorDeCampo('hibrido_enchufable')).toBe('Hibrido enchufable')
    expect(valorDeCampo('persona_natural_')).toBe('Persona natural')
  })

  it('no formatea un valor sin dígitos ni un cero', () => {
    expect(valorDeCampo('$')).toBe('$')
    expect(valorDeCampo('0')).toBe('0')
  })
})

describe('resumenDelFormulario', () => {
  it('el formulario NUEVO pinta sus seis preguntas, sin repetir la identidad', () => {
    const r = resumenDelFormulario(FORM_NUEVO)
    expect(r.map((x) => x.label)).toEqual([
      'En qué ciudad reside',
      'Qué tipo de vehículo tiene',
      'El vehículo es nuevo o usado',
      'Marca, línea y modelo de su vehículo',
      'Valor de compra del vehículo',
      'La compra se realizó como persona natural o jurídica',
    ])
    expect(r.find((x) => x.label === 'Valor de compra del vehículo')?.value).toBe('$100 - $200 millones')
  })

  it('el formulario VIEJO sigue pintando lo suyo (los 135 de julio no se rompen)', () => {
    const r = resumenDelFormulario(FORM_VIEJO)
    expect(r).toHaveLength(4)
    expect(r.map((x) => x.value)).toContain('$ 132.734.513')
    expect(r.map((x) => x.value)).toContain('Natural')
  })

  it('ni el nombre, ni el correo, ni el teléfono se repiten dentro del bloque', () => {
    const valores = resumenDelFormulario(FORM_NUEVO).map((x) => x.value)
    expect(valores).not.toContain('ANA GOMEZ')
    expect(valores.some((v) => v.includes('@'))).toBe(false)
    expect(valores.some((v) => v.includes('3109876543'))).toBe(false)
  })

  it('una interacción sin field_data no pinta nada (manual, whatsapp)', () => {
    expect(resumenDelFormulario([])).toEqual([])
  })

  it('descarta el campo vacío, el que llega sin values y el que no tiene nombre', () => {
    const r = resumenDelFormulario([
      { name: '¿en_qué_ciudad_reside?', values: [''] },
      { name: '¿el_vehículo_es_nuevo_o_usado?' },
      { name: '  ', values: ['algo'] },
      { name: '¿qué_tipo_de_vehículo_tiene?', values: ['electrico'] },
    ])
    expect(r.map((x) => x.label)).toEqual(['Qué tipo de vehículo tiene'])
  })

  it('un formulario desconocido se pinta igual: no hay lista que acertar', () => {
    // Es la prueba de que el próximo cambio de Meta no vuelve a dejar la ficha
    // en blanco. Ningún nombre de aquí existe en ninguna lista del código.
    const r = resumenDelFormulario([
      { name: 'nombre', values: ['PEDRO'] },
      { name: '¿cuánto_piensa_invertir?', values: ['20 millones'] },
      { name: 'campo_1', values: ['sí'] },
    ])
    expect(r.map((x) => `${x.label}: ${x.value}`)).toEqual([
      'Cuánto piensa invertir: 20 millones',
      'Campo 1: Sí',
    ])
  })
})

describe('detectarTipoPersona', () => {
  it('lee "persona_natural" del formulario NUEVO', () => {
    // El valor que llega NO es 'natural': `'persona_natural'.startsWith('natural')`
    // es falso, y por eso la sugerencia llevaba mes y medio sin aparecer.
    expect(detectarTipoPersona(FORM_NUEVO)).toBe('natural')
  })

  it('sigue leyendo el formulario VIEJO', () => {
    expect(detectarTipoPersona(FORM_VIEJO)).toBe('natural')
  })

  it('reconoce jurídica en las formas en que puede llegar escrita', () => {
    // El valor exacto del caso jurídico está PENDIENTE DE MEDIR en producción
    // (ver el cuerpo del PR): la condición se escribió por subcadena `jurid`
    // justo para no depender de cuál de estas formas sea.
    for (const v of ['persona_jurídica', 'persona_juridica', 'jurídica', 'Jurídica', 'JURIDICA', 'juridica_']) {
      expect(
        detectarTipoPersona([{ name: '¿la_compra_se_realizó_como_persona_natural_o_jurídica?', values: [v] }]),
        v,
      ).toBe('juridica')
    }
  })

  it('encuentra el campo aunque la pregunta solo mencione una de las dos', () => {
    // Hueco que destapó una mutación: con los dos formularios de SOENA basta
    // buscar por `natural`, porque los dos nombran las dos figuras. Un formulario
    // que pregunte solo por una dejaría el campo sin encontrar.
    expect(detectarTipoPersona([{ name: '¿es_persona_jurídica?', values: ['jurídica'] }])).toBe('juridica')
    expect(detectarTipoPersona([{ name: '¿compra_como_natural?', values: ['sí, natural'] }])).toBe('natural')
  })

  it('un valor que menciona las dos no sugiere ninguna', () => {
    expect(
      detectarTipoPersona([
        { name: '¿la_compra_se_realizó_como_persona_natural_o_jurídica?', values: ['persona natural o jurídica'] },
      ]),
    ).toBeNull()
  })

  it('sin campo de tipo de persona no sugiere nada', () => {
    expect(detectarTipoPersona([{ name: '¿en_qué_ciudad_reside?', values: ['Cali'] }])).toBeNull()
    expect(detectarTipoPersona([])).toBeNull()
  })

  it('un campo de tipo de persona vacío no sugiere nada', () => {
    expect(
      detectarTipoPersona([{ name: '¿la_compra_se_realizó_como_persona_natural_o_jurídica?', values: [''] }]),
    ).toBeNull()
  })
})
