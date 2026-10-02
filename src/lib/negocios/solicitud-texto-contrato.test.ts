/**
 * El contrato de la función `solicitud-texto` escrito dos veces: en Deno
 * (`supabase/functions/_shared/solicitud-texto*.ts`) y del lado de la web (`solicitud-texto.ts`),
 * porque `tsconfig.json` excluye las funciones. Esta prueba compara las propiedades de cada tipo
 * del contrato y las variantes de los avisos: si uno cambia y el otro no, falla.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const WEB = readFileSync(path.join(__dirname, 'solicitud-texto.ts'), 'utf8')
const EDGE = [
  readFileSync(path.resolve(__dirname, '../../../supabase/functions/_shared/solicitud-texto.ts'), 'utf8'),
  readFileSync(path.resolve(__dirname, '../../../supabase/functions/_shared/solicitud-texto-reglas.ts'), 'utf8'),
].join('\n')

/** Los nombres de las propiedades de `export interface X { … }`, sin comentarios. */
function propiedades(fuente: string, nombre: string): string[] {
  const m = new RegExp(`export interface ${nombre} \\{([\\s\\S]*?)\\n\\}`).exec(fuente)
  if (!m) throw new Error(`no encontré la interfaz ${nombre}`)
  const cuerpo = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  return [...cuerpo.matchAll(/^\s*(\w+)\??:/gm)].map(x => x[1]).sort()
}

/** Los literales `tipo: '…'` de un tipo unión. */
function variantes(fuente: string, nombre: string): string[] {
  const m = new RegExp(`export type ${nombre} =([\\s\\S]*?)(?:\\n\\n|\\nexport )`).exec(fuente)
  if (!m) throw new Error(`no encontré el tipo ${nombre}`)
  return [...m[1].matchAll(/tipo: '(\w+)'/g)].map(x => x[1]).sort()
}

describe('el contrato de solicitud-texto', () => {
  for (const nombre of ['FilaResumen', 'PreguntaGuardian', 'ContactoWeb']) {
    it(`${nombre} tiene las mismas propiedades en los dos lados`, () => {
      expect(propiedades(WEB, nombre).length).toBeGreaterThan(1)
      expect(propiedades(WEB, nombre)).toEqual(propiedades(EDGE, nombre))
    })
  }

  for (const nombre of ['AvisoEntender', 'ContactoDecision']) {
    it(`${nombre} tiene las mismas variantes en los dos lados`, () => {
      expect(variantes(WEB, nombre).length).toBeGreaterThan(2)
      expect(variantes(WEB, nombre)).toEqual(variantes(EDGE, nombre))
    })
  }
})
