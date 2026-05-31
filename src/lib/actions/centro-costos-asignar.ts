'use server'

// ============================================================
// Motor de asignación de centro de costos
// ============================================================
//
// Implementa la cascada de 3 heurísticas decidida por Mauricio + directores:
//   1. Whitelist proveedor (gastos_recurrentes_map) → 'auto', confianza 1.0
//   2. Contexto bot WA (último intent NEGOCIO:X en <5min) → 'sugerido', confianza 0.85
//   3. Match descripción ≥80% similitud con gasto previo del mismo usuario
//      → hereda centro previo, 'sugerido', confianza 0.7
//   4. Sin señal → null (UI pregunta)
//
// NO usa categoría fiscal como heurística (rechazado por sesgo).
// NO impone umbral de monto para mixta (rechazado).
//
// Self-learning: registrarMapeoAutomatico() corre post-insert. Si 3 gastos
// manuales del mismo proveedor_match coincidieron en centro, inserta regla
// auto en gastos_recurrentes_map.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'

// gastos_recurrentes_map y columnas nuevas en gastos no están aún en database.ts
// (regenerar tras migrations 20260530000001/2). Usar un wrapper untyped para evitar
// errores de TS strict hasta que se regenere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any

export type CentroCostos =
  | 'directa_negocio'
  | 'distribuible_one'
  | 'distribuible_clarity'
  | 'mixta'

export type OrigenAsignacion = 'auto' | 'sugerido' | 'manual' | 'split'

export interface ContextoBot {
  negocioId: string
  /** ISO timestamp del último intent NEGOCIO. Si pasaron >5min, se ignora. */
  timestamp: string
}

export interface PropuestaCentroCostos {
  centro: CentroCostos | null
  origen: OrigenAsignacion | null
  confianza: number
  /** Solo si centro = directa_negocio y la heurística sugirió un negocio. */
  sugerido_negocio_id: string | null
  /** Para debugging / activity log. */
  razon: string
}

const CONTEXTO_BOT_TTL_MS = 5 * 60 * 1000 // 5 minutos
const SIMILITUD_MIN_HISTORIAL = 0.8

/**
 * Normaliza un string para comparación (lowercase, sin acentos, espacios colapsados).
 * Misma convención que se usa al guardar `proveedor_match` en gastos_recurrentes_map.
 */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacríticos
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Similitud Dice's coefficient sobre bigramas. Más simple que Levenshtein y
 * suficientemente robusto para descripciones cortas de gastos (~3-6 palabras).
 */
function similitudDice(a: string, b: string): number {
  const na = normalizar(a)
  const nb = normalizar(b)
  if (na === nb) return 1
  if (na.length < 2 || nb.length < 2) return 0

  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2))
    }
    return set
  }

  const ba = bigrams(na)
  const bb = bigrams(nb)
  let inter = 0
  for (const bi of ba) if (bb.has(bi)) inter++
  return (2 * inter) / (ba.size + bb.size)
}

/**
 * Cascada de heurísticas para proponer centro de costos.
 *
 * Retorna {centro:null} si ninguna heurística disparó — el caller decide
 * preguntar al usuario (form o bot con quick-reply).
 */
