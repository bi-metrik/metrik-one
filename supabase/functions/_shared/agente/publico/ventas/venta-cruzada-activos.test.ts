import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MapaComplementos } from './complementos-ventas'
import { complementosSqlDimpro } from './semilla-sql-dimpro'

/**
 * Venta cruzada de lo que está activo (Mauricio, 5-nov: «no está funcionando bien la venta cruzada»). El mapa del
 * piloto cubría las herramientas grandes, hoy agotadas; lo activo (accesorios MP-60 a MP-87) caía en `opciones` sin
 * relación (a la batería MP-62 le salían un aspa de mezclador y escobillas de cepillo).
 */
describe('venta cruzada de los productos activos', () => {
  const sql = readFileSync(join(process.cwd(), 'sql/dimpro/2026-11-05_venta-cruzada-activos.sql'), 'utf8')
  const mapa = JSON.parse(sql.match(/'(\{"mapa":.*\})'::jsonb/)![1].replace(/''/g, "'")).mapa as MapaComplementos

  it('el archivo es la salida del generador con ese mapa', () => {
    expect(sql.trimEnd()).toBe(complementosSqlDimpro(mapa, 'mapa de venta cruzada (complementos-activos.json)').trimEnd())
  })

  it('conserva el mapa del piloto y cubre los accesorios activos', () => {
    const piloto = readFileSync(join(process.cwd(), 'sql/dimpro/2026-10-30_venta-cruzada-piloto.sql'), 'utf8')
    const viejo = JSON.parse(piloto.match(/'(\{"mapa":.*\})'::jsonb/)![1].replace(/''/g, "'")).mapa as MapaComplementos
    for (const [k, v] of Object.entries(viejo)) expect(mapa[k]).toEqual(v)
    // Sin complemento honesto en el catálogo de hoy: autoperforante hex (no hay copa), tubo, grillete y la lanza.
    const sinMapa = new Set(['MP-65', 'MP-68', 'MP-70', 'MP-87'])
    for (let n = 60; n <= 87; n++) {
      const k = `MP-${n}`
      if (sinMapa.has(k)) continue
      expect(mapa[k]?.length, k).toBeGreaterThan(0)
      for (const c of mapa[k]) expect(c.codigo).not.toBe(k)
    }
    expect(mapa['MP-62'].map((c) => c.codigo)).toEqual(['MP-64', 'MP-69'])
  })

  it('el carrito cierra con la venta cruzada, no con «¿quieres algo más o seguimos?»', () => {
    const src = readFileSync(join(process.cwd(), 'supabase/functions/_shared/agente/publico/ventas/dominio-ventas.ts'), 'utf8')
    expect(src).not.toMatch(/pregúntale si quiere algo más o seguimos|Pregúntale si quiere algo más o seguimos/)
    expect(src.match(/ciérralo con la venta cruzada|Ciérralo con la venta cruzada/g)?.length).toBe(2)
  })
})
