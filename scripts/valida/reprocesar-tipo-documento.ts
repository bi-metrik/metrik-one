/**
 * Vuelve a consultar en Valida las filas de la carga masiva que quedaron en error por el tipo de
 * documento, y pone al día la MISMA fila de `valida_consultas` (y su fila de lote, si la hay).
 *
 * Por qué: hasta el 2026-10-23 el lote mandaba el tipo tal cual venía en el XLSX («CEDULA», «PP»,
 * «TI»…). Valida acepta un enum cerrado y respondía 400 sin cobrar; la fila quedaba en «Error». El
 * error fue de ONE, así que el reproceso NO debe cobrarle al cliente.
 *
 * Sin cobro: cada consulta va con la marca firmada de Valida (`src/lib/valida/sin-cobro.ts`), que
 * Valida registra con billable = false, costo 0 y el motivo, sin tocar la bolsa ni el periodo y sin
 * avisos de consumo. `--aplicar` exige `VALIDA_SIN_COBRO_SECRET` en el entorno (la pone Mauricio en
 * .env.local; nunca se imprime) y antes de consultar hace una prueba previa que no cobra: si Valida no
 * conoce la marca o el secreto no cuadra, no consulta nada. Si una respuesta llega sin confirmar el
 * «sin cobro», se detiene en esa fila.
 *
 * Qué filas: severidad `error` y un `documento_tipo` que Valida no acepta, en el espacio dado.
 *   - Tipo reconocible (CEDULA, CÉDULA, PP, PA, PASAPORTE…): se normaliza con `leerTipoDocumento`,
 *     la misma función del lote.
 *   - TI, PPT, RC: se saltan hasta que Valida los acepte (metrik-valida#70).
 *   - Irreconocible («X», un NIT puesto en la columna): solo una persona jurídica se deduce con
 *     seguridad (NIT). Las demás se listan aparte.
 *
 * Mismo cuerpo que el lote (tipo de persona, nombre, documento); ONE no manda sujeto obligado. El
 * negocio de la fila no cambia. `Idempotency-Key` por fila: correrlo dos veces no consulta dos veces.
 *
 * Salida: solo conteos e ids. Nunca nombres, documentos ni llaves.
 *
 * Uso (desde metrik-one/, con .env.local):
 *   npx tsx scripts/valida/reprocesar-tipo-documento.ts                 # ensayo: cuenta y lista ids
 *   npx tsx scripts/valida/reprocesar-tipo-documento.ts --probar        # solo la prueba previa sin cobro (no consulta)
 *   npx tsx scripts/valida/reprocesar-tipo-documento.ts --aplicar       # consulta sin cobro y escribe
 *   ... --workspace <uuid>                                              # otro espacio (por defecto, el de AFI)
 *
 * Requiere la migración 20261023180000_valida_consultas_reproceso.sql (columnas de constancia).
 */
import '../_load-env'
import { createClient } from '@supabase/supabase-js'
import { leerSecretosWorkspace, secretoConRespaldo } from '../../src/lib/secretos/workspace'
import {
  TIPOS_ACEPTADOS_HOY,
  ejecutarReproceso,
  ensayarReproceso,
  moverConteo,
  type ConsultaEnError,
  type RespuestaReproceso,
} from '../../src/lib/valida/reproceso-tipo-documento'
import type { ValidaConsultaInput, ValidaResultado } from '../../src/lib/actions/valida-consultas'
import {
  HEADER_SIN_COBRO,
  confirmaSinCobro,
  headersSinCobro,
  veredictoPruebaPrevia,
  type PruebaPrevia,
} from '../../src/lib/valida/sin-cobro'
import { randomBytes } from 'node:crypto'

/** El secreto de la consulta sin cobro de Valida. Sin él, `--aplicar` no corre. */
const SECRETO_SIN_COBRO = (process.env.VALIDA_SIN_COBRO_SECRET ?? '').trim() || null
const MOTIVO_SIN_COBRO = 'reproceso MeTRIK: tipo de documento de la carga masiva (ONE #1260)'

const WORKSPACE_AFI = '77ddc3f2-83aa-4a29-aa7f-18a6f6196c5b'
const VALIDA_API_BASE = process.env.VALIDA_API_BASE || 'https://api.valida.metrikone.co'
const TIMEOUT_MS = 30_000

