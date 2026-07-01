/**
 * Carga el presupuesto por vendedor (hoja PPTO.VEND del export de ventas Siesa) a metas_vendedor.
 *   npx tsx scripts/load-metas-vendedor.ts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const WORKSPACE_ID = '4018f207-086c-41bb-94cb-ad70a0140742' // HJBC
const EXCEL_PATH = '/Users/mauricio/Developer/metrik/proyectos/hjbc/clarity/docs/entrada/VENTAS COLOMBIA CORTE 31 DE MAYO.xlsx'
const SHEET = 'PPTO.VEND'

const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim(); return s === '' ? null : s
}

async function main() {
  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true })
  const ws = wb.Sheets[SHEET]
  if (!ws) throw new Error(`Hoja ${SHEET} no encontrada`)
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
  const data: Record<string, unknown>[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const vendedor = str(r[7])
    const metaVenta = num(r[8])
    if (!vendedor || metaVenta === null) continue
    data.push({
      workspace_id: WORKSPACE_ID,
      anio: num(r[4]),
      mes: str(r[5]),
      centro_costo: str(r[6]),
      vendedor,
      meta_venta: metaVenta,
      meta_rentabilidad: num(r[9]),
      meta_utilidad: num(r[10]),
      dias_laborales: num(r[13]),
    })
  }
  console.log('Filas de meta a cargar:', data.length)
  await supabase.from('metas_vendedor').delete().eq('workspace_id', WORKSPACE_ID)
  const CHUNK = 1000
  let ins = 0
  for (let i = 0; i < data.length; i += CHUNK) {
    const { error } = await supabase.from('metas_vendedor').insert(data.slice(i, i + CHUNK))
    if (error) throw error
    ins += Math.min(CHUNK, data.length - i)
  }
  console.log('OK. Metas insertadas:', ins)
}
main().catch((e) => { console.error(e); process.exit(1) })
