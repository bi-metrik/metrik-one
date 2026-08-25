import './_load-env'
import { createClient } from '@supabase/supabase-js'

/**
 * Saca `normalizar: 'nit_sin_dv'` del campo `nit` del RUT y endurece su prompt.
 *
 * Por qué: `nit_sin_dv` no lee si el valor trae DV, lo adivina (ver el aviso de
 * ÁMBITO en `src/lib/dian/nit.ts`). La casilla 5 del RUT NUNCA trae el DV —el RUT
 * lo imprime aparte, en la casilla 6, que ya se extrae en el campo `dv`—, así que
 * ahí la heurística solo puede hacer daño: mutiló 14 cédulas de 290 y una de ellas
 * (caso V0206) se radicó recortada en un Formulario 010 ante la DIAN.
 *
 * `dv: dv_desde_nit` se mantiene: el DV sí es función determinista del número base
 * (módulo 11 DIAN) y recalcularlo sobre una base ya correcta es lo que corresponde.
 *
 * Idempotente. Por defecto solo reporta; aplica con `--apply`.
 *   npx tsx scripts/fix-rut-nit-sin-normalizar.ts [--apply]
 */

const DESCRIPCION_NUEVA =
  'Número de Identificación Tributaria de la casilla 5 del RUT, COMPLETO. Solo dígitos, ' +
  'sin puntos, comas, guiones ni espacios. NO truncar ni omitir el último dígito. NO incluir ' +
  'el dígito de verificación (DV): el DV es un número aparte que va en la casilla 6 y NO debe ' +
  'pegarse a este. Para persona natural la casilla 5 es la cédula del titular.'

async function main() {
  const apply = process.argv.includes('--apply')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data, error } = await sb
    .from('bloque_configs')
    .select('id,slug,nombre,workspace_id,config_extra')
    .limit(5000)
  if (error) throw error

  let tocados = 0
  for (const bc of data ?? []) {
    const ce = (bc.config_extra ?? {}) as Record<string, unknown>
    const campos = ce.campos_extraccion as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(campos)) continue
    const nit = campos.find(c => c.slug === 'nit')
    if (!nit || nit.normalizar !== 'nit_sin_dv') continue

    tocados++
    console.log(`\n${bc.id}  ${bc.slug ?? '(sin slug)'} — ${bc.nombre}  ws=${bc.workspace_id}`)
    console.log(`  antes: normalizar=${nit.normalizar}`)
    console.log(`         ${nit.descripcion_ai}`)

    const nuevos = campos.map(c =>
      c.slug === 'nit'
        ? Object.fromEntries(Object.entries({ ...c, descripcion_ai: DESCRIPCION_NUEVA }).filter(([k]) => k !== 'normalizar'))
        : c,
    )
    console.log(`  despues: sin normalizar`)
    console.log(`         ${DESCRIPCION_NUEVA}`)

    if (!apply) continue
    const { error: upErr } = await sb
      .from('bloque_configs')
      .update({ config_extra: { ...ce, campos_extraccion: nuevos } })
      .eq('id', bc.id)
    if (upErr) throw upErr
    console.log('  ✔ aplicado')
  }

  console.log(`\n${tocados} bloque_configs con nit:nit_sin_dv${apply ? ' — actualizados' : ' — dry-run, usa --apply'}`)
}

main().catch(e => { console.error(e); process.exit(1) })
