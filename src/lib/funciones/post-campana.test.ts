import { describe, expect, it } from 'vitest'
import { diaYHora, generarPostCampana, LIMITE_INSTAGRAM, pesos } from './post-campana'

/** Datos [EJEMPLO]: no son de Sabor (la ficha real la llena Paula). */
const experiencia = {
  nombre: '[EJEMPLO] Harry Potter',
  historia: '[EJEMPLO] Una cena inspirada en el mundo mágico.',
  que_incluye: '[EJEMPLO] cinco tiempos inspirados en la película, dos bebidas especiales y la proyección',
  edad_minima: 6,
}
const campana = { precio_persona: 180_000, precio_preventa_persona: 150_000, abono_persona: 100_000, permite_pago_total: true }
const contacto = { como_reservar: '[EJEMPLO] escríbenos por DM', donde_pagar: '[EJEMPLO] link de pago', direccion: '[EJEMPLO] Calle 1 # 2-3' }
// Sábado 24 de octubre de 2026 a la 1:00 p. m. y a las 5:00 p. m. de Bogotá (UTC−5).
const funciones = [
  { inicia_at: '2026-10-24T22:00:00Z', es_preventa: false },
  { inicia_at: '2026-10-24T18:00:00Z', es_preventa: true },
]

describe('el post de Instagram de una campaña', () => {
  it('sigue el esquema de Sabor, con día y hora completos y en orden', () => {
    const p = generarPostCampana(experiencia, campana, funciones, contacto)
    expect(p.faltantes).toEqual([])
    expect(p.texto).toContain('• sábado 24 de octubre, 1:00 p. m. (preventa)\n• sábado 24 de octubre, 5:00 p. m.')
    const orden = ['Harry Potter', 'Incluye:', 'Funciones:', 'Precio: $180.000 por persona.', 'Reservas con $100.000 por persona.',
      'Preventa: $150.000 por persona.', 'Cómo reservar:', 'Dónde pagar:', 'Dirección:']
    const posiciones = orden.map((t) => p.texto.indexOf(t))
    expect(posiciones.every((x) => x >= 0)).toBe(true)
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)
    expect([p.exceso, p.recortaria]).toEqual([0, []])
  })

  it('lo que no está en los datos lo marca como faltante, no lo inventa', () => {
    const p = generarPostCampana(
      { ...experiencia, historia: null, que_incluye: '  ' },
      { precio_persona: null, precio_preventa_persona: null, abono_persona: null, permite_pago_total: true },
      funciones,
      {},
    )
    expect(p.faltantes).toEqual(['intro', 'que_incluye', 'precio', 'preventa', 'como_reservar', 'donde_pagar', 'direccion'])
    expect(p.texto).toContain('[FALTA: la dirección]')
    expect(p.texto).toContain('[FALTA: el precio por persona]')
    expect(p.texto).not.toMatch(/\$\d/)
    expect(generarPostCampana(experiencia, campana, [], contacto).faltantes).toEqual(['funciones'])
  })

  it('sin preventa no habla de preventa', () => {
    const p = generarPostCampana(experiencia, campana, [{ inicia_at: '2026-10-24T18:00:00Z', es_preventa: false }], contacto)
    expect(p.texto).not.toMatch(/[Pp]reventa/)
  })

  it('respeta el límite: si se pasa, devuelve el exceso y qué recortaría, sin cortar', () => {
    const larga = { ...experiencia, historia: 'Una historia muy larga. '.repeat(90) }
    const p = generarPostCampana(larga, campana, funciones, contacto)
    expect(p.caracteres).toBeGreaterThan(LIMITE_INSTAGRAM)
    expect(p.exceso).toBe(p.caracteres - LIMITE_INSTAGRAM)
    expect(p.recortaria.map((r) => r.seccion)).toEqual(['intro'])
    expect(p.cabe_recortando).toBe(true)
    // No cortó nada: el texto trae todo.
    expect(p.texto).toContain(larga.historia.trim())
    // Muchas funciones que ni recortando caben: lo dice.
    const muchas = Array.from({ length: 80 }, (_, i) => ({ inicia_at: new Date(Date.parse('2026-10-24T18:00:00Z') + i * 86_400_000).toISOString(), es_preventa: false }))
    const q = generarPostCampana(experiencia, campana, muchas, contacto)
    expect(q.exceso).toBeGreaterThan(0)
    expect(q.cabe_recortando).toBe(false)
    expect(q.recortaria.map((r) => r.seccion)).toEqual(['intro', 'que_incluye'])
  })

  it('las piezas', () => {
    expect(diaYHora('2026-10-24T18:00:00Z')).toBe('sábado 24 de octubre, 1:00 p. m.')
    expect(diaYHora('2026-10-25T15:30:00Z')).toBe('domingo 25 de octubre, 10:30 a. m.')
    expect(diaYHora('2026-10-25T05:00:00Z')).toBe('domingo 25 de octubre, 12:00 a. m.')
    expect(pesos(180000)).toBe('$180.000')
    expect(pesos(1250000)).toBe('$1.250.000')
  })
})
