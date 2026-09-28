import 'server-only'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { registrarPagoEnNegocio } from '@/lib/actions/conciliacion-actions'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { cumpleRequisitoModulo, REQUISITO } from '@/lib/modulos/requisito'
import { crearNegocioEnWorkspace, sincronizarResponsablePrincipal, type ContextoCrearNegocio } from '@/lib/negocios/crear-negocio'
import { asignarResponsable as asignarResponsableConRol } from '@/lib/negocios/responsable-rol'
import { createServiceClient } from '@/lib/supabase/server'
import {
  agregarResponsable,
  cambiarEtapaNegocioConGate,
  completarNegocio,
  crearNegocio,
} from '@/app/(app)/negocios/negocio-v2-actions'
import { PASOS_VENTA, type PasoVenta } from './reglas'
import type { PuertoNegocios } from './tipos'

/**
 * Los negocios de ONE vistos desde Ferretería, por las MISMAS acciones que usa la pantalla de
 * negocios. No hay una segunda forma de crear, mover ni cerrar un negocio: una venta deja
 * código (trigger de la base), historial, carpeta si el espacio tiene Drive, y su cobro por la
 * vía única de pagos, igual que cualquier negocio.
 *
 * Esas acciones leen la sesión (`getWorkspace`), así que valen para la persona que está
 * registrando la venta y con sus permisos. Ferretería ya comprobó módulo y rol antes de llegar
 * aquí; las acciones de negocios vuelven a comprobar los suyos (módulo Clarity, área, etapa).
 *
 * La línea y sus etapas se buscan por marca (`config_extra.modulo = 'ferreteria'` y
 * `config_extra.ferreteria_paso`), no por nombre ni por id fijo: los crea la migración
 * `20260925120000_ferreteria_ventas_negocio.sql` y el nombre se puede editar.
 */

/** Marketplace es de Facebook: el origen del catálogo que corresponde es Meta. */
const ORIGEN_VENTA = 'meta'

/** Tope de `activity_log.contenido` (CHECK de la base): más largo, el insert se cae entero. */
const TOPE_HISTORIAL = 280

type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

interface LineaFerreteria {
  lineaId: string
  etapas: Partial<Record<PasoVenta, string>>
  pasoPorEtapa: Map<string, PasoVenta>
}

async function lineaFerreteria(db: Db, ws: string): Promise<LineaFerreteria | null> {
  const { data: linea, error } = await db
    .from('lineas_negocio')
    .select('id')
    .eq('workspace_id', ws)
    .eq('config_extra->>modulo', 'ferreteria')
    .eq('is_active', true)
    .maybeSingle()
  if (error || !linea) return null
  const lineaId = (linea as { id: string }).id
  const { data: etapas, error: errEtapas } = await db
    .from('etapas_negocio')
    .select('id, config_extra')
    .eq('linea_id', lineaId)
  if (errEtapas) return null
  const out: LineaFerreteria = { lineaId, etapas: {}, pasoPorEtapa: new Map() }
  for (const e of (etapas ?? []) as { id: string; config_extra: Record<string, unknown> | null }[]) {
    const paso = e.config_extra?.ferreteria_paso
    if (typeof paso === 'string' && (PASOS_VENTA as readonly string[]).includes(paso)) {
      out.etapas[paso as PasoVenta] = e.id
      out.pasoPorEtapa.set(e.id, paso as PasoVenta)
    }
  }
  return out
}

async function fijarPrecioAprobado(db: Db, ws: string, negocioId: string, precio: number): Promise<string | null> {
  const { error: err } = await db.from('negocios').update({ precio_aprobado: precio }).eq('id', negocioId).eq('workspace_id', ws)
  return err ? (err as { message: string }).message : null
}

async function estadoNegocio(
  db: Db,
  ws: string,
  linea: LineaFerreteria,
  negocioId: string,
): Promise<{ paso: PasoVenta | null; abierto: boolean } | null> {
  const { data, error: err } = await db
    .from('negocios')
    .select('estado, etapa_actual_id')
    .eq('id', negocioId)
    .eq('workspace_id', ws)
    .maybeSingle()
  if (err || !data) return null
  const n = data as { estado: string | null; etapa_actual_id: string | null }
  return {
    paso: n.etapa_actual_id ? (linea.pasoPorEtapa.get(n.etapa_actual_id) ?? null) : null,
    abierto: n.estado === 'abierto',
  }
}

