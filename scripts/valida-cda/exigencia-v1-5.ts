/**
 * ¿Desde cuándo se le exige a cada CDA la aceptación de la v1.5 (cláusula 16.4), y la tiene? SOLO LEE: no
 * escribe nada en la base ni manda nada.
 *
 * Usa las mismas funciones puras que la puerta (`exigenciaV15`, `finUltimoPeriodoPagado`, `cuotasConEstado`)
 * sobre los mismos datos que leen las RPC de la sesión (`mis_cuotas_de_servicio`, `mis_cobros_de_servicio`),
 * leídos aquí con service role porque no hay sesión del CDA. Sirve para:
 *
 *   - simular una fecha (`--hoy`) y ver si el espacio quedaría sin consultas nuevas ese día (la prueba del
 *     PR en cda-pruebas: `--qa --hoy 2027-01-24`);
 *   - revisar antes del 22-dic-2026 (Maxitec) y del 16-ene-2027 (los otros tres) a quién le llega.
 *
 * Uso (desde la raíz de metrik-one):
 *   npx tsx scripts/valida-cda/exigencia-v1-5.ts                       # los 4 CDA, hoy (Bogotá)
 *   npx tsx scripts/valida-cda/exigencia-v1-5.ts --qa --hoy 2027-01-24 # solo cda-pruebas, en esa fecha
 *   npx tsx scripts/valida-cda/exigencia-v1-5.ts --solo maxitec --hoy 2026-12-22
 *   … --como-sin-aceptar   # simula que la v1.5 no está aceptada (cda-pruebas ya la aceptó en QA y la
 *                          # constancia no se borra)
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (.env.local o entorno).
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { cuotasConEstado, type CobroRecibido, type CuotaDeServicio } from '../../src/lib/valida-cda/pago-pendiente.ts'
import {
  datosDelTextoV15,
  exigenciaV15,
  finUltimoPeriodoPagado,
  textoExigidaV15,
} from '../../src/lib/valida-cda/terminos-v1-5.ts'

const CDAS = ['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec'] as const
const SLUG_DOC = 'terminos-suscripcion-valida-cda'
const args = process.argv.slice(2)
const valorDe = (bandera: string) => (args.includes(bandera) ? args[args.indexOf(bandera) + 1] : undefined)
const SOLO = valorDe('--solo')
const COMO_SIN_ACEPTAR = args.includes('--como-sin-aceptar')
const HOY = valorDe('--hoy') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
if (!/^\d{4}-\d{2}-\d{2}$/.test(HOY)) {
  console.error('--hoy va como YYYY-MM-DD')
  process.exit(1)
}
const espacios: readonly string[] = args.includes('--qa') ? ['cda-pruebas'] : SOLO ? CDAS.filter((s) => s === SOLO) : CDAS
if (espacios.length === 0) {
  console.error(`--solo tiene que ser uno de: ${CDAS.join(', ')}`)
  process.exit(1)
}

const env: Record<string, string> = { ...(process.env as Record<string, string>) }
try {
  for (const linea of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
  }
} catch {
  // Sin .env.local se sigue: puede venir todo por entorno.
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) as any

async function uno(slug: string): Promise<boolean> {
  const fallo = (msg: string) => {
    console.error(`✗ ${slug}: ${msg}`)
    return false
  }
  const ws = await db.from('workspaces').select('id').eq('slug', slug).maybeSingle()
  if (ws.error || !ws.data) return fallo(`no se encontró el espacio (${ws.error?.message ?? 'sin fila'})`)
  const contrato = await db
    .from('servicios_contratados')
    .select('id, workspace_id, empresa_id, negocio_id')
    .eq('workspace_pagador_id', ws.data.id)
    .eq('servicio_slug', 'valida-cda-licencia')
    .eq('estado', 'activo')
  if (contrato.error) return fallo(`contrato: ${contrato.error.message}`)
  if ((contrato.data ?? []).length !== 1) return fallo(`se esperaba 1 contrato activo y hay ${(contrato.data ?? []).length}`)
  const sc = contrato.data[0]

  const doc = await db
    .from('documentos_contractuales_versiones')
    .select('id, texto_md')
    .eq('empresa_id', sc.empresa_id)
    .eq('slug', SLUG_DOC)
    .eq('version', 'v1.5')
    .maybeSingle()
  if (doc.error) return fallo(`v1.5: ${doc.error.message}`)
  if (!doc.data) return fallo('la v1.5 no está registrada')
  const acept = await db.from('aceptaciones_terminos').select('created_at').eq('documento_version_id', doc.data.id).limit(1)
  if (acept.error) return fallo(`aceptaciones: ${acept.error.message}`)
  const aceptadaEnBase = (acept.data ?? []).length > 0
  const aceptada = aceptadaEnBase && !COMO_SIN_ACEPTAR

  // Lo mismo que `mis_cuotas_de_servicio` y `mis_cobros_de_servicio`.
  const planes = await db.from('planes_cobro').select('id').eq('negocio_id', sc.negocio_id).eq('workspace_id', sc.workspace_id)
  if (planes.error) return fallo(`planes: ${planes.error.message}`)
  const ids = (planes.data ?? []).map((p: { id: string }) => p.id)
  const q = ids.length
    ? await db.from('plan_cobro_cuotas').select('id, numero, tipo, monto, fecha_vencimiento, concepto_detalle').in('plan_cobro_id', ids)
    : { data: [], error: null }
  if (q.error) return fallo(`cuotas: ${q.error.message}`)
  const c = await db.from('cobros').select('fecha, monto, monto_anulado, anulado_at, retencion_iva').eq('negocio_id', sc.negocio_id)
  if (c.error) return fallo(`cobros: ${c.error.message}`)
  const cuotas: CuotaDeServicio[] = (q.data ?? []).map(
    (f: { id: string; numero: number; tipo: string; monto: string; fecha_vencimiento: string; concepto_detalle: string | null }) => ({
      cuotaId: f.id,
      numero: f.numero,
      tipo: f.tipo,
      monto: Number(f.monto),
      fechaVencimiento: f.fecha_vencimiento,
      concepto: f.concepto_detalle,
      enlacePagoUrl: null,
      enlacePagoExpira: null,
    }),
  )
  const cobros: CobroRecibido[] = (c.data ?? []).map(
    (f: { fecha: string | null; monto: string | null; monto_anulado: string | null; anulado_at: string | null; retencion_iva: string | null }) => ({
      monto: Number(Number(f.monto) ? f.monto : (f.monto_anulado ?? f.monto ?? 0)),
      estado: f.anulado_at ? 'anulado' : f.fecha ? 'pagado' : 'programado',
      retencionIva: Number(f.retencion_iva ?? 0),
    }),
  )

  const texto = datosDelTextoV15(doc.data.texto_md)
  const finPagado = finUltimoPeriodoPagado(cuotasConEstado({ cuotas, cobros, hoy: HOY, ahoraISO: `${HOY}T17:00:00Z` }))
  const r = exigenciaV15({ base: texto.exigeDesde, finPagado, hoy: HOY })
  const desde = r.estado === 'exigida' ? r.desde : null
  console.log(
    `${slug}: base 16.4 ${texto.exigeDesde ?? '¿?'} · pagado hasta ${finPagado ?? 'ninguno'} · v1.5 ${aceptada ? 'ACEPTADA' : aceptadaEnBase ? 'aceptada, simulada sin aceptar' : 'sin aceptar'} · ` +
      `el ${HOY}: ${aceptada ? 'consulta (aceptada)' : r.estado === 'exigida' ? `SIN CONSULTAS NUEVAS (exigida desde el ${desde})` : 'consulta (todavía no se exige)'}`,
  )
  if (!aceptada && r.estado === 'exigida') console.log(`  → «${textoExigidaV15(texto.razonSocial)}»`)
  return true
}

async function main() {
  let ok = true
  for (const slug of espacios) ok = (await uno(slug)) && ok
  process.exit(ok ? 0 : 1)
}
void main()
