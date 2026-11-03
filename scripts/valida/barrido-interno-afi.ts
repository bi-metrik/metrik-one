/**
 * Barrido interno de AFI: consulta en Valida, con la cuenta de MéTRIK, las filas de AFI que quedaron
 * en error por el tipo de documento (antes del 2026-10-23 el lote mandaba «CEDULA», «PP», «TI»… tal
 * cual y Valida respondía 400).
 *
 * Decisión de Mauricio (2026-10-24): no se reprocesan en la cuenta de AFI ni se reescriben sus filas.
 * Se corren por dentro a nombre de «MeTRIK — Consulta de listas» y, si sale algo significativo, se le
 * reporta a AFI. Lógica en `src/lib/valida/barrido-interno.ts`.
 *
 * Qué hace y qué no:
 *   - LEE de ONE: las filas de AFI (`valida_consultas`) y la llave de Valida del workspace metrik, de la
 *     misma forma que ONE (Vault y respaldo en `config_extra`). Nunca la imprime.
 *   - NO escribe nada en ONE: ni en las filas de AFI ni en ninguna otra tabla.
 *   - Con --aplicar consulta `POST /api/v1/validate` una vez por fila, con `referencia_externa` =
 *     `afi-valida-consultas-<id de la fila de AFI>` e `Idempotency-Key` por fila. Antes de cada una
 *     pregunta a Valida si ya existe una consulta con esa referencia: correrlo dos veces no consulta
 *     dos veces, ni pasadas las 24 h de la idempotencia.
 *   - El detalle completo (resultado de Valida, coincidencias) queda FUERA del repo, en
 *     <salida>/consultas.jsonl (una línea por fila, se retoma desde ahí) y <salida>/resumen-<fecha>.json.
 *     En pantalla solo conteos e ids, más lista y criterio de cada hallazgo. Nunca nombres ni documentos.
 *
 * Antes de consultar revisa la cuenta en Valida (`GET /api/v1/cuenta/consumo`): si la bolsa no alcanza
 * o la cuenta está bloqueada, no arranca.
 *
 * Uso (desde metrik-one/, con .env.local):
 *   npx tsx scripts/valida/barrido-interno-afi.ts                 # ensayo: cuenta, lista ids, revisa la cuenta
 *   npx tsx scripts/valida/barrido-interno-afi.ts --aplicar       # consulta en Valida
 *   ... --salida <carpeta>                                        # dónde dejar el detalle
 */
import '../_load-env'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { leerSecretosWorkspace, secretoConRespaldo } from '../../src/lib/secretos/workspace'
import { TIPOS_ACEPTADOS_ANTES, type ConsultaEnError } from '../../src/lib/valida/reproceso-tipo-documento'
import {
  WORKSPACE_AFI,
  WORKSPACE_METRIK,
  claveIdempotenciaBarrido,
  ejecutarBarrido,
  idsResueltos,
  leerEstadoCuenta,
  lineasHallazgo,
  planBarrido,
  resumirRegistro,
  type ConsultaPrevia,
  type CuerpoBarrido,
  type RegistroBarrido,
  type RespuestaValida,
} from '../../src/lib/valida/barrido-interno'
import type { ValidaResultado } from '../../src/lib/actions/valida-consultas'

const VALIDA_API_BASE = process.env.VALIDA_API_BASE || 'https://api.valida.metrikone.co'
const TIMEOUT_MS = 60_000
const SALIDA_POR_DEFECTO =
  '/tmp/claude-1000/-home-mauricio-Developer-metrik/f82f4240-2fcb-4aa6-9dcb-6dcd4411ad8b/scratchpad/barrido-afi'

