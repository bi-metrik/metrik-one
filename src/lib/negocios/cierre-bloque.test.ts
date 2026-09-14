/**
 * Criterios de cierre por tipo de bloque (`cierre-bloque.ts`).
 *
 * Son la fuente única que comparten `marcarBloqueCompleto`, `reevaluarBloqueCronograma` y
 * las pantallas que piden el cierre. Lo que se fija aquí es la clasificación (qué tipo
 * se cierra cómo) y la regla de cada criterio; el cableado contra la server action está
 * en `negocios/marcar-bloque-completo-por-tipo.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import {
  modoCierre,
  exigeTodasLasFechas,
  faltaEnCronograma,
  checklistConSoporte,
  faltaEnChecklist,
  documentosSubidos,
  faltaEnDocumentos,
  rolesDelEquipo,
  faltaEnEquipo,
} from './cierre-bloque'
import { BANDERAS_CAPTURA_COBRO } from './superficie-cobro'

describe('modoCierre', () => {
  it.each(['cronograma', 'cobros', 'checklist', 'checklist_soporte', 'documentos', 'equipo'])(
    '%s se cierra por criterio',
    tipo => expect(modoCierre(tipo, {})).toBe('criterio'),
  )

  it.each(['documento', 'formulario', 'propuesta_economica', 'cotizacion', 'aprobacion', 'resumen_financiero'])(
    '%s se cierra con su propia acción',
    tipo => expect(modoCierre(tipo, {})).toBe('accion_propia'),
  )

  it('datos a secas, el multi-pago y el sello de completado siguen siendo manuales', () => {
    expect(modoCierre('datos', {})).toBe('manual')
    expect(modoCierre('datos', { es_multi_pago: true })).toBe('manual')
    expect(modoCierre('datos', { completion_stamp: true })).toBe('manual')
  })

  it('las superficies de pago con acción propia no se cierran a mano', () => {
    expect(modoCierre('datos', { es_pagos_epayco: true })).toBe('accion_propia')
    expect(modoCierre('datos', { es_pago_externo: true })).toBe('accion_propia')
    expect(modoCierre('datos', { permite_pago_externo: true })).toBe('accion_propia')
  })

  it('el sello de completado gana sobre una bandera de pago, igual que en el dispatch', () => {
    expect(modoCierre('datos', { completion_stamp: true, es_pagos_epayco: true })).toBe('manual')
  })

  it('toda bandera de captura de cobro está clasificada: la del multi-pago es la única manual', () => {
    const manuales = BANDERAS_CAPTURA_COBRO.filter(b => modoCierre('datos', { [b]: true }) === 'manual')
    expect(manuales).toEqual(['es_multi_pago'])
  })

  it('un tipo desconocido o ausente no cambia su comportamiento: manual', () => {
    expect(modoCierre('tipo_nuevo', {})).toBe('manual')
    expect(modoCierre(undefined, null)).toBe('manual')
  })
})

describe('cronograma', () => {
  it('sin actividades no se cierra, exija o no fechas', () => {
    expect(faltaEnCronograma([], false)).toBe('El cronograma no tiene actividades')
    expect(faltaEnCronograma([], true)).toBe('El cronograma no tiene actividades')
  })

  it('sin la regla de fechas basta una actividad', () => {
    expect(faltaEnCronograma([{ fecha_inicio: null, fecha_fin: null }], false)).toBeNull()
  })

  it('con la regla, cuenta las actividades a las que les falta alguna fecha', () => {
    expect(faltaEnCronograma([{ fecha_inicio: '2026-09-20', fecha_fin: null }], true))
      .toBe('Falta la fecha planeada de 1 actividad')
    expect(faltaEnCronograma([
      { fecha_inicio: null, fecha_fin: '2026-09-25' },
      { fecha_inicio: '2026-09-20', fecha_fin: null },
      { fecha_inicio: '2026-09-20', fecha_fin: '2026-09-25' },
    ], true)).toBe('Faltan fechas planeadas en 2 actividades')
    expect(faltaEnCronograma([{ fecha_inicio: '2026-09-20', fecha_fin: '2026-09-25' }], true)).toBeNull()
  })

  it('la regla se lee como la pinta la tarjeta: verdadera si el valor lo es', () => {
    expect(exigeTodasLasFechas({ require_all_dates: true })).toBe(true)
    expect(exigeTodasLasFechas({ require_all_dates: 'si' })).toBe(true)
    expect(exigeTodasLasFechas({})).toBe(false)
    expect(exigeTodasLasFechas(null)).toBe(false)
  })
})

describe('checklist', () => {
  it('sin ítems no se cierra', () => {
    expect(faltaEnChecklist([], false)).toBe('El checklist no tiene ítems')
  })

  it('sin soporte exige todos marcados', () => {
    expect(faltaEnChecklist([{ completado: true }, { completado: false }], false)).toBe('Falta 1 ítem por marcar')
    expect(faltaEnChecklist([{ completado: false }, { completado: null }], false)).toBe('Faltan 2 ítems por marcar')
    expect(faltaEnChecklist([{ completado: true }], false)).toBeNull()
  })

  it('con soporte, un ítem marcado sin enlace (o con uno en blanco) no cuenta', () => {
    expect(faltaEnChecklist([
      { completado: true, link_url: 'https://drive.google.com/x' },
      { completado: true, link_url: '   ' },
    ], true)).toBe('Falta 1 ítem con su soporte')
    expect(faltaEnChecklist([{ completado: true, link_url: 'https://drive.google.com/x' }], true)).toBeNull()
  })

  it('pide soporte el tipo con soporte o la bandera withSupport en true', () => {
    expect(checklistConSoporte('checklist_soporte', {})).toBe(true)
    expect(checklistConSoporte('checklist', { withSupport: true })).toBe(true)
    expect(checklistConSoporte('checklist', { withSupport: 'true' })).toBe(false)
    expect(checklistConSoporte('checklist', {})).toBe(false)
  })
})

describe('documentos', () => {
  const documentos = [
    { slug: 'rut', label: 'RUT', required: true },
    { slug: 'camara', label: 'Cámara de comercio', required: true },
    { slug: 'extra', label: 'Anexo', required: false },
  ]

  it('cuenta como subido solo un enlace que no está en blanco', () => {
    expect([...documentosSubidos({ rut: 'https://x', camara: '', extra: null })]).toEqual(['rut'])
    expect(documentosSubidos(undefined).size).toBe(0)
  })

  it('nombra los obligatorios que faltan e ignora los opcionales', () => {
    expect(faltaEnDocumentos(documentos, new Set(['rut'])))
      .toBe('Faltan documentos obligatorios: Cámara de comercio')
    expect(faltaEnDocumentos(documentos, new Set(['rut', 'camara']))).toBeNull()
  })

  it('sin documentos obligatorios no hay nada que falte', () => {
    expect(faltaEnDocumentos([{ slug: 'extra', required: false }], new Set())).toBeNull()
  })
})

describe('equipo', () => {
  it('sin rol en la config basta cualquiera de los tres responsables', () => {
    expect(rolesDelEquipo({})).toHaveLength(3)
    expect(faltaEnEquipo({}, { ejecucion_id: 'p-1' })).toBeNull()
    expect(faltaEnEquipo({}, { comercial_id: null })).not.toBeNull()
  })

  it('con un rol en la config solo cuenta ese responsable', () => {
    expect(rolesDelEquipo({ rol: 'financiero' }).map(r => r.key)).toEqual(['financiero_id'])
    expect(faltaEnEquipo({ rol: 'financiero' }, { comercial_id: 'p-1' })).not.toBeNull()
    expect(faltaEnEquipo({ rol: 'financiero' }, { financiero_id: 'p-1' })).toBeNull()
  })
})
