import { describe, it, expect } from 'vitest'
import { campoRequeridoCumplido, camposRequeridosFaltantes } from './campo-completo'

// El caso que motivó el cambio: los siete bloques de confirmación de SOENA colgaban de un
// toggle o un checkbox `required` y ninguno retenía nada, aunque el bloque fuera gate.
describe('campos de confirmación (toggle / checkbox)', () => {
  it('NO se da por cumplido cuando está en falso', () => {
    expect(campoRequeridoCumplido('toggle', false)).toBe(false)
    expect(campoRequeridoCumplido('checkbox', false)).toBe(false)
  })

  it('NO se da por cumplido cuando nadie lo tocó', () => {
    expect(campoRequeridoCumplido('toggle', undefined)).toBe(false)
    expect(campoRequeridoCumplido('checkbox', null)).toBe(false)
  })

  it('se cumple al marcarlo', () => {
    expect(campoRequeridoCumplido('toggle', true)).toBe(true)
    expect(campoRequeridoCumplido('checkbox', true)).toBe(true)
  })

  // Los bloques configurados con opciones true/false guardan la cadena, no el booleano.
  it('acepta la cadena "true"', () => {
    expect(campoRequeridoCumplido('toggle', 'true')).toBe(true)
  })

  it('la cadena "false" no cuenta como confirmación', () => {
    expect(campoRequeridoCumplido('toggle', 'false')).toBe(false)
  })

  // V0129: el campo numérico traía la tarifa ($701.812) y el toggle estaba en falso.
  // El bloque se daba por completo y el negocio salió a operaciones sin recaudarla.
  it('reproduce V0129: valor cargado pero sin confirmar', () => {
    expect(campoRequeridoCumplido('numero', 701812)).toBe(true)
    expect(campoRequeridoCumplido('toggle', false)).toBe(false)
  })
})

describe('campos que capturan un valor', () => {
  it('exige contenido', () => {
    expect(campoRequeridoCumplido('texto', '')).toBe(false)
    expect(campoRequeridoCumplido('texto', null)).toBe(false)
    expect(campoRequeridoCumplido('texto', undefined)).toBe(false)
    expect(campoRequeridoCumplido('fecha', '')).toBe(false)
    expect(campoRequeridoCumplido('select', '')).toBe(false)
  })

  it('se cumple con cualquier valor presente', () => {
    expect(campoRequeridoCumplido('texto', 'algo')).toBe(true)
    expect(campoRequeridoCumplido('fecha', '2026-07-31')).toBe(true)
    expect(campoRequeridoCumplido('select', 'radicado')).toBe(true)
    expect(campoRequeridoCumplido('radio', 'natural')).toBe(true)
  })

  // El cero es una respuesta válida: un valor devuelto de $0 no es "sin responder".
  it('el cero cuenta como respondido', () => {
    expect(campoRequeridoCumplido('numero', 0)).toBe(true)
  })
})

describe('campos que no capturan nada', () => {
  // Exigirlos dejaría el bloque bloqueado para siempre: no hay dónde responder.
  it('se dan por cumplidos aunque estén vacíos', () => {
    expect(campoRequeridoCumplido('plantilla', undefined)).toBe(true)
    expect(campoRequeridoCumplido('documentos_preview', undefined)).toBe(true)
    expect(campoRequeridoCumplido('doc_link', null)).toBe(true)
  })
})

describe('camposRequeridosFaltantes (barrera del servidor)', () => {
  const FIELDS = [
    { slug: 'tarifa_ref_display', tipo: 'plantilla', label: 'Tarifa calculada' },
    { slug: 'tarifa_upme_confirmada', tipo: 'numero', label: 'Tarifa a recaudar', required: true },
    { slug: 'tarifa_confirmada', tipo: 'toggle', label: 'Confirmo la tarifa UPME', required: true },
  ] as const

  // El caso real: V0122 quedó `completo` con el toggle en false y avanzó de etapa
  // 15 segundos después, con el fix del cliente ya desplegado hacía 16 horas.
  it('el toggle de confirmación apagado deja el bloque incompleto', () => {
    const faltan = camposRequeridosFaltantes([...FIELDS], {
      tarifa_upme_confirmada: 701812,
      tarifa_confirmada: false,
    })
    expect(faltan.map((f) => f.slug)).toEqual(['tarifa_confirmada'])
  })

  it('con el toggle marcado no falta nada', () => {
    expect(
      camposRequeridosFaltantes([...FIELDS], {
        tarifa_upme_confirmada: 701812,
        tarifa_confirmada: true,
      }),
    ).toEqual([])
  })

  // Un campo que ni siquiera está en el data cuenta como no respondido: si no,
  // bastaría no mandar la clave para saltarse la exigencia.
  it('un campo ausente cuenta como faltante', () => {
    const faltan = camposRequeridosFaltantes([...FIELDS], {})
    expect(faltan.map((f) => f.slug)).toEqual(['tarifa_upme_confirmada', 'tarifa_confirmada'])
  })

  it('los campos sin captura no bloquean aunque estén vacíos', () => {
    const faltan = camposRequeridosFaltantes(
      [{ slug: 'nota', tipo: 'plantilla', required: true }],
      {},
    )
    expect(faltan).toEqual([])
  })

  // Exigir un campo oculto dejaría el bloque bloqueado sin forma de responderlo.
  it('un campo oculto por showIf no se exige', () => {
    const fields = [
      { slug: 'requiere_cita', tipo: 'toggle', required: true },
      { slug: 'fecha_cita', tipo: 'fecha', required: true, showIf: { field: 'requiere_cita', equals: true } },
    ]
    expect(camposRequeridosFaltantes(fields, { requiere_cita: true })).toHaveLength(1)
    expect(camposRequeridosFaltantes(fields, { requiere_cita: false })).toHaveLength(1)
    expect(
      camposRequeridosFaltantes(fields, { requiere_cita: false, fecha_cita: '' }).map((f) => f.slug),
    ).toEqual(['requiere_cita'])
  })

  it('un campo no obligatorio nunca falta', () => {
    expect(camposRequeridosFaltantes([{ slug: 'notas', tipo: 'texto' }], {})).toEqual([])
  })
})
