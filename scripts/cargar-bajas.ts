/**
 * Carga bajas en lote a `supresiones` desde un CSV (bajas de la ola 1 de Instantly, etc.).
 *
 *   npx tsx scripts/cargar-bajas.ts bajas.csv --campana=instantly-ola-1            # DRY-RUN (no escribe)
 *   npx tsx scripts/cargar-bajas.ts bajas.csv --campana=instantly-ola-1 --aplicar  # escribe
 *
 * CSV: cabecera `email,telefono,nit,fecha,canal,motivo,campana` (fecha ISO; canal/motivo/campana
 * opcionales: toman --canal=email --motivo=baja y --campana). Idempotente: repetir el archivo no
 * duplica (unique tipo+huella; las existentes se ignoran y conservan su fecha original).
 * Solo se guardan huellas; el CSV no se copia a ningun sitio.
 */
import './_load-env'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { filasDeBajas } from '../src/lib/supresion/csv-bajas'

const args = process.argv.slice(2)
const archivo = args.find((a) => !a.startsWith('--'))
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
if (!archivo) { console.error('uso: cargar-bajas.ts archivo.csv [--campana=X] [--canal=email] [--motivo=baja] [--aplicar]'); process.exit(1) }

const { filas, errores } = filasDeBajas(readFileSync(archivo, 'utf8'), {
  canal: opt('canal', 'email'), motivo: opt('motivo', 'baja'), campana: opt('campana', '') || null,
})
errores.forEach((e) => console.error('ERROR', e))
const porTipo = filas.reduce<Record<string, number>>((a, f) => ((a[f.tipo] = (a[f.tipo] ?? 0) + 1), a), {})
console.log(`${filas.length} bajas validas`, porTipo, `${errores.length} errores`)
if (errores.length) { console.error('Corrige los errores y reintenta; no se escribio nada.'); process.exit(1) }
if (!args.includes('--aplicar')) { console.log('DRY-RUN: no se escribio nada. Agrega --aplicar.'); process.exit(0) }

async function main() {
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await svc
    .from('supresiones')
    .upsert(filas.map((f) => ({ ...f, registrado_por: 'script:cargar-bajas' })), { onConflict: 'tipo,huella', ignoreDuplicates: true })
    .select('id')
  if (error) { console.error(error.message); process.exit(1) }
  console.log(`Insertadas ${data?.length ?? 0}; ya existian ${filas.length - (data?.length ?? 0)}.`)
}
main()
