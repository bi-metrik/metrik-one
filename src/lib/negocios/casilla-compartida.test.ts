import { describe, it, expect } from 'vitest'
import { origenCompartido, origenUnico, documentoCompartidoQuedaResuelto } from './casilla-compartida'

/**
 * Las dos decisiones puras del módulo: si la casilla es compartida y hacia dónde, y si el
 * origen que devolvió la consulta es inequívoco. Todo lo demás toca la base.
 */

describe('origenCompartido', () => {
  it('exige las DOS mitades: el flag y el slug', () => {
    expect(origenCompartido({ compartido_con_origen: true, source_bloque_slug: 'concepto_upme' }))
      .toBe('concepto_upme')
    // Flag sin slug: no dice a dónde escribir, y asumir un destino es el error a evitar.
    expect(origenCompartido({ compartido_con_origen: true })).toBeNull()
    // Slug sin flag es una copia heredada de solo lectura, no una casilla compartida.
    expect(origenCompartido({ source_bloque_slug: 'concepto_upme' })).toBeNull()
  })

  it('el flag se compara ESTRICTO: una cadena no vale', () => {
    // Un `"true"` que entró por una migración a mano no puede redirigir la escritura.
    expect(origenCompartido({ compartido_con_origen: 'true', source_bloque_slug: 'x' })).toBeNull()
  })

  it('un slug vacío no es un destino', () => {
    expect(origenCompartido({ compartido_con_origen: true, source_bloque_slug: '' })).toBeNull()
  })

  it('sin config no hay redirección', () => {
    expect(origenCompartido(null)).toBeNull()
    expect(origenCompartido(undefined)).toBeNull()
    expect(origenCompartido({})).toBeNull()
  })
})

describe('origenUnico', () => {
  it('devuelve el candidato cuando hay exactamente uno', () => {
    expect(origenUnico([{ id: 'a' }])).toEqual({ id: 'a' })
  })

  it('con más de un candidato NO elige: la configuración es ambigua', () => {
    // Escribir un documento en la casilla equivocada es peor que dejarlo donde el usuario
    // está, porque nadie se entera.
    expect(origenUnico([{ id: 'a' }, { id: 'b' }])).toBeNull()
  })

  it('sin candidatos devuelve null para que quien llama decida si crear', () => {
    expect(origenUnico([])).toBeNull()
    expect(origenUnico(null)).toBeNull()
    expect(origenUnico(undefined)).toBeNull()
  })
})

describe('documentoCompartidoQuedaResuelto', () => {
  const espejo = { compartido_con_origen: true, source_bloque_slug: 'concepto_upme' }

  it('el gate del espejo se cierra cuando el ORIGEN ya tiene el archivo', () => {
    // La data que llega aquí es la del origen: el render ya la sustituyó.
    expect(documentoCompartidoQuedaResuelto(espejo, true, { drive_url: 'https://drive/x' })).toBe(true)
  })

  it('sin archivo en el origen el gate RETIENE, que es lo que debe hacer', () => {
    expect(documentoCompartidoQuedaResuelto(espejo, true, {})).toBe(false)
    expect(documentoCompartidoQuedaResuelto(espejo, true, null)).toBe(false)
    // Una cadena vacía no es un archivo.
    expect(documentoCompartidoQuedaResuelto(espejo, true, { drive_url: '' })).toBe(false)
  })

  it('un bloque que NO es documento no lo cierra esto', () => {
    // Los espejos de `datos` los cierra `soloLecturaPorDatoLleno`; adelantarse aquí
    // cerraría gates que su propia regla dejó pendientes a proposito.
    expect(documentoCompartidoQuedaResuelto(espejo, false, { drive_url: 'https://drive/x' })).toBe(false)
  })

  it('un documento que no es espejo lo cierra quien lo carga, no esto', () => {
    expect(documentoCompartidoQuedaResuelto({}, true, { drive_url: 'https://drive/x' })).toBe(false)
    // Copia heredada de solo lectura (source sin el flag): tampoco es asunto de aquí.
    expect(documentoCompartidoQuedaResuelto({ source_bloque_slug: 'concepto_upme' }, true, { drive_url: 'u' }))
      .toBe(false)
    // Flag sin slug: no hay origen declarado, así que no hay nada que dar por resuelto.
    expect(documentoCompartidoQuedaResuelto({ compartido_con_origen: true }, true, { drive_url: 'u' })).toBe(false)
  })

  it('un `drive_url` que no es cadena no cuenta como archivo', () => {
    expect(documentoCompartidoQuedaResuelto(espejo, true, { drive_url: 1 })).toBe(false)
    expect(documentoCompartidoQuedaResuelto(espejo, true, { drive_url: true })).toBe(false)
  })
})
