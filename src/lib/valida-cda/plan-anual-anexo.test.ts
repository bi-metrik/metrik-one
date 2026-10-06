import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ANEXO_PLAN_ANUAL_PLANTILLA, ANEXO_PLAN_ANUAL_SLUG, ANEXO_PLAN_ANUAL_VERSION } from './plan-anual-anexo'

/**
 * La copia del Anexo del Plan Anual que lleva ONE es la de Emilio, letra por letra (sin el comentario
 * interno del encabezado). El original vive en el repo `metrik`, que la CI de ONE no tiene: la
 * comparación corre donde el archivo está (la torre) y se salta donde no.
 */
const ORIGINAL = '/home/mauricio/Developer/metrik/proyectos/metrik/valida/docs/entrega/legal/plan-anual/anexo-plan-anual-valida-cda-v1.md'

describe('el anexo del plan anual', () => {
  it('slug y versión acordados (anexo-plan-anual-valida-cda v1)', () => {
    expect(ANEXO_PLAN_ANUAL_SLUG).toBe('anexo-plan-anual-valida-cda')
    expect(ANEXO_PLAN_ANUAL_VERSION).toBe('v1')
    expect(ANEXO_PLAN_ANUAL_PLANTILLA.startsWith('# ANEXO DEL PLAN ANUAL\n')).toBe(true)
    // Lo interno no se le muestra al cliente.
    expect(ANEXO_PLAN_ANUAL_PLANTILLA).not.toMatch(/Uso interno|BORRADOR|<!--/)
  })

  it.runIf(existsSync(ORIGINAL))('es la copia exacta del archivo de Emilio', () => {
    const original = readFileSync(ORIGINAL, 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '').replace(/\n*$/, '\n')
    expect(ANEXO_PLAN_ANUAL_PLANTILLA).toBe(original)
  })
})
