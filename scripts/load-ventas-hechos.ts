/**
 * Carga una hoja de Excel de ventas (export Siesa) a la tabla de hechos ventas_hechos.
 * Uso puntual de ingesta. Futuro: reemplazar por conector directo a Siesa.
 *
 *   npx tsx scripts/load-ventas-hechos.ts
 *
 * Config abajo (WORKSPACE_ID, EXCEL_PATH, SHEET, COL_OFFSET). Corre con service_role
 * (bypasea RLS). Idempotente por lote: borra el lote previo del workspace antes de cargar.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

// ── Config ────────────────────────────────────────────────
const WORKSPACE_ID = '4018f207-086c-41bb-94cb-ad70a0140742' // HJBC
const EXCEL_PATH = '/Users/mauricio/Developer/metrik/proyectos/hjbc/clarity/docs/entrada/VENTAS COLOMBIA CORTE 31 DE MAYO.xlsx'
const SHEET = 'Ventas'
const LOTE = 'hjbc-co-2026-05'
// En la hoja Ventas los headers arrancan en la columna 1 (col 0 vacia).
const O = 1 // offset de columna

// ── Env (.env.local manual) ───────────────────────────────
const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
const toDate = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return null
}

async function main() {
  console.log('Leyendo', EXCEL_PATH)
  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true })
  const ws = wb.Sheets[SHEET]
  if (!ws) throw new Error(`Hoja ${SHEET} no encontrada`)
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
  // rows[0] = headers; datos desde rows[1]
  const data: Record<string, unknown>[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const documento = str(r[O + 7])
    const ventaNeta = num(r[O + 18])
    if (!documento && ventaNeta === null) continue // fila vacia
    const utilidad = num(r[O + 22])
    const rentabilidad = ventaNeta && ventaNeta !== 0 && utilidad !== null ? utilidad / ventaNeta : null
    data.push({
      workspace_id: WORKSPACE_ID,
      anio: num(r[O + 0]),
      mes: str(r[O + 1]),
      tipo_docto: str(r[O + 5]),
      documento,
      cliente: str(r[O + 10]),
      bodega: str(r[O + 11]),
      referencia: str(r[O + 12]),
      descripcion: str(r[O + 13]),
      linea: str(r[O + 14]),
      centro_costo: str(r[O + 4]),
      cantidad: num(r[O + 15]),
      precio_unit: num(r[O + 16]),
      descuento: num(r[O + 17]),
      venta_neta: ventaNeta,
      costo: num(r[O + 20]),
      utilidad,
      rentabilidad,
      vendedor: str(r[O + 21]),
      fecha: toDate(r[O + 8]),
      fuente: 'excel',
      lote: LOTE,
    })
  }
  console.log(`Filas a cargar: ${data.length}`)

  // Idempotencia: limpiar lote previo
  const del = await supabase.from('ventas_hechos').delete().eq('workspace_id', WORKSPACE_ID).eq('lote', LOTE)
  if (del.error) throw del.error

  const CHUNK = 1000
  let inserted = 0
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK)
    const { error } = await supabase.from('ventas_hechos').insert(chunk)
    if (error) throw error
    inserted += chunk.length
    process.stdout.write(`\r  insertadas ${inserted}/${data.length}`)
  }
  console.log('\nOK. Total insertado:', inserted)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
