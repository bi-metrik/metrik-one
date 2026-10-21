'use server'

/**
 * Configuración de las obras (solo con `modules.obras`): rubros de obra (C3) y colaboradores de
 * WhatsApp con su tipo y el valor de su jornada (C5, C6). Ven dueño y administrador (las
 * secciones de Configuración); escriben los mismos.
 */
import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { createServiceClient } from '@/lib/supabase/server'
import { faltaMigracionObras, MENSAJE_SIN_MIGRACION_OBRAS, puedeEditarObras } from '@/lib/obras/modulo'
import { COLUMNAS_RUBRO, nombreRepetido, validarRubro, type RubroObra } from '@/lib/obras/rubros'
import {
  esTipo,
  validarColaborador,
  validarValorJornada,
  type Colaborador,
  type TipoColaborador,
  type ValorJornada,
} from '@/lib/obras/colaboradores'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function contexto(): Promise<{ db: Cliente; workspaceId: string; userId: string | null } | { error: string }> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  if (!puedeEditarObras(role)) return { error: 'Solo el dueño o un administrador configuran las obras.' }
  if (!(await exigirModulo(REQUISITO.obras)).ok) return { error: MENSAJE_MODULO_NO_ACTIVO }
  return { db: supabase as Cliente, workspaceId, userId: (userId as string | null) ?? null }
}

const mensaje = (e: { code?: string; message?: string } | null, porDefecto: string) =>
  faltaMigracionObras(e) ? MENSAJE_SIN_MIGRACION_OBRAS : porDefecto

function refrescar() {
  revalidatePath('/mi-negocio')
}

// ── C3: rubros de obra ──────────────────────────────────────────────────────────

export type LecturaRubros = Resultado<{ rubros: (RubroObra & { gastos: number })[] }>

export async function leerRubrosObra(): Promise<LecturaRubros> {
  const ctx = await contexto()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { data, error } = await ctx.db.from('obra_rubros').select(COLUMNAS_RUBRO).eq('workspace_id', ctx.workspaceId).order('orden').order('nombre')
  if (error) return { ok: false, error: mensaje(error, 'No se pudieron leer los rubros.') }
  const rubros = (data ?? []) as RubroObra[]
  // Cuántos gastos tiene cada rubro: decide si se puede borrar o solo desactivar.
  const conteos = await Promise.all(
    rubros.map((r) =>
      ctx.db.from('gastos').select('id', { count: 'exact', head: true }).eq('workspace_id', ctx.workspaceId).eq('obra_rubro_id', r.id),
    ),
  )
  return { ok: true, rubros: rubros.map((r, i) => ({ ...r, gastos: conteos[i]?.count ?? 0 })) }
}

