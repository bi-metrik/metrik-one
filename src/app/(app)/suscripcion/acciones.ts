'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { leerEquipo } from '@/lib/seccion-suscripcion/carga-servidor'
import { contextoSuscripcion } from '@/lib/seccion-suscripcion/contexto-servidor'
import { comprarLicencia, cotizarLicencia, liberarLicencia } from '@/lib/seccion-suscripcion/licencias-servidor'
import { fechaConAnio } from '@/lib/seccion-suscripcion/estado'
import { eventoDelNavegador, origenCta } from '@/lib/seccion-suscripcion/sugerencias'
import {
  descartarSugerencia,
  pedirContactoSustenta,
  registrarEventoSugerencia,
} from '@/lib/seccion-suscripcion/sustenta-servidor'
import {
  MENSAJE_INVITACION,
  esRolAsignable,
  licenciaAdicionalLiberable,
  validarInvitacion,
} from '@/lib/usuarios-espacio/reglas'
import { cambiarRolUsuario, invitarUsuario, reenviarInvitacion, retirarUsuario } from '@/lib/usuarios-espacio/servidor'

/**
 * Las acciones de `/suscripcion`. Cada una vuelve a resolver el contexto en el servidor: una acción
 * exportada es un endpoint alcanzable con cualquier argumento, así que quién puede no viaja del
 * navegador. Puede SOLO la persona designada del contrato del espacio que lo paga, en su propia
 * sesión (`puedeVerSuscripcion` + `puedeOperarSuscripcion`): un dueño o un administrador que no sea
 * la persona designada recibe «sin acceso», y un platform admin en «Ver como» solo lee.
 *
 * Solo exporta funciones async: es un archivo `'use server'`.
 */

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const SIN_PERMISO = 'No tienes acceso a la suscripción de este espacio.'
const NO_DISPONIBLE = 'No se pudo leer tu suscripción. Intenta de nuevo en un momento.'
const SOLO_LECTURA = 'Estás viendo la suscripción como otra persona: es solo lectura.'

type CtxOk = Extract<Awaited<ReturnType<typeof contextoSuscripcion>>, { tipo: 'ok' }>

async function ctxOk(): Promise<{ ok: true; ctx: CtxOk } | { ok: false; error: string }> {
  const ctx = await contextoSuscripcion()
  if (ctx.tipo === 'no_disponible') return { ok: false, error: NO_DISPONIBLE }
  if (ctx.tipo !== 'ok') return { ok: false, error: SIN_PERMISO }
  return { ok: true, ctx }
}

/** Lo mismo, y además que la sesión pueda operar: todo lo que escribe o mide pasa por aquí. */
async function ctxEscritura(): Promise<{ ok: true; ctx: CtxOk } | { ok: false; error: string }> {
  const r = await ctxOk()
  if (!r.ok) return r
  if (r.ctx.soloLectura) return { ok: false, error: SOLO_LECTURA }
  return r
}

async function nombreDe(usuarioId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (createServiceClient() as any).from('profiles').select('full_name').eq('id', usuarioId).maybeSingle()
  return (r.data?.full_name as string | undefined)?.trim() || null
}

function refrescar() {
  revalidatePath('/suscripcion')
  revalidatePath('/valida')
}

// ── Usuario adicional (cláusula 2.3) ──────────────────────────────────────────────────────

export interface CotizacionVisible {
  valorMensual: number
  prorrataMonto: number
  prorrataDias: number
  periodoDias: number
  /** «23-sep al 22-oct» del periodo en curso. */
  periodoTexto: string
  cuotaNumero: number
  cuotaSube: number
}

