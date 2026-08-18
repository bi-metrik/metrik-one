/**
 * Siembra los terminos y condiciones vigentes de SOENA en la config del bloque
 * que genera la propuesta, para que la pantalla de /mi-negocio abra con el texto
 * real y no con una hoja en blanco.
 *
 * Hasta ahora las 18 clausulas vivian dentro del servicio de render
 * (`templates/soena/terminos-default.html`) y cambiarlas exigia un commit. Este
 * script las pasa a datos, una sola vez. El texto NO se reescribe aqui: se toma
 * del fixture que el test `terminos.test.ts` compara contra el HTML vigente, asi
 * que lo que se siembra es exactamente lo que hoy sale impreso.
 *
 * Correr DESPUES de mergear, porque el codigo que lee esta llave es el de este PR.
 * Sin `--commit` solo reporta que haria.
 *
 *   npx tsx scripts/seed-terminos-soena.ts [--commit]
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { clausulasAHtml, type ClausulaTerminos } from '../src/lib/propuesta/terminos'

const COMMIT = process.argv.includes('--commit')
const WORKSPACE_SOENA = '7dea141d-d4da-483d-a78d-b14ef35500c5'

// El parrafo de aceptacion tal como lo pidio SOENA (agrega la condicion de pago).
const CIERRE =
  'Con la firma del presente documento y el pago correspondiente, el Cliente declara haber ' +
  'leído y comprendido el alcance de los servicios ofrecidos por SOENA y acepta expresamente ' +
  'la presente propuesta junto con los términos y condiciones aquí establecidos. El servicio ' +
  'no se entenderá formalizado ni SOENA estará obligado a iniciar la Gestión mientras no se ' +
  'cuente con la firma del Cliente y el pago correspondiente.'

const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const clausulas = JSON.parse(
  readFileSync('src/lib/propuesta/__fixtures__/terminos-soena-vigentes.json', 'utf8'),
) as ClausulaTerminos[]

async function main() {
  const { data, error } = await supabase
    .from('bloque_configs')
    .select('id, nombre, config_extra, bloque_definitions!inner(tipo)')
    .eq('workspace_id', WORKSPACE_SOENA)
    .eq('bloque_definitions.tipo', 'propuesta_economica')
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as {
    id: string
    config_extra: Record<string, unknown> | null
  }[]
  const generadores = filas.filter((f) => (f.config_extra ?? {}).template_slug)
  if (generadores.length !== 1) {
    throw new Error(`Se esperaba 1 bloque generador, hay ${generadores.length}`)
  }
  const bloque = generadores[0]
  const configExtra = bloque.config_extra ?? {}

  if (configExtra.propuesta) {
    console.log('Ya hay terminos guardados en ese bloque. No se toca nada.')
    return
  }

  const propuesta = {
    clausulas,
    cierre: CIERRE,
    version: 1,
    updated_at: new Date().toISOString(),
    updated_by: null,
  }

  console.log(`Bloque ${bloque.id}: ${clausulas.length} clausulas, ${clausulasAHtml(clausulas).length} chars de HTML`)
  if (!COMMIT) {
    console.log('Dry run. Corre con --commit para escribir.')
    return
  }

  const { error: errUpd } = await supabase
    .from('bloque_configs')
    .update({ config_extra: { ...configExtra, propuesta } as never })
    .eq('id', bloque.id)
  if (errUpd) throw new Error(errUpd.message)
  console.log('Sembrado.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
