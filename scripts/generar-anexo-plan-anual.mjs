#!/usr/bin/env node
/**
 * Regenera `src/lib/valida-cda/plan-anual-anexo.ts` desde los dos textos finales del Anexo del Plan
 * Anual que viven en `docs/legal/plan-anual/` (copias byte a byte de
 * `proyectos/metrik/valida/docs/entrega/legal/plan-anual/`, repo metrik).
 *
 *   node scripts/generar-anexo-plan-anual.mjs
 *
 * Solo quita el comentario interno del encabezado (`<!-- … -->`) y deja un único salto final. Nada se
 * reescribe a mano: `plan-anual-anexo.test.ts` exige que la constante sea exactamente eso.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = process.cwd()
const dir = join(raiz, 'docs/legal/plan-anual')
const out = join(raiz, 'src/lib/valida-cda/plan-anual-anexo.ts')
const limpiar = (s) => s.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/\n*$/, '\n')
const v1 = limpiar(readFileSync(join(dir, 'anexo-plan-anual-valida-cda-v1.md'), 'utf8'))
const v2 = limpiar(readFileSync(join(dir, 'anexo-plan-anual-valida-cda-v2.0.md'), 'utf8'))

const ts = `/**
 * El Anexo del Plan Anual de VALIDA · Plan CDA, en sus dos textos finales (Emilio; aprobados por Legal y
 * por Vera el 2026-10-07), tal cual, SIN el comentario interno del encabezado («Uso interno, no se
 * muestra al Cliente»):
 *
 *   - \`ANEXO_PLAN_ANUAL_TERMINOS_V1\`: para los clientes en los Términos de Suscripción v1.3 / v1.4
 *     (los cuatro CDA de hoy). Fuente: \`docs/legal/plan-anual/anexo-plan-anual-valida-cda-v1.md\`.
 *   - \`ANEXO_PLAN_ANUAL_TERMINOS_V2\`: para los clientes en los Términos de Uso v2.0, variante CDA vía
 *     AFI. Fuente: \`docs/legal/plan-anual/anexo-plan-anual-valida-cda-v2.0.md\`.
 *
 * ⚠️ ARCHIVO GENERADO por \`scripts/generar-anexo-plan-anual.mjs\`: no se edita a mano. Las dos fuentes
 * son copias byte a byte de \`proyectos/metrik/valida/docs/entrega/legal/plan-anual/\` (repo metrik).
 * \`plan-anual-anexo.test.ts\` compara cada constante con su .md (diff mecánico, también en CI) y, en
 * la torre, cada .md con el original. Si el texto cambia, cambia la versión: lo aceptado queda con su
 * huella en \`planes_anuales_cda\`.
 *
 * Las llaves ({razon_social}, {nit}, {fecha_inicio_plan}, …) las llena \`renderAnexoPlanAnual\`.
 */

export const ANEXO_PLAN_ANUAL_SLUG = 'anexo-plan-anual-valida-cda'

export interface PlantillaAnexo {
  /** La serie de Términos a la que pertenece: decide qué anexo ve cada cliente. */
  terminos: 'v1' | 'v2'
  slug: string
  /** La versión que se guarda en la constancia (\`planes_anuales_cda.documento_version\`). */
  version: string
  /** El archivo fuente en \`docs/legal/plan-anual/\`. */
  archivo: string
  plantilla: string
}

export const ANEXO_PLAN_ANUAL_TERMINOS_V1: PlantillaAnexo = {
  terminos: 'v1',
  slug: ANEXO_PLAN_ANUAL_SLUG,
  version: 'v1',
  archivo: 'anexo-plan-anual-valida-cda-v1.md',
  plantilla: ${JSON.stringify(v1)},
}

export const ANEXO_PLAN_ANUAL_TERMINOS_V2: PlantillaAnexo = {
  terminos: 'v2',
  slug: ANEXO_PLAN_ANUAL_SLUG,
  version: 'v1-terminos-v2.0',
  archivo: 'anexo-plan-anual-valida-cda-v2.0.md',
  plantilla: ${JSON.stringify(v2)},
}
`
writeFileSync(out, ts)
console.log(`escrito ${out}`)
