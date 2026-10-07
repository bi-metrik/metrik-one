import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANEXO_PLAN_ANUAL_SLUG, ANEXO_PLAN_ANUAL_TERMINOS_V1, ANEXO_PLAN_ANUAL_TERMINOS_V2, type PlantillaAnexo } from './plan-anual-anexo'

/**
 * Las dos copias del Anexo del Plan Anual que lleva ONE son las de Emilio, letra por letra (sin el
 * comentario interno del encabezado). Dos comparaciones mecánicas:
 *
 *   1. SIEMPRE (también en CI): cada constante es exactamente su .md de `docs/legal/plan-anual/`, sin el
 *      comentario. Nadie reescribe la constante a mano: se regenera con
 *      `node scripts/generar-anexo-plan-anual.mjs`.
 *   2. Donde está el original (la torre; el repo `metrik` no está en la CI de ONE): cada .md de
 *      `docs/legal/plan-anual/` es byte a byte el de `proyectos/metrik/valida/docs/entrega/legal/plan-anual/`.
 */

const COPIAS = join(process.cwd(), 'docs/legal/plan-anual')
const ORIGINALES = '/home/mauricio/Developer/metrik/proyectos/metrik/valida/docs/entrega/legal/plan-anual'

const sinComentario = (md: string) => md.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/\n*$/, '\n')

const ANEXOS: PlantillaAnexo[] = [ANEXO_PLAN_ANUAL_TERMINOS_V1, ANEXO_PLAN_ANUAL_TERMINOS_V2]

describe('el anexo del plan anual', () => {
  it('slug y versiones: una por serie de Términos', () => {
    expect(ANEXO_PLAN_ANUAL_TERMINOS_V1).toMatchObject({ terminos: 'v1', slug: ANEXO_PLAN_ANUAL_SLUG, version: 'v1' })
    expect(ANEXO_PLAN_ANUAL_TERMINOS_V2).toMatchObject({ terminos: 'v2', slug: ANEXO_PLAN_ANUAL_SLUG, version: 'v1-terminos-v2.0' })
  })

  it.each(ANEXOS.map((a) => [a.archivo, a] as const))('%s: lo interno no se le muestra al cliente', (_archivo, a) => {
    expect(a.plantilla.startsWith('# ANEXO DEL PLAN ANUAL\n')).toBe(true)
    expect(a.plantilla).not.toMatch(/Uso interno|BORRADOR|<!--/)
  })

  it.each(ANEXOS.map((a) => [a.archivo, a] as const))('%s: la constante es el .md de docs/legal, letra por letra', (archivo, a) => {
    expect(a.plantilla).toBe(sinComentario(readFileSync(join(COPIAS, archivo), 'utf8')))
  })

  it.runIf(existsSync(ORIGINALES)).each(ANEXOS.map((a) => [a.archivo] as const))(
    '%s: la copia de docs/legal es byte a byte el texto final de Emilio',
    (archivo) => {
      expect(readFileSync(join(COPIAS, archivo), 'utf8')).toBe(readFileSync(join(ORIGINALES, archivo), 'utf8'))
    },
  )

  it('la v2.0 es la de los Términos v2.0 CDA vía AFI y la v1 la de los v1.3/v1.4', () => {
    expect(ANEXO_PLAN_ANUAL_TERMINOS_V1.plantilla).toContain('Términos de Suscripción al Servicio VALIDA · Plan CDA · Anexo v1')
    expect(ANEXO_PLAN_ANUAL_TERMINOS_V2.plantilla).toContain('Términos de Uso de VALIDA · Variante CDA vía AFI · Versión 2.0')
    expect(ANEXO_PLAN_ANUAL_TERMINOS_V2.plantilla).toContain('Está disponible para las Órdenes de esta variante con valor mensual de $150.000.')
  })
})
