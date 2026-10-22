'use server'

/**
 * Acciones del módulo `funciones`. Todas con el cliente de la SESIÓN (`authenticated`): las tablas no conceden
 * escritura a nadie y cada RPC (`funcion_*`, migración 20261022170000) verifica el workspace, el rol y los candados
 * dentro de la base. Aquí solo se valida la forma y se traduce el código de error a llano. El workspace sale de la
 * sesión, nunca del navegador.
 *
 * `extraerPdfAction` NO escribe: devuelve un borrador para el formulario (§4.4 del diseño). El PDF no se guarda.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { textoDelPdf } from '@/lib/ai/texto-pdf'
import { extraerBorrador, type Borrador, type TipoBorrador } from '@/lib/funciones/extraccion-pdf'
import { modeloDocumentos } from '@/lib/funciones/extraccion-modelo'
import { inicioBogota, mensajeDeError } from '@/lib/funciones/reglas'

export type Resultado<T = undefined> = { ok: true; dato?: T } | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BYTES_MAXIMOS_PDF = 10_000_000

async function puerta(): Promise<{ ok: true; ws: string; db: SupabaseClient } | { ok: false; error: string }> {
  const { workspaceId, userId, supabase, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { ok: false, error: 'Sesión no válida. Recarga la página.' }
  if (!(await exigirModulo(REQUISITO.funciones)).ok) return { ok: false, error: MENSAJE_MODULO_NO_ACTIVO }
  return { ok: true, ws: workspaceId, db: supabase as unknown as SupabaseClient }
}

async function llamar<T>(nombre: string, args: Record<string, unknown>, rutas: string[]): Promise<Resultado<T>> {
  const p = await puerta()
  if (!p.ok) return p
  const { data, error } = await p.db.rpc(nombre, args)
  if (error) return { ok: false, error: mensajeDeError(error) }
  for (const r of rutas) revalidatePath(r)
  return { ok: true, dato: data as T }
}

// ── Reservas ─────────────────────────────────────────────────────────────────

export async function cancelarReservaAction(funcionId: string, reservaId: string): Promise<Resultado> {
  if (!UUID.test(reservaId)) return { ok: false, error: 'La reserva no existe.' }
  const r = await llamar('funcion_cancelar_reserva', { p_reserva_id: reservaId }, [`/funciones/${funcionId}`, '/funciones/dia'])
  return r.ok ? { ok: true } : r
}

/** El equipo verifica a mano un pago (transferencia, Anexo 2.3). `aprobado` solo lo marca la pasarela. */
export async function confirmarPagoManualAction(funcionId: string, reservaId: string): Promise<Resultado> {
  if (!UUID.test(reservaId)) return { ok: false, error: 'La reserva no existe.' }
  const r = await llamar('funcion_confirmar_pago', { p_reserva_id: reservaId, p_pago_estado: 'verificado_manual' }, [`/funciones/${funcionId}`, '/funciones/dia'])
  return r.ok ? { ok: true } : r
}