const args = process.argv.slice(2)
const APLICAR = args.includes('--aplicar')
const iSalida = args.indexOf('--salida')
const SALIDA = iSalida >= 0 ? args[iSalida + 1] : SALIDA_POR_DEFECTO
if (!SALIDA || args.some((a) => a.startsWith('--') && !['--aplicar', '--salida'].includes(a))) {
  console.error('Uso: npx tsx scripts/valida/barrido-interno-afi.ts [--aplicar] [--salida <carpeta>]')
  process.exit(1)
}
if (SALIDA.startsWith(process.cwd())) {
  console.error('La salida tiene datos de AFI: tiene que quedar fuera del repo.')
  process.exit(1)
}

// Solo lecturas: select y la RPC que lee la llave. Nada de insert/update/delete en ONE.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function leerFilasAfi(): Promise<ConsultaEnError[]> {
  const out: ConsultaEnError[] = []
  const lista = `(${TIPOS_ACEPTADOS_ANTES.join(',')})`
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await svc
      .from('valida_consultas')
      .select('id, tipo_persona, nombre_consultado, documento_tipo, documento_numero')
      .eq('workspace_id', WORKSPACE_AFI)
      .eq('severidad', 'error')
      .is('valida_consulta_id', null)
      .not('documento_tipo', 'is', null)
      .not('documento_tipo', 'in', lista)
      .order('id')
      .range(desde, desde + 999)
    if (error) throw new Error(`No se pudo leer valida_consultas: ${error.message}`)
    out.push(...((data ?? []) as ConsultaEnError[]))
    if (!data || data.length < 1000) return out
  }
}

/** La llave de Valida del workspace metrik, como la lee ONE (`credencialValida`). */
async function llaveMetrik(): Promise<string | null> {
  const { data } = await svc.from('workspaces').select('config_extra').eq('id', WORKSPACE_METRIK).single()
  const vault = await leerSecretosWorkspace(WORKSPACE_METRIK, svc)
  return secretoConRespaldo(vault, (data?.config_extra ?? null) as Record<string, unknown> | null, 'valida_api_key') ?? null
}

async function revisarCuenta(llave: string, pendientes: number) {
  try {
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/cuenta/consumo`, {
      headers: { Authorization: `Bearer ${llave}` },
      signal: AbortSignal.timeout(15_000),
    })
    return leerEstadoCuenta(res.status, await res.json().catch(() => null), pendientes)
  } catch (err) {
    return { puede: false as const, detalle: `No se pudo leer la cuenta (${err instanceof Error ? err.name : 'error_red'}).` }
  }
}

function llamarCon(llave: string) {
  return async (cuerpo: CuerpoBarrido, clave: string): Promise<RespuestaValida> => {
    try {
      const res = await fetch(`${VALIDA_API_BASE}/api/v1/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llave}`, 'Idempotency-Key': clave },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`, status: res.status }
      return { ok: true, data: body as ValidaResultado }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.name : 'error_red' }
    }
  }
}

function previaCon(llave: string) {
  return async (referencia: string): Promise<ConsultaPrevia | null> => {
    const url = `${VALIDA_API_BASE}/api/v1/consultas?limite=1&referencia_externa=${encodeURIComponent(referencia)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${llave}` }, signal: AbortSignal.timeout(15_000) })
    // Sin poder confirmarlo no se consulta a ciegas: el barrido se detiene (se retoma luego).
    if (!res.ok) throw new Error(`No se pudo revisar si ya existe la consulta (HTTP ${res.status}).`)
    const body = (await res.json()) as { consultas?: ConsultaPrevia[] }
    return body.consultas?.[0] ?? null
  }
}