export async function cotizarUsuarioAdicional(): Promise<Resultado<{ cotizacion: CotizacionVisible }>> {
  const r = await ctxOk()
  if (!r.ok) return r
  const cot = await cotizarLicencia(r.ctx, r.ctx.entrada.hoy)
  if (!cot.ok) return cot
  return {
    ok: true,
    cotizacion: {
      valorMensual: cot.valorMensual,
      prorrataMonto: cot.prorrata.monto,
      prorrataDias: cot.prorrata.dias,
      periodoDias: cot.prorrata.periodo.dias,
      periodoTexto: `${fechaConAnio(cot.prorrata.periodo.desde)} al ${fechaConAnio(cot.prorrata.periodo.hasta)}`,
      cuotaNumero: cot.primeraCuota.numero,
      cuotaSube: cot.primeraCuota.sube,
    },
  }
}

export async function comprarUsuarioAdicional(p: { solicitudExpresa: boolean }): Promise<Resultado<{ licencias: number }>> {
  if (p.solicitudExpresa !== true) {
    return { ok: false, error: 'Para agregar un usuario marca la casilla de solicitud expresa.' }
  }
  const r = await ctxEscritura()
  if (!r.ok) return r
  const equipo = await leerEquipo(r.ctx)
  if (equipo === 'error') return { ok: false, error: NO_DISPONIBLE }
  const antes = equipo.licencias.licencias
  if (antes === null) {
    return { ok: false, error: 'Tu contrato no tiene registrados sus usuarios incluidos. Escríbenos y lo resolvemos.' }
  }
  const c = await comprarLicencia(r.ctx, r.ctx.entrada.hoy, antes)
  if (!c.ok) return c
  refrescar()
  return { ok: true, licencias: antes + 1 }
}

// ── Usuarios del espacio ──────────────────────────────────────────────────────────────────

export async function invitarAlEspacio(p: {
  correo: string
  nombre: string
  rol: string
}): Promise<Resultado<{ correoEnviado: boolean }>> {
  const r = await ctxEscritura()
  if (!r.ok) return r
  const equipo = await leerEquipo(r.ctx)
  if (equipo === 'error') return { ok: false, error: NO_DISPONIBLE }
  if (!equipo.cupo) return { ok: false, error: 'Tu espacio no tiene registrados sus usuarios incluidos. Escríbenos y lo resolvemos.' }
  const problema = validarInvitacion({ correo: p.correo, nombre: p.nombre, rol: p.rol, cupo: equipo.cupo })
  if (problema) return { ok: false, error: MENSAJE_INVITACION[problema] }
  if (!esRolAsignable(p.rol)) return { ok: false, error: MENSAJE_INVITACION.rol }

  const res = await invitarUsuario({
    workspaceId: r.ctx.workspaceId,
    actorId: r.ctx.usuarioId,
    actorNombre: await nombreDe(r.ctx.usuarioId),
    correo: p.correo,
    nombre: p.nombre,
    rol: p.rol,
    licencias: equipo.cupo.licencias,
  })
  if (!res.ok) return res
  refrescar()
  return { ok: true, correoEnviado: res.correoEnviado }
}

export async function retirarDelEspacio(p: {
  usuarioId: string
  /** Además de retirar, dejar de pagar una licencia adicional desde el periodo siguiente. */
  dejarDePagarAdicional: boolean
}): Promise<Resultado<{ sesionCerrada: boolean; licenciaLiberada: boolean; desdeCuota: number | null }>> {
  const r = await ctxEscritura()
  if (!r.ok) return r
  const ret = await retirarUsuario({
    workspaceId: r.ctx.workspaceId,
    actorId: r.ctx.usuarioId,
    designadoId: r.ctx.designadoId,
    usuarioId: p.usuarioId,
  })
  if (!ret.ok) return ret

  let licenciaLiberada = false
  let desdeCuota: number | null = null
  if (p.dejarDePagarAdicional) {
    const equipo = await leerEquipo(r.ctx)
    if (
      equipo !== 'error' &&
      equipo.licencias.licencias !== null &&
      licenciaAdicionalLiberable({
        licencias: equipo.licencias.licencias,
        usadosDespues: equipo.usuarios.length,
        adicionalesVigentes: equipo.licencias.adicionalesVigentes.length,
      })
    ) {
      const lib = await liberarLicencia(r.ctx, r.ctx.entrada.hoy, equipo.licencias.licencias)
      if (!lib.ok) {
        refrescar()
        return { ok: false, error: `La persona quedó retirada, pero el usuario adicional no se pudo dejar de pagar: ${lib.error}` }
      }
      licenciaLiberada = true
      desdeCuota = lib.desdeCuota
    }
  }
  refrescar()
  return { ok: true, sesionCerrada: ret.sesionCerrada, licenciaLiberada, desdeCuota }
}

