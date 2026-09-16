/**
 * Contrato entre la fuente (`referencia.ts`) y su COPIA de Deno
 * (`supabase/functions/_shared/referencia-archivo.ts`).
 *
 * La copia existe porque las edge functions no resuelven `@/lib`: es la misma razón por
 * la que `email_cliente_negocio` vive en SQL. Lo que esta prueba impide es que las dos
 * se separen en silencio, que es el modo de fallo caro: el bot escribiría referencias
 * que el endpoint no reconoce, o el aviso al cliente dejaría de firmar un bucket que sí
 * está cerrado, y en ninguno de los dos casos falla nada — solo deja de funcionar.
 *
 * Se lee el ARCHIVO y no se importa: `referencia-archivo.ts` usa la extensión `.ts` en
 * sus imports (obligatorio en Deno) y no está en la suite de vitest.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUCKETS_ONE, PREFIJO_REFERENCIA_ONE } from './referencia'

const RUTA_COPIA = join(process.cwd(), 'supabase/functions/_shared/referencia-archivo.ts')
const copia = readFileSync(RUTA_COPIA, 'utf8')

describe('la copia de Deno no se separa de la fuente', () => {
  it('el prefijo es el mismo', () => {
    const m = copia.match(/export const PREFIJO_REFERENCIA_ONE = '([^']+)'/)
    expect(m, 'no se encontró PREFIJO_REFERENCIA_ONE en la copia de Deno').not.toBeNull()
    expect(m![1]).toBe(PREFIJO_REFERENCIA_ONE)
  })

  it('la lista de buckets es la misma, y en el mismo orden', () => {
    const m = copia.match(/export const BUCKETS_ONE = \[([^\]]+)\]/)
    expect(m, 'no se encontró BUCKETS_ONE en la copia de Deno').not.toBeNull()
    const buckets = m![1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    expect(buckets).toEqual([...BUCKETS_ONE])
  })

  it('las dos constantes con nombre propio apuntan al mismo bucket', () => {
    expect(copia).toContain(`export const BUCKET_DOCUMENTOS_ONE: BucketOne = 've-documentos'`)
    expect(copia).toContain(`export const BUCKET_SOPORTES_GASTO: BucketOne = 'gastos-soportes'`)
  })

  it('la copia NO trae la derivación de dueño ni ninguna puerta', () => {
    // Si alguien copia `duenoDeReferencia` aquí, la autorización pasa a vivir en dos
    // sitios y esta prueba es el único aviso. La decisión de acceso se queda en
    // `abrir.ts`, del lado de Next, donde se puede probar entera.
    expect(copia).not.toContain('duenoDeReferencia')
    expect(copia).not.toContain('negocioDeRuta')
    expect(copia).not.toContain('puedeVerNegocio')
  })
})