const args = process.argv.slice(2)
const APLICAR = args.includes('--aplicar')
const PROBAR = args.includes('--probar')
const iWs = args.indexOf('--workspace')
const WORKSPACE = iWs >= 0 ? args[iWs + 1] : WORKSPACE_AFI
if (!WORKSPACE || !/^[0-9a-f-]{36}$/.test(WORKSPACE)) {
  console.error('Uso: npx tsx scripts/valida/reprocesar-tipo-documento.ts [--workspace <uuid>] [--probar | --aplicar]')
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function leerConsultas(): Promise<ConsultaEnError[]> {
  const out: ConsultaEnError[] = []
  const lista = `(${TIPOS_ACEPTADOS_HOY.join(',')})`
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await svc
      .from('valida_consultas')
      .select('id, tipo_persona, nombre_consultado, documento_tipo, documento_numero, negocio_id, lote_fila_id')
      .eq('workspace_id', WORKSPACE)
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

async function columnasDeConstancia(): Promise<boolean> {
  const { error } = await svc.from('valida_consultas').select('reprocesada_at, reproceso').limit(1)
  return !error
}

async function llaveValida(): Promise<string | null> {
  const { data } = await svc.from('workspaces').select('config_extra').eq('id', WORKSPACE).single()
  const vault = await leerSecretosWorkspace(WORKSPACE, svc)
  return secretoConRespaldo(vault, (data?.config_extra ?? null) as Record<string, unknown> | null, 'valida_api_key') ?? null
}

/** POST /api/v1/validate con la marca sin cobro firmada sobre ESTE cuerpo. */
async function postSinCobro(llave: string, secreto: string, cuerpo: string, clave?: string) {
  return fetch(`${VALIDA_API_BASE}/api/v1/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llave}`,
      ...(clave ? { 'Idempotency-Key': clave } : {}),
      ...headersSinCobro(secreto, MOTIVO_SIN_COBRO, cuerpo),
    },
    body: cuerpo,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

/**
 * Prueba previa que no consulta ni cobra: cuerpo `{}` (no cumple el esquema). Ver
 * `veredictoPruebaPrevia`. Devuelve el motivo para no seguir, o null.
 */
async function pruebaPrevia(llave: string, secreto: string): Promise<string | null> {
  const probar = async (s: string): Promise<PruebaPrevia> => {
    const res = await postSinCobro(llave, s, '{}')
    const body = await res.json().catch(() => ({}))
    return { status: res.status, error: typeof body.error === 'string' ? body.error : null }
  }
  const falso = await probar(randomBytes(32).toString('hex'))
  const real = await probar(secreto)
  return veredictoPruebaPrevia(falso, real)
}

function llamarCon(llave: string, secreto: string) {
  return async (input: ValidaConsultaInput, clave: string): Promise<RespuestaReproceso> => {
    try {
      const res = await postSinCobro(llave, secreto, JSON.stringify(input), clave)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}`, status: res.status }
      // 200 sin la confirmación: esa Valida no aplicó el «sin cobro». No se sigue.
      if (!confirmaSinCobro(res.headers.get(HEADER_SIN_COBRO), body)) {
        return { ok: false, error: 'sin_cobro_no_confirmado', status: res.status, detener: true }
      }
      return { ok: true, data: body as ValidaResultado }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.name : 'error_red' }
    }
  }
}

async function actualizarConsulta(id: string, cambios: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await svc
    .from('valida_consultas')
    .update(cambios)
    .eq('id', id)
    .eq('workspace_id', WORKSPACE)
    .eq('severidad', 'error')
    .is('valida_consulta_id', null)
    .select('id')
  if (error) throw new Error(`No se pudo escribir la consulta ${id}: ${error.message}`)
  return Array.isArray(data) && data.length === 1
}

async function actualizarFilaLote(loteFilaId: string, tipo: string, data: ValidaResultado): Promise<void> {
  const { data: fila } = await svc
    .from('valida_lote_filas')
    .select('id, lote_id, entrada, estado')
    .eq('id', loteFilaId)
    .eq('workspace_id', WORKSPACE)
    .maybeSingle()
  if (!fila || fila.estado !== 'error') return
  const { data: lote } = await svc.from('valida_lotes').select('id, estado, severidades').eq('id', fila.lote_id).single()
  // Un lote corriendo lo escribe el trabajador; no se pisa.
  if (!lote || lote.estado === 'en_cola' || lote.estado === 'procesando') return
  const entrada = { ...fila.entrada, documento: { ...(fila.entrada?.documento ?? {}), tipo } }
  await svc
    .from('valida_lote_filas')
    .update({
      entrada,
      estado: 'hecha',
      severidad: data.severidad,
      valida_consulta_id: data.consulta_id,
      total_matches: data.total_matches,
      resultado_error: null,
    })
    .eq('id', loteFilaId)
    .eq('estado', 'error')
  await svc
    .from('valida_lotes')
    .update({ severidades: moverConteo(lote.severidades ?? {}, data.severidad), updated_at: new Date().toISOString() })
    .eq('id', lote.id)
}

async function soloProbar() {
  if (!SECRETO_SIN_COBRO) {
    console.error('Falta VALIDA_SIN_COBRO_SECRET en el entorno.')
    process.exit(2)
  }
  const llave = await llaveValida()
  if (!llave) {
    console.error('El espacio no tiene llave de Valida.')
    process.exit(2)
  }
  const previa = await pruebaPrevia(llave, SECRETO_SIN_COBRO)
  console.log(previa ? `Prueba previa: NO. ${previa}` : 'Prueba previa: sí. Valida reconoce la consulta sin cobro y el secreto cuadra.')
  if (previa) process.exit(2)
}

async function main() {
  if (PROBAR) return soloProbar()
  const consultas = await leerConsultas()
  const ensayo = ensayarReproceso(consultas)

  if (!APLICAR) {
    console.log(`Ensayo (no escribe ni consulta). Espacio ${WORKSPACE}.`)
    console.log(`Filas en error con un tipo que Valida no acepta: ${consultas.length}`)
    console.log(`  se reprocesarían: ${ensayo.reprocesar.length}`)
    console.log(`  esperan a Valida (TI, PPT, RC): ${ensayo.esperar_valida.length}`)
    console.log(`  aparte (tipo no deducible o sin número): ${ensayo.aparte.length}`)
    console.log(`Columnas de constancia en la base: ${(await columnasDeConstancia()) ? 'sí' : 'NO (falta la migración)'}`)
    console.log(`VALIDA_SIN_COBRO_SECRET en el entorno: ${SECRETO_SIN_COBRO ? 'sí' : 'NO'}`)
    console.log('ids a reprocesar:')
    for (const id of ensayo.reprocesar) console.log(`  ${id}`)
    console.log('ids que esperan a Valida:')
    for (const id of ensayo.esperar_valida) console.log(`  ${id}`)
    console.log('ids aparte:')
    for (const id of ensayo.aparte) console.log(`  ${id}`)
    return
  }

  if (!SECRETO_SIN_COBRO) {
    console.error(
      'No se aplica: falta VALIDA_SIN_COBRO_SECRET en el entorno. Sin la marca sin cobro, Valida le ' +
        'cobraría cada consulta al cliente (bolsa, consumo del periodo y avisos de umbral).',
    )
    process.exit(2)
  }
  if (!(await columnasDeConstancia())) {
    console.error('Falta la migración 20261023180000_valida_consultas_reproceso.sql: no hay dónde dejar la constancia.')
    process.exit(2)
  }
  const llave = await llaveValida()
  if (!llave) {
    console.error('El espacio no tiene llave de Valida.')
    process.exit(2)
  }

  const previa = await pruebaPrevia(llave, SECRETO_SIN_COBRO)
  if (previa) {
    console.error(`No se aplica: ${previa}`)
    process.exit(2)
  }
  console.log('Prueba previa: Valida reconoce la consulta sin cobro y el secreto cuadra.')

  const r = await ejecutarReproceso(consultas, {
    llamar: llamarCon(llave, SECRETO_SIN_COBRO),
    actualizarConsulta,
    actualizarFilaLote,
  })
  console.log(`Reprocesadas: ${r.reprocesadas}`)
  console.log(`Siguen en error: ${r.siguenEnError}`)
  console.log(`Esperan a Valida (TI, PPT, RC): ${r.esperanValida}`)
  console.log(`Aparte: ${r.aparte.length}${r.aparte.length ? ` (${r.aparte.join(', ')})` : ''}`)
  console.log(`Negocios con score por recalcular: ${r.negocios}`)
  if (r.detenido) console.log(`Detenido por Valida: ${r.detenido}`)
  console.log(`Con hallazgo (alto, medio o bajo): ${r.conHallazgo.length}`)
  for (const id of r.conHallazgo) console.log(`  ${id}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