export async function guardarRubroObra(id: string | null, entrada: unknown): Promise<Resultado> {
  const ctx = await contexto()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const v = validarRubro(entrada)
  if (!v.ok) return v
  if (id !== null && !UUID.test(id)) return { ok: false, error: 'Ese rubro ya no está. Recarga.' }
  const { data: existentes, error: e1 } = await ctx.db.from('obra_rubros').select('id, nombre').eq('workspace_id', ctx.workspaceId)
  if (e1) return { ok: false, error: mensaje(e1, 'No se pudieron leer los rubros.') }
  if (nombreRepetido(v.datos.nombre, (existentes ?? []) as { id: string; nombre: string }[], id)) {
    return { ok: false, error: `Ya hay un rubro llamado «${v.datos.nombre}».` }
  }
  const ahora = new Date().toISOString()
  const { error } = id
    ? await ctx.db.from('obra_rubros').update({ ...v.datos, updated_at: ahora }).eq('workspace_id', ctx.workspaceId).eq('id', id)
    : await ctx.db.from('obra_rubros').insert({ ...v.datos, workspace_id: ctx.workspaceId })
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Ya hay un rubro llamado «${v.datos.nombre}».` }
    return { ok: false, error: mensaje(error, 'No se pudo guardar el rubro.') }
  }
  refrescar()
  return { ok: true }
}

/** Un rubro sin gastos se borra; uno con gastos solo se desactiva (el cierre de las obras viejas no cambia). */
export async function eliminarRubroObra(id: string): Promise<Resultado> {
  const ctx = await contexto()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(id)) return { ok: true }
  const { count, error } = await ctx.db
    .from('gastos')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId)
    .eq('obra_rubro_id', id)
  if (error) return { ok: false, error: mensaje(error, 'No se pudieron revisar los gastos del rubro.') }
  if ((count ?? 0) > 0) return { ok: false, error: 'Ese rubro tiene gastos: desactívalo en vez de borrarlo.' }
  const { error: e2 } = await ctx.db.from('obra_rubros').delete().eq('workspace_id', ctx.workspaceId).eq('id', id)
  if (e2) {
    // La llave foránea de `gastos` es `on delete restrict`: un gasto que entró entre la revisión y el borrado.
    if (e2.code === '23503') return { ok: false, error: 'Ese rubro tiene gastos: desactívalo en vez de borrarlo.' }
    return { ok: false, error: 'No se pudo borrar el rubro.' }
  }
  refrescar()
  return { ok: true }
}

// ── C5, C6: colaboradores de WhatsApp ───────────────────────────────────────────

export type LecturaColaboradores = Resultado<{ colaboradores: Colaborador[] }>

export async function leerColaboradores(): Promise<LecturaColaboradores> {
  const ctx = await contexto()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const [cols, valores] = await Promise.all([
    ctx.db.from('wa_collaborators').select('id, name, phone, is_active, tipo, consent_accepted_at').eq('workspace_id', ctx.workspaceId).order('name'),
    ctx.db
      .from('colaborador_jornada_valores')
      .select('id, collaborator_id, valor, vigente_desde')
      .eq('workspace_id', ctx.workspaceId)
      .order('vigente_desde', { ascending: false }),
  ])
  if (cols.error) return { ok: false, error: mensaje(cols.error, 'No se pudieron leer los colaboradores.') }
  if (valores.error) return { ok: false, error: mensaje(valores.error, 'No se pudo leer el valor de las jornadas.') }
  const porColaborador = new Map<string, ValorJornada[]>()
  for (const v of (valores.data ?? []) as { id: string; collaborator_id: string; valor: number; vigente_desde: string }[]) {
    porColaborador.set(v.collaborator_id, [...(porColaborador.get(v.collaborator_id) ?? []), { id: v.id, valor: Number(v.valor), vigente_desde: v.vigente_desde }])
  }
  return {
    ok: true,
    colaboradores: ((cols.data ?? []) as Array<Omit<Colaborador, 'valores' | 'tipo'> & { tipo: string | null; is_active: boolean | null }>).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      is_active: c.is_active !== false,
      tipo: (esTipo(c.tipo) ? c.tipo : 'equipo') as TipoColaborador,
      consent_accepted_at: c.consent_accepted_at,
      valores: porColaborador.get(c.id) ?? [],
    })),
  }
}

/**
 * Crea o corrige un colaborador. El celular se guarda como lo busca el bot (solo dígitos, con
 * indicativo). Un número que ya está en ESTE espacio o en otro no se repite: el bot tomaría uno
 * sin preguntar (§6.3-f del diseño).
 */
export async function guardarColaborador(id: string | null, entrada: unknown): Promise<Resultado> {
  const ctx = await contexto()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const v = validarColaborador(entrada)
  if (!v.ok) return v
  if (id !== null && !UUID.test(id)) return { ok: false, error: 'Ese colaborador ya no está. Recarga.' }

  // El número en cualquier espacio, con o sin «+» (como lo busca el bot). Con service: el RLS no
  // deja ver los demás espacios, y el choque que importa es justamente ese.
  const svc = createServiceClient() as Cliente
  const { data: mismos, error: e1 } = await svc
    .from('wa_collaborators')
    .select('id, workspace_id')
    .or(`phone.eq.${v.datos.phone},phone.eq.+${v.datos.phone}`)
    .eq('is_active', true)
    .limit(5)
  if (e1) return { ok: false, error: 'No se pudo revisar el número.' }
  const otros = ((mismos ?? []) as { id: string; workspace_id: string }[]).filter((c) => c.id !== id)
  if (otros.some((c) => c.workspace_id === ctx.workspaceId)) return { ok: false, error: 'Ese número ya es de otro colaborador de este espacio.' }
  if (otros.length > 0) return { ok: false, error: 'Ese número ya está registrado en otro espacio de ONE. Escríbenos para revisarlo.' }

  const { error } = id
    ? await ctx.db.from('wa_collaborators').update(v.datos).eq('workspace_id', ctx.workspaceId).eq('id', id)
    : await ctx.db.from('wa_collaborators').insert({ ...v.datos, workspace_id: ctx.workspaceId, is_active: true })
  if (error) return { ok: false, error: mensaje(error, 'No se pudo guardar el colaborador.') }
  refrescar()
  return { ok: true }
}

export async function cambiarTipoColaborador(id: string, tipo: unknown): Promise<Resultado> {
  const ctx = await contexto()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(id) || !esTipo(tipo)) return { ok: false, error: 'No se pudo cambiar el tipo.' }
  const { error } = await ctx.db.from('wa_collaborators').update({ tipo }).eq('workspace_id', ctx.workspaceId).eq('id', id)
  if (error) return { ok: false, error: mensaje(error, 'No se pudo cambiar el tipo.') }
  refrescar()
  return { ok: true }
}

/** Activar o desactivar: un colaborador no se borra (sus llegadas lo citan). */
export async function cambiarActivoColaborador(id: string, activo: boolean): Promise<Resultado> {
  const ctx = await contexto()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(id)) return { ok: false, error: 'Ese colaborador ya no está. Recarga.' }
  if (activo) {
    const { data: c } = await ctx.db.from('wa_collaborators').select('phone').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
    if (c?.phone) {
      const svc = createServiceClient() as Cliente
      const { data: mismos } = await svc
        .from('wa_collaborators')
        .select('id')
        .or(`phone.eq.${String(c.phone).replace(/\D/g, '')},phone.eq.+${String(c.phone).replace(/\D/g, '')}`)
        .eq('is_active', true)
        .neq('id', id)
        .limit(1)
      if ((mismos ?? []).length > 0) return { ok: false, error: 'Ese número ya está activo en otro colaborador.' }
    }
  }
  const { error } = await ctx.db.from('wa_collaborators').update({ is_active: activo }).eq('workspace_id', ctx.workspaceId).eq('id', id)
  if (error) return { ok: false, error: 'No se pudo cambiar el colaborador.' }
  refrescar()
  return { ok: true }
}

export async function agregarValorJornada(collaboratorId: string, entrada: unknown): Promise<Resultado> {
  const ctx = await contexto()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(collaboratorId)) return { ok: false, error: 'Ese colaborador ya no está. Recarga.' }
  const v = validarValorJornada(entrada)
  if (!v.ok) return v
  const { data: c } = await ctx.db.from('wa_collaborators').select('id').eq('workspace_id', ctx.workspaceId).eq('id', collaboratorId).maybeSingle()
  if (!c) return { ok: false, error: 'Ese colaborador ya no está. Recarga.' }
  const { error } = await ctx.db
    .from('colaborador_jornada_valores')
    .insert({ ...v.datos, collaborator_id: collaboratorId, workspace_id: ctx.workspaceId, created_by: ctx.userId })
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Ya hay un valor que vale desde ese día. Bórralo antes de poner otro.' }
    return { ok: false, error: mensaje(error, 'No se pudo guardar el valor de la jornada.') }
  }
  refrescar()
  return { ok: true }
}

/**
 * Quita un valor del historial. Las llegadas ya guardadas no cambian (copiaron su valor al
 * guardarse); solo las que se registren o corrijan de aquí en adelante usan el historial nuevo.
 */
export async function borrarValorJornada(id: string): Promise<Resultado> {
  const ctx = await contexto()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(id)) return { ok: true }
  const { error } = await ctx.db.from('colaborador_jornada_valores').delete().eq('workspace_id', ctx.workspaceId).eq('id', id)
  if (error) return { ok: false, error: 'No se pudo quitar el valor.' }
  refrescar()
  return { ok: true }
}
