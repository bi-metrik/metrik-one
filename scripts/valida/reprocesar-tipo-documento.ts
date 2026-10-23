/**
 * Vuelve a consultar en Valida las filas de la carga masiva que quedaron en error por el tipo de
 * documento, y pone al día la MISMA fila de `valida_consultas` (y su fila de lote, si la hay).
 *
 * Por qué: hasta el 2026-10-23 el lote mandaba el tipo tal cual venía en el XLSX («CEDULA», «PP»,
 * «TI»…). Valida acepta un enum cerrado y respondía 400 sin cobrar; la fila quedaba en «Error». El
 * error fue de ONE, así que el reproceso NO debe cobrarle al cliente.
 *
 * ⚠️ HOY NO SE PUEDE CORRER CON --aplicar. Valida marca TODA consulta de `POST /api/v1/validate` como
 * facturable (`billable: true` fijo en app/api/v1/validate/route.ts), y los triggers de la bolsa
 * (0032) y del periodo (0028) la cuentan al insertarla. Además, cruzar el 80 % o el 95 % de la bolsa
 * dispara avisos hacia ONE. No hay forma de pedir una consulta sin cobro desde la API sin cambiar
 * Valida. Por eso `--aplicar` se niega mientras `VALIDA_PERMITE_SIN_COBRO` sea false. El ensayo sí
 * corre. Ver el PR que trae este script.
 *
 * Qué filas: severidad `error` y un `documento_tipo` que Valida no acepta, en el espacio dado.
 *   - Tipo reconocible (CEDULA, CÉDULA, PP, PA, PASAPORTE…): se normaliza con `leerTipoDocumento`,
 *     la misma función del lote.
 *   - TI, PPT, RC: se mandan tal cual (Valida los acepta desde metrik-valida#70).
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
 *   npx tsx scripts/valida/reprocesar-tipo-documento.ts --aplicar       # consulta y escribe
 *   ... --workspace <uuid>                                              # otro espacio (por defecto, el de AFI)
 *
 * Requiere la migración 20261023180000_valida_consultas_reproceso.sql (columnas de constancia).
 */
import '../_load-env'
import { createClient } from '@supabase/supabase-js'
import { leerSecretosWorkspace, secretoConRespaldo } from '../../src/lib/secretos/workspace'
import {
  TIPOS_ACEPTADOS_ANTES,
  ejecutarReproceso,
  ensayarReproceso,
  moverConteo,
  type ConsultaEnError,
  type RespuestaReproceso,
} from '../../src/lib/valida/reproceso-tipo-documento'
import type { ValidaConsultaInput, ValidaResultado } from '../../src/lib/actions/valida-consultas'

/**
 * ¿Valida ofrece una consulta que no se cobre? Hoy no. Cambiarlo a true exige, ANTES, el cambio en
 * Valida (y que `llamar` lo pida). No basta con voltear la constante.
 */
const VALIDA_PERMITE_SIN_COBRO = false

const WORKSPACE_AFI = '77ddc3f2-83aa-4a29-aa7f-18a6f6196c5b'
const VALIDA_API_BASE = process.env.VALIDA_API_BASE || 'https://api.valida.metrikone.co'
const TIMEOUT_MS = 30_000

const args = process.argv.slice(2)
const APLICAR = args.includes('--aplicar')
const iWs = args.indexOf('--workspace')
const WORKSPACE = iWs >= 0 ? args[iWs + 1] : WORKSPACE_AFI
if (!WORKSPACE || !/^[0-9a-f-]{36}$/.test(WORKSPACE)) {
  console.error('Uso: npx tsx scripts/valida/reprocesar-tipo-documento.ts [--workspace <uuid>] [--aplicar]')
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function leerConsultas(): Promise<ConsultaEnError[]> {
  const out: ConsultaEnError[] = []
  const lista = `(${TIPOS_ACEPTADOS_ANTES.join(',')})`
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

function llamarCon(llave: string) {
  return async (input: ValidaConsultaInput, clave: string): Promise<RespuestaReproceso> => {
    try {
      const res = await fetch(`${VALIDA_API_BASE}/api/v1/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llave}`, 'Idempotency-Key': clave },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}`, status: res.status }
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

async function main() {
  const consultas = await leerConsultas()
  const ensayo = ensayarReproceso(consultas)

  if (!APLICAR) {
    console.log(`Ensayo (no escribe ni consulta). Espacio ${WORKSPACE}.`)
    console.log(`Filas en error con un tipo que Valida no acepta: ${consultas.length}`)
    console.log(`  se reprocesarían: ${ensayo.reprocesar.length}`)
    console.log(`  aparte (tipo no deducible o sin número): ${ensayo.aparte.length}`)
    console.log(`Columnas de constancia en la base: ${(await columnasDeConstancia()) ? 'sí' : 'NO (falta la migración)'}`)
    console.log('ids a reprocesar:')
    for (const id of ensayo.reprocesar) console.log(`  ${id}`)
    console.log('ids aparte:')
    for (const id of ensayo.aparte) console.log(`  ${id}`)
    return
  }

  if (!VALIDA_PERMITE_SIN_COBRO) {
    console.error(
      'No se aplica: Valida cobra toda consulta de /api/v1/validate (billable fijo en true) y no ofrece ' +
        'una sin cobro. Reprocesar así le gastaría al cliente la bolsa y el consumo del periodo, y podría ' +
        'dispararle avisos de umbral. Hace falta el cambio en Valida antes.',
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

  const r = await ejecutarReproceso(consultas, {
    llamar: llamarCon(llave),
    actualizarConsulta,
    actualizarFilaLote,
  })
  console.log(`Reprocesadas: ${r.reprocesadas}`)
  console.log(`Siguen en error: ${r.siguenEnError}`)
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