/** El staff dueño más antiguo del espacio: a quién se asigna una venta que no registró nadie del equipo. */
async function duenoDelEspacio(db: Db, ws: string): Promise<string | null> {
  const { data } = await db
    .from('staff')
    .select('id')
    .eq('workspace_id', ws)
    .eq('rol_plataforma', 'dueno')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

function recortarHistorial(texto: string): string {
  return texto.length > TOPE_HISTORIAL ? `${texto.slice(0, TOPE_HISTORIAL - 1)}…` : texto
}

export async function puertoNegocios(): Promise<PuertoNegocios | { error: string }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'Sesión no válida.' }
  const db = supabase as unknown as Db
  const linea = await lineaFerreteria(db, workspaceId)
  if (!linea || !linea.etapas.vendido || !linea.etapas.entregado || !linea.etapas.pagado) {
    return { error: 'Este espacio no tiene la línea Ferretería configurada en ONE.' }
  }

  return {
    async crear({ nombre, precio, compradorNombre, compradorTelefono }) {
      const r = await crearNegocio({
        nombre,
        linea_id: linea.lineaId,
        precio_estimado: precio,
        contacto_nombre: compradorNombre ?? undefined,
        contacto_telefono: compradorTelefono ?? undefined,
        origen: ORIGEN_VENTA,
        // Un comprador que repite es normal en una ferretería: no se frena por "ya tiene
        // negocios". Sin esto `crearNegocio` se detiene y devuelve los duplicados.
        confirmar_duplicado: true,
      })
      if (r.error || !r.negocio_id) return { ok: false, error: r.error ?? 'No se pudo crear el negocio.' }
      return { ok: true, negocioId: r.negocio_id }
    },

    fijarPrecioAprobado(negocioId, precio) {
      return fijarPrecioAprobado(db, workspaceId, negocioId, precio)
    },

    async registrarPago(negocioId, pago) {
      const r = await registrarPagoEnNegocio(supabase, workspaceId, staffId ?? null, {
        negocio_id: negocioId,
        fuente: 'otra',
        fuente_nombre: 'Marketplace',
        referencia: pago.referencia,
        monto: pago.monto,
        fecha: pago.fecha,
        tipo_cobro: 'pago',
      })
      return r.success ? null : r.error
    },

    estado(negocioId) {
      return estadoNegocio(db, workspaceId, linea, negocioId)
    },

    async moverA(negocioId, paso) {
      const etapaId = linea.etapas[paso]
      if (!etapaId) return `La línea Ferretería no tiene la etapa ${paso}.`
      // `confirmado`: la etapa destino no pide confirmación (no declara `confirmar_al_avanzar`),
      // pero si algún día la pide, quien registra en Ferretería ya decidió el paso.
      const r = await cambiarEtapaNegocioConGate(negocioId, etapaId, undefined, true)
      if (!r.error) return null
      if (r.error === 'gate_bloqueado' && r.bloquesPendientes?.length) {
        return `Falta completar: ${r.bloquesPendientes.map((b) => b.nombre).join(', ')}`
      }
      return r.error
    },

    async completar(negocioId) {
      const r = await completarNegocio(negocioId)
      return r.error
    },

    async asignarResponsable(negocioId) {
      // Quien registra, si es del equipo; si no (el soporte de MeTRIK entra sin staff propio),
      // el dueño del espacio. Sin responsable, el aviso diario de "negocio sin responsable" se
      // dispararía por cada venta abierta.
      const staffResponsable = staffId ?? (await duenoDelEspacio(db, workspaceId))
      if (!staffResponsable) return 'No hay a quién asignarlo en el equipo.'
      const r = await agregarResponsable(negocioId, staffResponsable)
      return r.error
    },

    async anotar(negocioId, texto) {
      // `activity_log.autor_id` es staff.id: sin staff propio no se inventa un autor.
      if (!staffId) return
      const contenido = recortarHistorial(texto)
      await registrarActividad(
        supabase,
        {
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: negocioId,
          tipo: 'comentario',
          autor_id: staffId,
          contenido,
        },
        'ferreteria.ventas',
      )
    },
  }
}

