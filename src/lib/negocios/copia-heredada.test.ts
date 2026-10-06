import { describe, it, expect } from 'vitest'
import {
  copiaDeSoloLectura,
  esCopiaHeredada,
  mensajeCopiaDeSoloLectura,
  origenDeCopiaEscribible,
} from './copia-heredada'

/**
 * El criterio único que comparten la pantalla (`getBloqueMode`, `BloqueDocumento`) y el
 * servidor (`documento-actions.destinoDeEscritura`). Configs tomadas de SOENA (2026-10-06).
 */

const COPIA_FACTURA = {
  readonly: true,
  editable_siempre: true,
  source_etapa_orden: 7,
  source_bloque_slug: 'factura_emitida',
}

describe('copia heredada escribible', () => {
  it('la copia de «Factura emitida» escribe en su origen', () => {
    expect(esCopiaHeredada(COPIA_FACTURA)).toBe(true)
    expect(origenDeCopiaEscribible(COPIA_FACTURA)).toBe('factura_emitida')
    expect(copiaDeSoloLectura(COPIA_FACTURA)).toBe(false)
  })

  it('sin `editable_siempre` estricto la copia es de solo lectura', () => {
    expect(copiaDeSoloLectura({ ...COPIA_FACTURA, editable_siempre: undefined })).toBe(true)
    expect(copiaDeSoloLectura({ ...COPIA_FACTURA, editable_siempre: false })).toBe(true)
    // Un "true" que entró por una migración a mano no abre la escritura.
    expect(copiaDeSoloLectura({ ...COPIA_FACTURA, editable_siempre: 'true' })).toBe(true)
  })

  it('sin slug del origen no hay a dónde escribir: solo lectura', () => {
    expect(copiaDeSoloLectura({ ...COPIA_FACTURA, source_bloque_slug: undefined })).toBe(true)
    expect(copiaDeSoloLectura({ ...COPIA_FACTURA, source_bloque_slug: '' })).toBe(true)
  })

  it('el mensaje apunta a la etapa de origen', () => {
    expect(mensajeCopiaDeSoloLectura(COPIA_FACTURA)).toMatch(/etapa 7/)
  })
})

describe('C5 — lo que no es copia no cambia', () => {
  it('los formularios 010/1668 (origen, sin `source_etapa_orden`) no son copias', () => {
    for (const ce of [
      { editable_siempre: true },
      { editable_siempre: true, compartido_con_origen: undefined },
    ]) {
      expect(esCopiaHeredada(ce)).toBe(false)
      expect(copiaDeSoloLectura(ce)).toBe(false)
      expect(origenDeCopiaEscribible(ce)).toBeNull()
    }
  })

  it('la casilla compartida (certificado UPME) no es copia heredada', () => {
    const upme = { compartido_con_origen: true, source_bloque_slug: 'concepto_upme', editable_siempre: true }
    expect(esCopiaHeredada(upme)).toBe(false)
    expect(copiaDeSoloLectura(upme)).toBe(false)
  })

  it('sin config no hay copia', () => {
    expect(copiaDeSoloLectura(null)).toBe(false)
    expect(copiaDeSoloLectura(undefined)).toBe(false)
  })
})
