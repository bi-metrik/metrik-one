import { describe, expect, it } from 'vitest'
import { BASES, GUIONES, dicho, marcas, nombresBase, pistasDe, referencia } from './guiones'
import { contieneNombre, llaveCifra, llaveCodigo } from './metricas'

describe('los 20 guiones (§4.6)', () => {
  it('son 20: 7 de Imperviun, 7 de Laura y 6 de Sabor, con id único', () => {
    expect(GUIONES).toHaveLength(20)
    const por = (w: string) => GUIONES.filter((g) => g.workspace === w).length
    expect([por('imperviun'), por('laura'), por('sabor')]).toEqual([7, 7, 6])
    expect(new Set(GUIONES.map((g) => g.id)).size).toBe(20)
  })

  it('cubren lo que pide la spec por caso', () => {
    const refs = (w: string) => GUIONES.filter((g) => g.workspace === w).map(referencia).join('\n')
    expect(refs('imperviun')).toMatch(/millones/)
    expect(refs('imperviun')).toMatch(/ mil /)
    expect(refs('imperviun')).toMatch(/factura/)
    expect(GUIONES.some((g) => g.workspace === 'imperviun' && /operario/.test(g.quien))).toBe(true)
    expect(refs('laura')).toMatch(/me pagó 40/)
    expect(refs('laura')).toMatch(/cuotas?/)
    expect(refs('sabor')).toMatch(/sábado a las 5/)
    expect(refs('sabor')).toMatch(/cédula/)
    expect(refs('sabor')).toMatch(/personas/)
  })

  it('mezclan las condiciones: ruido de calle, obra y salón; rápido; corte al final', () => {
    const c = GUIONES.map((g) => g.condiciones)
    for (const r of ['calle', 'obra', 'salon']) expect(c.some((x) => x.ruido === r)).toBe(true)
    expect(c.some((x) => x.ruido === null)).toBe(true)
    expect(c.filter((x) => x.rapido).length).toBeGreaterThanOrEqual(3)
    expect(c.filter((x) => x.corte).length).toBeGreaterThanOrEqual(3)
  })

  it('cada marca se puede medir y cada guion trae nombres', () => {
    for (const g of GUIONES) {
      const ms = marcas(g)
      expect(ms.some((m) => m.tipo === 'nombre'), g.id).toBe(true)
      for (const m of ms) {
        if (m.tipo === 'nombre') expect(contieneNombre(referencia(g), m.texto), `${g.id} ${m.texto}`).toBe(true)
        if (m.tipo === 'cifra') expect(llaveCifra(m.texto), `${g.id} ${m.texto}`).not.toBeNull()
        if (m.tipo === 'codigo') expect(llaveCodigo(m.texto), `${g.id} ${m.texto}`).toMatch(/^[a-z]+\d*\d+$/)
      }
    }
    expect(GUIONES.flatMap(marcas).filter((m) => m.tipo === 'codigo').length).toBeGreaterThanOrEqual(3)
  })

  it('los distractores están en la base de su workspace y no se dicen', () => {
    for (const g of GUIONES) {
      expect(g.distractores.length, g.id).toBeGreaterThan(0)
      const base = nombresBase(g.workspace)
      for (const d of g.distractores) {
        expect(base.some((n) => n === d || contieneNombre(n, d)), `${g.id}: ${d} no está en la base`).toBe(true)
        expect(contieneNombre(dicho(g), d), `${g.id}: ${d} se dice`).toBe(false)
      }
    }
  })

  it('la cola del corte la lee la voz y no entra a la referencia', () => {
    const g = GUIONES.find((x) => x.id === 'sab-06')!
    expect(dicho(g)).toMatch(/y quería pregun$/)
    expect(referencia(g)).not.toMatch(/pregun/)
    const k = GUIONES.find((x) => x.id === 'imp-03')!
    expect(referencia(k)).toContain('I1 26 5')
    expect(dicho(k)).toContain('i uno veintiséis cinco')
    expect(dicho(k)).not.toMatch(/[{}]/)
  })

  it('las pistas salen de la base con la función de producción: formato de código sin la lista; en público sin clientes', () => {
    const imp = pistasDe(GUIONES.find((x) => x.id === 'imp-01')!)!
    expect(imp).toContain('Gloria Benavides')
    expect(imp).toContain('Inversiones Iguazú')
    expect(imp).toContain('Tanque Bosque Verde')
    expect(imp).not.toContain('impermeabilización interna')
    expect(imp).toMatch(/Códigos de empresa en uso: I1, R1, S1, G1, B1\./)
    for (const c of ['I1 26 3', 'R1 26 2', 'S1 26 1', 'G1 25 4']) expect(imp).not.toContain(c)
    const lau = pistasDe(GUIONES.find((x) => x.id === 'lau-01')!)!
    expect(lau).toContain('Microblading')
    expect(lau).toContain('Yeimy Castaño')
    const sab = pistasDe(GUIONES.find((x) => x.id === 'sab-01')!)!
    expect(sab).toContain('Noche de Ramen')
    expect(sab).toContain('Camila Arboleda')
    expect(sab).not.toContain('Rodrigo Valencia')
    expect(sab).not.toMatch(/código/i)
  })

  it('sin datos reales de los clientes de MeTRIK (nombres de quienes contrataron)', () => {
    const todo = JSON.stringify({ GUIONES, BASES })
    for (const real of ['Liliana', 'Paula', 'Laura']) expect(todo).not.toContain(real)
  })
})