/**
 * Los mismos negocios, SIN sesión: los usa el webhook de Wompi para registrar una venta que pagó
 * un comprador, cuando no hay nadie de Dimpro frente a la pantalla. Todo con el cliente de
 * servicio y acotado al espacio que se le pasa (el del comercio de Wompi que firmó el evento).
 *
 * Las mismas vías que el puerto con sesión, en su forma sin sesión:
 *   - crear: `crearNegocioEnWorkspace`, el cuerpo de `crearNegocio` (contacto sin duplicar, etapa
 *     de entrada, carpeta de Drive, bloques). Antes se comprueba lo que la acción comprobaba con la
 *     sesión: que el espacio tenga Clarity (y Ferretería) encendidos.
 *   - registrarPago: `registrarPagoEnNegocio`, la vía única de pagos, sin staff (autor null).
 *   - asignarResponsable: el helper de roles que usan los caminos sin pantalla, al dueño del espacio.
 *   - anotar: una línea `sistema` sin autor (así anotan los webhooks de pago).
 *
 * Mover de etapa y cerrar NO se ofrecen sin sesión: la entrega la marca una persona en Ferretería,
 * y una venta anticipada que nace no necesita ninguno de los dos.
 */
export async function puertoNegociosSistema(workspaceId: string): Promise<PuertoNegocios | { error: string }> {
  const svc = createServiceClient()
  const db = svc as unknown as Db
  const { data: ws, error: errWs } = await db.from('workspaces').select('modules').eq('id', workspaceId).maybeSingle()
  if (errWs || !ws) return { error: 'No se pudo leer el espacio.' }
  const gate = {
    modules: ((ws as { modules?: Record<string, boolean> | null }).modules ?? null),
    platformAdmin: false,
    modoVitrina: false,
  }
  if (!cumpleRequisitoModulo(REQUISITO.clarity, gate) || !cumpleRequisitoModulo(REQUISITO.ferreteria, gate)) {
    return { error: 'Este espacio no tiene Clarity y Ferretería encendidos.' }
  }
  const linea = await lineaFerreteria(db, workspaceId)
  if (!linea || !linea.etapas.vendido || !linea.etapas.entregado || !linea.etapas.pagado) {
    return { error: 'Este espacio no tiene la línea Ferretería configurada en ONE.' }
  }
  const sinSesion = 'Solo se hace desde ONE, con sesión.'

  return {
    async crear({ nombre, precio, compradorNombre, compradorTelefono }) {
      const r = await crearNegocioEnWorkspace(
        { supabase: svc as unknown as ContextoCrearNegocio['supabase'], workspaceId, userId: null, role: null, staffId: null },
        {
          nombre,
          linea_id: linea.lineaId,
          precio_estimado: precio,
          contacto_nombre: compradorNombre ?? undefined,
          contacto_telefono: compradorTelefono ?? undefined,
          origen: ORIGEN_VENTA,
          confirmar_duplicado: true,
        },
      )
      if (r.error || !r.negocio_id) return { ok: false, error: r.error ?? 'No se pudo crear el negocio.' }
      return { ok: true, negocioId: r.negocio_id }
    },

    fijarPrecioAprobado(negocioId, precio) {
      return fijarPrecioAprobado(db, workspaceId, negocioId, precio)
    },

    async registrarPago(negocioId, pago) {
      const r = await registrarPagoEnNegocio(svc, workspaceId, null, {
        negocio_id: negocioId,
        fuente: 'otra',
        fuente_nombre: 'Wompi',
        referencia: pago.referencia,
        monto: pago.monto,
        fecha: pago.fecha,
        tipo_cobro: 'pago',
      })
      return r.success ? null : r.error
    },

    estado(negocioId) {
      return estadoNegocio(db, workspaceId, linea, negocioId)
    },

    async moverA() {
      return sinSesion
    },

    async completar() {
      return sinSesion
    },

    async asignarResponsable(negocioId) {
      const dueno = await duenoDelEspacio(db, workspaceId)
      if (!dueno) return 'No hay a quién asignarlo en el equipo.'
      const r = await asignarResponsableConRol(svc, { negocioId, staffId: dueno, assignedBy: null })
      if (r.error) return r.error
      await sincronizarResponsablePrincipal(svc, negocioId, workspaceId)
      return null
    },

    async anotar(negocioId, texto) {
      await registrarActividad(
        svc,
        {
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: negocioId,
          tipo: 'sistema',
          autor_id: null,
          contenido: recortarHistorial(texto),
        },
        'ferreteria.wompi',
      )
    },
  }
}
