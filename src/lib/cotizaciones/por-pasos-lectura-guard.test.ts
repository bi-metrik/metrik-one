/**
 * Criterio N4 de Vera: NINGÚN LECTOR DE PLATA MIRA EL INTERRUPTOR.
 *
 * El interruptor de la cotización por pasos (`por-pasos.ts`) gobierna la pantalla y las
 * escrituras nuevas. Si el total, el IVA, el PDF, la aprobación, el gate de etapa, el
 * registro de decisiones o el presupuesto lo consultaran, apagarlo movería precios (riesgo
 * R3 de la nota técnica de Max). Esta prueba recorre el grafo de imports desde cada lector,
 * TRANSITIVO, y falla si alguno llega al módulo del interruptor o a la clave
 * `cotizacion_por_pasos` del `config_extra`.
 *
 * Se vio fallar: agregando `import './por-pasos'` a `totales.ts` (ver el PR de C1).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const RAIZ = path.resolve(__dirname, '../../..')
const SRC = path.join(RAIZ, 'src')

/** Los lectores de plata (nota técnica de Max §0 y §1.3; criterio N4). */
export const LECTORES_DE_PLATA: Record<string, string> = {
  'total (cascada)': 'src/lib/cotizaciones/totales.ts',
  'total por tarifa': 'src/lib/cotizaciones/itinerarios.ts',
  'total del principal y gate': 'src/lib/cotizaciones/itinerarios-datos.ts',
  'recalcularTotales': 'src/app/(app)/negocios/cotizacion-actions.ts',
  'IVA': 'src/lib/fiscal/iva-cotizacion-datos.ts',
  'PDF': 'src/app/(app)/negocios/cotizacion-pdf-actions.ts',
  'plantillas del PDF': 'src/lib/pdf/plantillas-cotizacion.ts',
  'aprobación': 'src/app/(app)/negocios/[id]/cotizacion/actions.ts',
  'salida (piso)': 'src/lib/cotizaciones/piso-salida-datos.ts',
  'gate de etapa': 'src/lib/cotizaciones/gate-margen-datos.ts',
  'registro de decisiones': 'src/lib/cotizaciones/registro-decisiones.ts',
  'presupuesto': 'src/lib/negocios/presupuesto-ejecucion.ts',
}

const PROHIBIDOS = [
  path.join(SRC, 'lib/cotizaciones/por-pasos.ts'),
  path.join(SRC, 'lib/cotizaciones/por-pasos-datos.ts'),
]

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g

function resolver(desde: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(desde), spec)
  else return null
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

/** Todos los archivos que alcanza `entrada` por imports, con el camino que llevó a cada uno. */
export function alcanzables(entrada: string): Map<string, string[]> {
  const vistos = new Map<string, string[]>([[entrada, [entrada]]])
  const cola = [entrada]
  while (cola.length > 0) {
    const actual = cola.shift()!
    const texto = readFileSync(actual, 'utf8')
    for (const m of texto.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3]
      if (!spec) continue
      const destino = resolver(actual, spec)
      if (!destino || vistos.has(destino)) continue
      vistos.set(destino, [...vistos.get(actual)!, destino])
      cola.push(destino)
    }
  }
  return vistos
}

const rel = (p: string) => path.relative(RAIZ, p)

describe('N4 · ningún lector de plata mira el interruptor de la cotización por pasos', () => {
  for (const [nombre, archivo] of Object.entries(LECTORES_DE_PLATA)) {
    it(`${nombre} (${archivo}) no llega al interruptor`, () => {
      const entrada = path.join(RAIZ, archivo)
      expect(existsSync(entrada), `no existe ${archivo}: actualiza la lista de lectores`).toBe(true)
      const grafo = alcanzables(entrada)
      for (const prohibido of PROHIBIDOS) {
        const camino = grafo.get(prohibido)
        expect(camino?.map(rel).join(' → ') ?? null, `${nombre} importa el interruptor`).toBeNull()
      }
      for (const [archivoAlcanzado, camino] of grafo) {
        const texto = readFileSync(archivoAlcanzado, 'utf8')
        expect(
          texto.includes('cotizacion_por_pasos') ? camino.map(rel).join(' → ') : null,
          `${nombre} lee la clave del interruptor`,
        ).toBeNull()
      }
    })
  }
})