export async function proponerCentroCostos(args: {
  workspaceId: string
  descripcion: string | null | undefined
  userId: string | null | undefined
  contextoBot?: ContextoBot
}): Promise<PropuestaCentroCostos> {
  const { workspaceId, descripcion, userId, contextoBot } = args
  const desc = (descripcion ?? '').trim()
  const svc = createServiceClient() as unknown as AnyDB

  // ── Heurística 1: whitelist proveedor ────────────────────
  if (desc) {
    const descNorm = normalizar(desc)
    const { data: matches } = await svc
      .from('gastos_recurrentes_map')
      .select('centro_costos, negocio_id_default, confianza, proveedor_match')
      .eq('workspace_id', workspaceId)

    type MapRow = {
      proveedor_match: string
      centro_costos: string
      negocio_id_default: string | null
      confianza: number | null
    }
    const matchesTyped = (matches ?? []) as MapRow[]
    if (matchesTyped.length > 0) {
      // Match exacto primero (proveedor_match contenido en descNorm o viceversa)
      const exacto = matchesTyped.find(
        (m: MapRow) =>
          descNorm === m.proveedor_match ||
          descNorm.includes(m.proveedor_match) ||
          m.proveedor_match.includes(descNorm),
      )
      if (exacto) {
        return {
          centro: exacto.centro_costos as CentroCostos,
          origen: 'auto',
          confianza: Number(exacto.confianza ?? 1),
          sugerido_negocio_id: exacto.negocio_id_default ?? null,
          razon: `whitelist:${exacto.proveedor_match}`,
        }
      }
    }
  }

  // ── Heurística 2: contexto bot WA ─────────────────────────
  if (contextoBot?.negocioId && contextoBot?.timestamp) {
    const edadMs = Date.now() - new Date(contextoBot.timestamp).getTime()
    if (edadMs >= 0 && edadMs <= CONTEXTO_BOT_TTL_MS) {
      return {
        centro: 'directa_negocio',
        origen: 'sugerido',
        confianza: 0.85,
        sugerido_negocio_id: contextoBot.negocioId,
        razon: `contexto_bot:negocio_${contextoBot.negocioId}`,
      }
    }
  }

  // ── Heurística 3: match descripción con historial del usuario ──
  if (desc && userId) {
    const { data: historial } = await svc
      .from('gastos')
      .select('descripcion, centro_costos, negocio_id')
      .eq('workspace_id', workspaceId)
      .eq('created_by', userId)
      .not('centro_costos', 'is', null)
      .not('descripcion', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50) // ventana del usuario reciente

    type HistRow = {
      descripcion: string | null
      centro_costos: string | null
      negocio_id: string | null
    }
    const historialTyped = (historial ?? []) as HistRow[]
    if (historialTyped.length > 0) {
      let mejor: { gasto: HistRow; score: number } | null = null

      for (const g of historialTyped) {
        if (!g.descripcion) continue
        const s = similitudDice(desc, g.descripcion)
        if (s >= SIMILITUD_MIN_HISTORIAL && (!mejor || s > mejor.score)) {
          mejor = { gasto: g, score: s }
        }
      }

      if (mejor) {
        return {
          centro: mejor.gasto.centro_costos as CentroCostos,
          origen: 'sugerido',
          confianza: 0.7,
          sugerido_negocio_id: mejor.gasto.negocio_id ?? null,
          razon: `historial:sim_${mejor.score.toFixed(2)}`,
        }
      }
    }
  }

  // Sin señal — el caller pregunta
  return {
    centro: null,
    origen: null,
    confianza: 0,
    sugerido_negocio_id: null,
    razon: 'sin_senal',
  }
}

/**
 * Post-insert hook. Si el gasto recién creado tiene origen='manual' y el proveedor
 * (normalizado de descripcion) ya coincidió 2 veces previas con el mismo
 * centro_costos, inserta una regla auto en gastos_recurrentes_map.
 *
 * Idempotente: si ya existe regla para ese proveedor en el workspace, no hace
 * nada. Se llama con safety try/catch del caller — un fallo aquí no debe romper
 * el insert principal del gasto.
 */
export async function registrarMapeoAutomatico(gastoId: string): Promise<void> {
  const svc = createServiceClient() as unknown as AnyDB

  // 1. Cargar el gasto recién creado
  const { data: gasto } = await svc
    .from('gastos')
    .select(
      'id, workspace_id, descripcion, centro_costos, negocio_id, origen_asignacion',
    )
    .eq('id', gastoId)
    .single()

  if (
    !gasto ||
    !gasto.descripcion ||
    !gasto.centro_costos ||
    gasto.origen_asignacion !== 'manual'
  ) {
    return
  }

  const proveedorMatch = normalizar(gasto.descripcion)
  if (proveedorMatch.length < 3) return // ruido

  // 2. Si ya existe regla para este proveedor, salir
  const { data: existente } = await svc
    .from('gastos_recurrentes_map')
    .select('id')
    .eq('workspace_id', gasto.workspace_id)
    .eq('proveedor_match', proveedorMatch)
    .maybeSingle()

  if (existente) return

  // 3. Buscar gastos previos con misma descripción normalizada y mismo centro_costos
  const { data: previos } = await svc
    .from('gastos')
    .select('id, descripcion, centro_costos, origen_asignacion, negocio_id')
    .eq('workspace_id', gasto.workspace_id)
    .eq('centro_costos', gasto.centro_costos)
    .in('origen_asignacion', ['manual', 'sugerido'])
    .not('descripcion', 'is', null)
    .neq('id', gastoId)
    .limit(200)

  if (!previos) return

  type GastoPrev = { id: string; descripcion: string | null }
  const previosTyped = (previos ?? []) as GastoPrev[]
  const coincidentes = previosTyped.filter(
    (p: GastoPrev) => p.descripcion && normalizar(p.descripcion) === proveedorMatch,
  )

  // Necesitamos al menos 2 previos + el actual = 3 totales con mismo centro
  if (coincidentes.length < 2) return

  // 4. Insertar regla auto
  const negocioDefault =
    gasto.centro_costos === 'directa_negocio' ? gasto.negocio_id : null

  await svc.from('gastos_recurrentes_map').insert({
    workspace_id: gasto.workspace_id,
    proveedor_match: proveedorMatch,
    centro_costos: gasto.centro_costos,
    negocio_id_default: negocioDefault,
    confianza: 1.0,
    created_by: 'auto',
  })
}