async function main() {
  mkdirSync(SALIDA, { recursive: true })
  const registro = join(SALIDA, 'consultas.jsonl')
  const sello = new Date().toISOString().replace(/[:.]/g, '-')
  const hechas = idsResueltos(existsSync(registro) ? readFileSync(registro, 'utf8').split('\n') : [])

  const filas = await leerFilasAfi()
  const planes = filas.map((f) => ({ id: f.id, plan: planBarrido(f) }))
  const aConsultar = planes.filter((p) => p.plan.accion === 'consultar' && !hechas.has(p.id))
  const aparte = planes.filter((p) => p.plan.accion === 'aparte')

  const llave = await llaveMetrik()
  if (!llave) {
    console.error('El workspace metrik no tiene llave de Valida.')
    process.exit(2)
  }
  const cuenta = await revisarCuenta(llave, aConsultar.length)

  if (!APLICAR) {
    const archivo = join(SALIDA, `ensayo-${sello}.json`)
    writeFileSync(
      archivo,
      JSON.stringify(
        {
          modo: 'ensayo',
          en: new Date().toISOString(),
          filas_afi: filas.length,
          ya_resueltas: hechas.size,
          cuenta,
          filas: planes.map((p) => ({
            afi_id: p.id,
            accion: p.plan.accion,
            tipo_original: p.plan.tipoOriginal,
            ...(p.plan.accion === 'consultar'
              ? { tipo_enviado: p.plan.tipo, tipo_inferido: p.plan.inferido, referencia_externa: p.plan.cuerpo.referencia_externa, idempotency_key: claveIdempotenciaBarrido(p.id) }
              : { motivo: p.plan.motivo }),
          })),
        },
        null,
        2,
      ),
    )
    console.log('Ensayo: no consulta a Valida ni escribe en ninguna base.')
    console.log(`Filas de AFI en error con un tipo que Valida no aceptaba: ${filas.length}`)
    console.log(`  por consultar: ${aConsultar.length}`)
    console.log(`  ya resueltas en una corrida anterior: ${planes.filter((p) => hechas.has(p.id)).length}`)
    console.log(`  aparte (tipo no deducible o sin número): ${aparte.length}`)
    console.log(`Cuenta MéTRIK en Valida: ${cuenta.puede ? 'alcanza' : 'NO alcanza'}. ${cuenta.detalle}`)
    console.log('ids por consultar:')
    for (const p of aConsultar) console.log(`  ${p.id}`)
    console.log('ids aparte:')
    for (const p of aparte) console.log(`  ${p.id}  ${p.plan.accion === 'aparte' ? p.plan.motivo : ''}`)
    console.log(`Detalle: ${archivo}`)
    return
  }

  if (!cuenta.puede) {
    console.error(`No se aplica: ${cuenta.detalle}`)
    process.exit(2)
  }

  const r = await ejecutarBarrido(filas, hechas, {
    llamar: llamarCon(llave),
    previa: previaCon(llave),
    registrar: (reg: RegistroBarrido) => appendFileSync(registro, `${JSON.stringify(reg)}\n`),
  })

  // El total sale del registro completo: una corrida retomada muestra todas las filas, no solo las suyas.
  const total = resumirRegistro(readFileSync(registro, 'utf8').split('\n'))
  const archivo = join(SALIDA, `resumen-${sello}.json`)
  writeFileSync(
    archivo,
    JSON.stringify({ modo: 'aplicar', en: new Date().toISOString(), cuenta, esta_corrida: r, total }, null, 2),
  )

  console.log(`Filas de AFI: ${r.revisadas} (resueltas en corridas anteriores: ${r.yaHechas})`)
  console.log('Por severidad (todas las corridas):')
  for (const [sev, n] of Object.entries(total.porSeveridad).sort((a, b) => b[1] - a[1])) console.log(`  ${sev}: ${n}`)
  console.log(`Errores pendientes: ${total.errores.length}`)
  for (const e of total.errores) console.log(`  ${e.afi_id}  ${e.error}${e.status ? ` (${e.status})` : ''}`)
  console.log(`Aparte: ${total.aparte.length}`)
  for (const a of total.aparte) console.log(`  ${a.afi_id}  ${a.motivo}`)
  if (r.detenido) console.log(`DETENIDO: ${r.detenido}. Se retoma corriendo lo mismo otra vez.`)
  console.log(`Hallazgos (alto, medio o bajo): ${total.hallazgos.length}`)
  for (const h of total.hallazgos) for (const l of lineasHallazgo(h)) console.log(`  ${l}`)
  console.log(`Detalle: ${archivo} y ${registro}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
