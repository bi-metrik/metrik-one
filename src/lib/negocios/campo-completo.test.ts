import { describe, it, expect } from 'vitest'
import { campoRequeridoCumplido } from './campo-completo'

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
