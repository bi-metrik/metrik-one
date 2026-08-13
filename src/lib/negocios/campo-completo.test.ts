import { describe, it, expect } from 'vitest'
import { campoRequeridoCumplido, camposRequeridosFaltantes } from './campo-completo'

// El caso que motivó el cambio: los siete bloques de confirmación de SOENA colgaban de un
// toggle o un checkbox `required` y ninguno retenía nada, aunque el bloque fuera gate.
describe('campos de confirmación (toggle / checkbox)', () => {
  it('NO se da por cumplido cuando está en falso', () => {
    expect(campoRequeridoCumplido({ tipo: 'toggle' }, false)).toBe(false)
    expect(campoRequeridoCumplido({ tipo: 'checkbox' }, false)).toBe(false)
  })

  it('NO se da por cumplido cuando nadie lo tocó', () => {
    expect(campoRequeridoCumplido({ tipo: 'toggle' }, undefined)).toBe(false)
    expect(campoRequeridoCumplido({ tipo: 'checkbox' }, null)).toBe(false)
  })

  it('se cumple al marcarlo', () => {
    expect(campoRequeridoCumplido({ tipo: 'toggle' }, true)).toBe(true)
    expect(campoRequeridoCumplido({ tipo: 'checkbox' }, true)).toBe(true)
  })

  // Los bloques configurados con opciones true/false guardan la cadena, no el booleano.
  it('acepta la cadena "true"', () => {
    expect(campoRequeridoCumplido({ tipo: 'toggle' }, 'true')).toBe(true)
  })

  it('la cadena "false" no cuenta como confirmación', () => {
    expect(campoRequeridoCumplido({ tipo: 'toggle' }, 'false')).toBe(false)
  })

  // V0129: el campo numérico traía la tarifa ($701.812) y el toggle estaba en falso.
  // El bloque se daba por completo y el negocio salió a operaciones sin recaudarla.
  it('reproduce V0129: valor cargado pero sin confirmar', () => {
    expect(campoRequeridoCumplido({ tipo: 'numero' }, 701812)).toBe(true)
    expect(campoRequeridoCumplido({ tipo: 'toggle' }, false)).toBe(false)
  })
})

describe('campos que capturan un valor', () => {
  it('exige contenido', () => {
    expect(campoRequeridoCumplido({ tipo: 'texto' }, '')).toBe(false)
    expect(campoRequeridoCumplido({ tipo: 'texto' }, null)).toBe(false)
    expect(campoRequeridoCumplido({ tipo: 'texto' }, undefined)).toBe(false)
    expect(campoRequeridoCumplido({ tipo: 'fecha' }, '')).toBe(false)
    expect(campoRequeridoCumplido({ tipo: 'select' }, '')).toBe(false)
  })

  it('se cumple con cualquier valor presente', () => {
    expect(campoRequeridoCumplido({ tipo: 'texto' }, 'algo')).toBe(true)
    expect(campoRequeridoCumplido({ tipo: 'fecha' }, '2026-07-31')).toBe(true)
    expect(campoRequeridoCumplido({ tipo: 'select' }, 'radicado')).toBe(true)
    expect(campoRequeridoCumplido({ tipo: 'radio' }, 'natural')).toBe(true)
  })

  // El cero es una respuesta válida: un valor devuelto de $0 no es "sin responder".
  it('el cero cuenta como respondido', () => {
    expect(campoRequeridoCumplido({ tipo: 'numero' }, 0)).toBe(true)
  })
})

describe('campos que no capturan nada', () => {
  // Exigirlos dejaría el bloque bloqueado para siempre: no hay dónde responder.
  it('se dan por cumplidos aunque estén vacíos', () => {
    expect(campoRequeridoCumplido({ tipo: 'plantilla' }, undefined)).toBe(true)
    expect(campoRequeridoCumplido({ tipo: 'documentos_preview' }, undefined)).toBe(true)
    expect(campoRequeridoCumplido({ tipo: 'doc_link' }, null)).toBe(true)
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

/**
 * `no_cero` — el cero en un campo de plata es un dato BORRADO, no una respuesta.
 *
 * Los casos vienen medidos de produccion (SOENA, 2026-08-13): seis negocios con
 * la tarifa UPME confirmada en cero, los seis con su toggle de confirmacion
 * marcado, y con la referencia correcta ya calculada por el sistema.
 */
describe('no_cero', () => {
  const tarifa = { slug: 'tarifa_upme_confirmada', tipo: 'numero', required: true, no_cero: true }

  it('V0019 y compania: cero confirmado NO satisface el campo', () => {
    expect(campoRequeridoCumplido(tarifa, 0)).toBe(false)
    expect(camposRequeridosFaltantes([tarifa], { tarifa_upme_confirmada: 0 })).toHaveLength(1)
  })

  it('el cero no se cuela escrito de otra forma', () => {
    // El input guarda '0', '0.00' o '$ 0' segun por donde entre. Las tres son el
    // mismo cero, y comparar el texto crudo dejaria pasar dos de las tres.
    for (const v of ['0', '0.00', '$ 0', '$0', 0.0]) {
      expect(campoRequeridoCumplido(tarifa, v)).toBe(false)
    }
  })

  it('la tarifa real pasa', () => {
    expect(campoRequeridoCumplido(tarifa, 701812)).toBe(true)
    expect(campoRequeridoCumplido(tarifa, '701812')).toBe(true)
    expect(campoRequeridoCumplido(tarifa, '$ 1.997.484')).toBe(true)
  })

  it('sin la marca, el cero sigue satisfaciendo: ningun otro campo cambia', () => {
    const otro = { slug: 'descuento_pct', tipo: 'numero', required: true }
    expect(campoRequeridoCumplido(otro, 0)).toBe(true)
    expect(camposRequeridosFaltantes([otro], { descuento_pct: 0 })).toEqual([])
  })

  it('vacio sigue faltando, con marca o sin ella', () => {
    expect(campoRequeridoCumplido(tarifa, '')).toBe(false)
    expect(campoRequeridoCumplido(tarifa, null)).toBe(false)
    expect(campoRequeridoCumplido(tarifa, undefined)).toBe(false)
  })

  it('un valor no numerico no lo da por cero', () => {
    // Si alguien escribe texto, el campo esta lleno con basura: eso es otro
    // problema (validacion de formato), no un cero. Darlo por cero aqui
    // frenaria el caso con un mensaje que no explica nada.
    expect(campoRequeridoCumplido(tarifa, 'pendiente')).toBe(true)
  })

  it('la marca solo aplica a campos que capturan valor', () => {
    // Un toggle con `no_cero` seguiria decidiendose por su propia regla.
    expect(campoRequeridoCumplido({ tipo: 'toggle', no_cero: true }, true)).toBe(true)
    expect(campoRequeridoCumplido({ tipo: 'toggle', no_cero: true }, false)).toBe(false)
  })
})