export async function cambiarRolEnEspacio(p: { usuarioId: string; rol: string }): Promise<Resultado> {
  if (!esRolAsignable(p.rol)) return { ok: false, error: MENSAJE_INVITACION.rol }
  const r = await ctxEscritura()
  if (!r.ok) return r
  const res = await cambiarRolUsuario({
    workspaceId: r.ctx.workspaceId,
    actorId: r.ctx.usuarioId,
    designadoId: r.ctx.designadoId,
    usuarioId: p.usuarioId,
    rol: p.rol,
  })
  if (res.ok) refrescar()
  return res
}

export async function reenviarInvitacionEspacio(p: { usuarioId: string }): Promise<Resultado> {
  const r = await ctxEscritura()
  if (!r.ok) return r
  return reenviarInvitacion({
    workspaceId: r.ctx.workspaceId,
    actorNombre: await nombreDe(r.ctx.usuarioId),
    usuarioId: p.usuarioId,
  })
}

// ── Sustenta ──────────────────────────────────────────────────────────────────────────────

export async function descartarSustenta(): Promise<Resultado> {
  const r = await ctxEscritura()
  if (!r.ok) return r
  const [res] = await Promise.all([
    descartarSugerencia({ usuarioId: r.ctx.usuarioId, ahora: new Date() }),
    registrarEventoSugerencia({ workspaceId: r.ctx.workspaceId, usuarioId: r.ctx.usuarioId, evento: 'descarte' }),
  ])
  if (res.ok) revalidatePath('/suscripcion')
  return res
}

/**
 * «Quiero una demostración», desde la tarjeta o desde el pie del panel. Idempotente por espacio: el
 * segundo clic (o el de otra persona del mismo CDA) no crea otro lead y responde `yaExistia`. El clic
 * se mide siempre; el lead, una vez.
 */
export async function pedirContactoDeSustenta(
  p: { origen?: string } = {},
): Promise<Resultado<{ yaExistia: boolean; nombre: string | null }>> {
  const r = await ctxEscritura()
  if (!r.ok) return r
  const [res] = await Promise.all([
    pedirContactoSustenta({
      workspaceId: r.ctx.workspaceId,
      usuarioId: r.ctx.usuarioId,
      role: r.ctx.role,
      empresaIdEnMetrik: r.ctx.contrato.empresaId,
      cobradorId: r.ctx.contrato.cobradorId,
      empresaNombre: r.ctx.contrato.empresaNombre,
    }),
    registrarEventoSugerencia({
      workspaceId: r.ctx.workspaceId,
      usuarioId: r.ctx.usuarioId,
      evento: 'cta',
      origen: origenCta(p?.origen),
    }),
  ])
  if (!res.ok) return res
  revalidatePath('/suscripcion')
  return { ok: true, yaExistia: res.yaExistia, nombre: res.nombre }
}

/** Vista de la tarjeta y apertura del panel. Nunca falla hacia la pantalla. */
export async function registrarEventoSustenta(evento: string): Promise<void> {
  const e = eventoDelNavegador(evento)
  if (!e) return
  const r = await ctxEscritura()
  if (!r.ok) return
  await registrarEventoSugerencia({ workspaceId: r.ctx.workspaceId, usuarioId: r.ctx.usuarioId, evento: e })
}