/** Una reserva que toma el equipo (teléfono, mostrador): origen `equipo`, con los mismos candados de cupo. */
export async function apartarEquipoAction(
  funcionId: string,
  datos: { personas: number; nombre: string; telefono: string; solicitud_cliente: string; clave: string },
): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  if (!UUID.test(funcionId)) return { ok: false, error: 'La función no existe.' }
  if (!Number.isInteger(datos.personas) || datos.personas < 1) return { ok: false, error: 'Escribe cuántas personas.' }
  if (!datos.nombre.trim()) return { ok: false, error: 'Escribe el nombre de quien reserva.' }
  const { error } = await p.db.rpc('funcion_apartar', {
    p_workspace_id: p.ws,
    p_funcion_id: funcionId,
    p_personas: datos.personas,
    p_datos: { canal: 'equipo', nombre: datos.nombre, telefono: datos.telefono || null, solicitud_cliente: datos.solicitud_cliente || null },
    p_clave_idempotencia: datos.clave,
    p_origen: 'equipo',
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  revalidatePath(`/funciones/${funcionId}`)
  revalidatePath('/funciones/dia')
  return { ok: true }
}

// ── Formulario de alta (F1): la única puerta ─────────────────────────────────

export async function guardarExperienciaAction(e: { id: string | null; nombre: string; minutos_apartado: number | null }): Promise<Resultado<string>> {
  const p = await puerta()
  if (!p.ok) return p
  if (e.id !== null && !UUID.test(e.id)) return { ok: false, error: 'La experiencia no existe.' }
  if (e.minutos_apartado !== null && (!Number.isInteger(e.minutos_apartado) || e.minutos_apartado < 1)) {
    return { ok: false, error: 'Los minutos de apartado son un número entero, o se dejan vacíos.' }
  }
  return llamar<string>(
    'funcion_guardar_experiencia',
    { p_workspace_id: p.ws, p_experiencia_id: e.id, p_nombre: e.nombre, p_minutos_apartado: e.minutos_apartado, p_activa: true },
    ['/funciones', '/funciones/nueva'],
  )
}

export async function crearFuncionesAction(f: {
  experiencia_id: string
  cupo_total: number
  estado: 'abierta' | 'cerrada'
  cierre_minutos_antes: number | null
  inicios: Array<{ fecha: string; hora: string }>
}): Promise<Resultado<string[]>> {
  const p = await puerta()
  if (!p.ok) return p
  if (!UUID.test(f.experiencia_id)) return { ok: false, error: 'Elige la experiencia.' }
  const inicios = f.inicios.map((i) => inicioBogota(i.fecha, i.hora))
  if (inicios.length === 0 || inicios.some((i) => i === null)) return { ok: false, error: 'Cada función necesita fecha y hora.' }
  return llamar<string[]>(
    'funcion_crear_funciones',
    {
      p_workspace_id: p.ws,
      p_experiencia_id: f.experiencia_id,
      p_cupo_total: f.cupo_total,
      p_estado: f.estado,
      p_cierre_minutos_antes: f.cierre_minutos_antes,
      p_inicios: inicios,
    },
    ['/funciones', '/funciones/dia'],
  )
}

export async function editarFuncionAction(f: { id: string; cupo_total: number; estado: 'abierta' | 'cerrada' | 'cancelada'; cierra_venta_at: string | null }): Promise<Resultado> {
  if (!UUID.test(f.id)) return { ok: false, error: 'La función no existe.' }
  const r = await llamar('funcion_editar_funcion', { p_funcion_id: f.id, p_cupo_total: f.cupo_total, p_estado: f.estado, p_cierra_venta_at: f.cierra_venta_at }, [
    `/funciones/${f.id}`,
    '/funciones',
    '/funciones/dia',
  ])
  return r.ok ? { ok: true } : r
}

// ── PDF → borrador (no escribe) ──────────────────────────────────────────────

/**
 * Lee el PDF de la programación de funciones y devuelve el BORRADOR del formulario. No toca ninguna tabla ni guarda el PDF (ONE no guarda hoy
 * adjuntos de este tipo, así que se descarta tras extraer). Lo que no se pudo leer llega vacío y marcado.
 */
export async function extraerPdfAction(form: FormData): Promise<Resultado<Borrador>> {
  const p = await puerta()
  if (!p.ok) return p
  const tipo = form.get('tipo')
  const archivo = form.get('pdf')
  if (tipo !== 'funciones') return { ok: false, error: 'Tipo de PDF desconocido.' }
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Elige un PDF.' }
  if (archivo.size > BYTES_MAXIMOS_PDF) return { ok: false, error: 'El PDF pesa más de 10 MB.' }
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return { ok: false, error: 'El archivo no es un PDF.' }
  const borrador = await extraerBorrador({
    pdf: bytes,
    tipo: tipo as TipoBorrador,
    modelo: modeloDocumentos(process.env.GEMINI_API_KEY ?? ''),
    leerTexto: textoDelPdf,
  })
  return { ok: true, dato: borrador }
}
