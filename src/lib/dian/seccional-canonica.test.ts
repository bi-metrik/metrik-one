import { describe, it, expect } from 'vitest'
import { canonizarSeccional, presetKeySeccional, SECCIONALES_DIAN, labelCanonicoSeccional } from './seccionales'

/**
 * Los textos de entrada son los valores REALES medidos en `negocios.metadata.seccional`
 * del workspace SOENA el 2026-08-10, con su conteo de casos abiertos. Cada uno viene de
 * un camino de escritura distinto: el auto-init guardaba el label del catálogo, el
 * selector del 010 la clave de su preset, y los scripts de cargue el texto del Excel.
 */
describe('canonizarSeccional', () => {
  it('funde las tres variantes de Bogotá en una sola', () => {
    // 90 + 16 + 6 casos abiertos, repartidos en tres columnas del tablero.
    expect(canonizarSeccional('Bogota')).toBe('Bogotá')
    expect(canonizarSeccional('Bogotá')).toBe('Bogotá')
    expect(canonizarSeccional('Bogotá — Personas naturales')).toBe('Bogotá')
    expect(canonizarSeccional('Bogotá — Personas jurídicas')).toBe('Bogotá')
  })

  it('funde las dos variantes de Medellín', () => {
    // 11 + 11 casos abiertos.
    expect(canonizarSeccional('Medellin')).toBe('Medellín')
    expect(canonizarSeccional('Medellín')).toBe('Medellín')
  })

  it('resuelve el nombre oficial del RUT, que es como llega la casilla 12', () => {
    expect(canonizarSeccional('Impuestos y Aduanas de Tuluá')).toBe('Tuluá')
    expect(canonizarSeccional('Dirección Seccional de Impuestos de Cali')).toBe('Cali')
    expect(canonizarSeccional('IMPUESTOS DE MEDELLIN')).toBe('Medellín')
  })

  it('NO reconoce "Otras seccionales": es una clave de preset, no una seccional', () => {
    // Guardarla borraría de qué ciudad es el caso y dejaría al tablero sin saber
    // si necesita cita.
    expect(canonizarSeccional('Otras seccionales')).toBeNull()
  })

  it('devuelve null en lugar de adivinar cuando no reconoce el texto', () => {
    expect(canonizarSeccional('Seccional inexistente XYZ')).toBeNull()
    expect(canonizarSeccional(null)).toBeNull()
    expect(canonizarSeccional('')).toBeNull()
    expect(canonizarSeccional('   ')).toBeNull()
  })

  it('es idempotente: canonizar lo ya canónico no lo cambia', () => {
    // Si no lo fuera, un backfill correría distinto la segunda vez.
    for (const s of SECCIONALES_DIAN) {
      const canonico = labelCanonicoSeccional(s)
      expect(canonizarSeccional(canonico), canonico).toBe(canonico)
    }
  })

  it('todo el catálogo tiene canónico estable, y Bogotá es el único que colapsa', () => {
    const canonicos = SECCIONALES_DIAN.map(labelCanonicoSeccional)
    const unicos = new Set(canonicos)
    // 37 entradas, 36 nombres: los dos buzones de Bogotá comparten uno.
    expect(canonicos.length - unicos.size).toBe(1)
    expect(canonicos.filter(c => c === 'Bogotá')).toHaveLength(2)
  })
})

describe('presetKeySeccional', () => {
  // Las claves REALES del bloque 010 de SOENA (etapas Generación y Envío).
  const KEYS = ['Barranquilla', 'Bogotá', 'Bucaramanga', 'Cali', 'Medellín', 'Otras seccionales', 'Tuluá']

  it('encuentra el preset aunque el dato venga sin tilde', () => {
    // Éste es el defecto de origen: `seccionales[valor]` es match exacto, así que
    // "Bogota" no encontraba el preset de "Bogotá" y el 010 quedaba sin casilla 12.
    expect(presetKeySeccional('Bogota', KEYS)).toBe('Bogotá')
    expect(presetKeySeccional('Medellin', KEYS)).toBe('Medellín')
  })

  it('encuentra el preset desde el label con buzón', () => {
    expect(presetKeySeccional('Bogotá — Personas naturales', KEYS)).toBe('Bogotá')
  })

  it('manda a "Otras seccionales" las que no tienen preset propio', () => {
    // Girardot, Tunja, Pereira… son seccionales reales del catálogo, pero el preset
    // solo lista las que traen particularidades.
    expect(presetKeySeccional('Girardot', KEYS)).toBe('Otras seccionales')
    expect(presetKeySeccional('Tunja', KEYS)).toBe('Otras seccionales')
    expect(presetKeySeccional('Impuestos y Aduanas de Pereira', KEYS)).toBe('Otras seccionales')
  })

  it('encuentra la clave aunque el preset esté escrito distinto del canónico', () => {
    // La configuración del bloque la teclea una persona por workspace: puede tener la
    // ciudad sin tilde o en mayúsculas. Sin normalizar el lado de la CLAVE, el 010 se
    // quedaría sin preset exactamente igual que con el defecto original.
    expect(presetKeySeccional('Bogotá', ['bogota', 'Otras seccionales'])).toBe('bogota')
    expect(presetKeySeccional('Medellin', ['MEDELLIN', 'Otras seccionales'])).toBe('MEDELLIN')
    expect(presetKeySeccional('Impuestos y Aduanas de Tuluá', ['Tulua'])).toBe('Tulua')
  })

  it('respeta una clave del preset que no exista en el catálogo', () => {
    // La configuración del bloque es libre por workspace: no puede quedar
    // subordinada a que el nombre esté en SECCIONALES_DIAN.
    expect(presetKeySeccional('Zona Franca', [...KEYS, 'Zona Franca'])).toBe('Zona Franca')
  })

  it('un texto irreconocible cae a "Otras seccionales", no a null', () => {
    expect(presetKeySeccional('cualquier cosa', KEYS)).toBe('Otras seccionales')
    expect(presetKeySeccional(null, KEYS)).toBe('Otras seccionales')
  })

  it('sin claves configuradas no inventa ninguna', () => {
    expect(presetKeySeccional('Bogotá', [])).toBeNull()
  })

  it('sin "Otras seccionales" en el preset, lo no reconocido devuelve null', () => {
    // No se elige una clave al azar: el 010 se queda sin preset, que es lo honesto.
    expect(presetKeySeccional('Girardot', ['Bogotá', 'Cali'])).toBeNull()
  })
})
