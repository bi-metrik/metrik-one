'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { llamarValida } from './cliente'
import { contextoValidaApi, type ContextoValidaApi } from './contexto'
import {
  armarEstadoEntradaPagina,
  registrarAprobacionEntrada,
  type EntradaAprobacion,
} from './entrada-aprobacion'
import { entradaAprobada, entradaDelUsuario, leerAceptacionesUsuario } from './entrada-servidor'
import { huellaTexto } from './politica-huella'
import {
  armarServicioConPagos,
  esFuncionAusente,
  mapearLlaveEmitida,
  serviciosQuePaga,
} from './mapeo'
import { esUuid, nombreLlaveValido, puedeOperarLlaves, puedeVerPagos } from './reglas'
import { terminosAprobados, type HuellasVersion } from './terminos-aprobados'
import { documentosDelCliente } from './terminos-servidor'
import type { ListadoLlaves, ResumenValidaApi } from './tipos'
import type {
  Carga,
  EstadoEntradaPagina,
  ResultadoAprobarEntrada,
  ResultadoEmitir,
  ResultadoLlaves,
  ResultadoPagos,
  ResultadoResumen,
  ResultadoRevocar,
  ResultadoTerminosAprobados,
} from './resultados'

/**
 * Acciones del módulo Valida API (spec 2026-09-15 §5.3 y §5.4, entrega C2).
 *
 * ⚠️ Cada export de este archivo es un ENDPOINT alcanzable desde cualquier sesión, aunque ninguna
 * pantalla lo invoque. Por eso TODAS empiezan por `contextoValidaApi()`, que exige sesión, el
 * módulo `valida_api` y un `valida_cliente_id` del propio workspace. El `cliente_id` NUNCA llega
 * por parámetro: lo único que el navegador puede mandar es el nombre de una llave o el id de la
 * llave a revocar, y ese id Valida lo busca DENTRO del cliente que puso el servidor, así que el
 * de otro cliente responde «no encontrada».
 *
 * ⚠️ Y TODAS, salvo las de la entrada, exigen además la aprobación completa de `entrada.ts`
 * (Política + términos leídos por el usuario + contrato aceptado). La página no pinta pestañas sin
 * ella, pero eso es la pantalla: la puerta de verdad es esta.
 *
 * ⚠️ La llave en claro: `generarLlaveValidaApi` la devuelve UNA vez a quien la pidió. No se
 * escribe en `console`, ni en la base de ONE, ni en `activity_log`, ni en un correo.
 */

function sinAcceso<T>(ctx: Exclude<ContextoValidaApi, { tipo: 'ok' }>): Carga<T> {
  if (ctx.tipo === 'error_lectura') return { estado: 'no_disponible', motivo: 'base' }
  const razon =
    ctx.tipo === 'sin_sesion'
      ? 'No hay una sesión activa.'
      : ctx.tipo === 'sin_actor'
        ? 'Tu usuario no tiene un correo registrado, así que la operación no se puede atribuir.'
        : 'Este espacio no tiene el módulo Valida API.'
  return { estado: 'sin_acceso', razon }
}

/**
 * Lo que se responde a cualquier acción mientras la entrada no esté aprobada. Incluye revocar una
 * llave: sin la aprobación no hay NINGUNA operación desde ONE (pedido de Mauricio, 2026-09-16). Una
 * llave comprometida mientras tanto la revoca el soporte de MeTRIK desde Valida.
 */
const MENSAJE_ENTRADA_PENDIENTE =
  'Antes de usar el módulo tienes que leer y aceptar los términos de tu contrato y la Política de Datos al entrar.'

// ── La entrada: una sola aprobación ─────────────────────────────────────────
//
// Las reglas y la escritura viven en `entrada-aprobacion.ts`, compartidas con la entrada de los CDA
// (`valida-cda/acciones.ts`). Aquí solo se resuelve el contexto de ESTE módulo, que es lo que hace de
// cada export un endpoint seguro.

/**
 * Qué muestra la entrada. Todos los roles la ven: quien no puede firmar el contrato necesita saber
 * por qué no entra y quién lo habilita.
 */
export async function estadoEntradaValidaApi(): Promise<EstadoEntradaPagina> {
  const entrada = await entradaDelUsuario()
  if (entrada.tipo !== 'ok') return { estado: 'no_disponible' }
  return armarEstadoEntradaPagina({ workspaceId: entrada.ctx.workspaceId }, entrada.estado)
}

/** El único «Acepto» de la entrada. Ver `registrarAprobacionEntrada`. */
export async function aprobarEntradaValidaApi(input: EntradaAprobacion): Promise<ResultadoAprobarEntrada> {
  const entrada = await entradaDelUsuario()
  if (entrada.tipo !== 'ok') return { ok: false, error: 'No tienes acceso a este módulo.' }
  return registrarAprobacionEntrada(
    { workspaceId: entrada.ctx.workspaceId, usuarioId: entrada.ctx.actor.usuario_id, producto: 'valida_api' },
    entrada.estado,
    entrada.hoy,
    input,
  )
}

// ── Consumo ─────────────────────────────────────────────────────────────────

/** Todos los roles del workspace ven el consumo (§5.4), con la entrada aprobada. */
export async function leerResumenValidaApi(): Promise<ResultadoResumen> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return sinAcceso(ctx)
  if (!(await entradaAprobada())) return { estado: 'sin_acceso', razon: MENSAJE_ENTRADA_PENDIENTE }

  const r = await llamarValida<ResumenValidaApi>({
    metodo: 'GET',
    ruta: `/clientes/${ctx.clienteId}/resumen`,
    actor: ctx.actor,
  })
  if (r.tipo === 'ok') return { estado: 'ok', datos: r.datos }
  if (r.tipo === 'rechazada') return { estado: 'rechazada', codigo: r.codigo, mensaje: r.mensaje }
  return { estado: 'no_disponible', motivo: r.motivo }
}

// ── Llaves ──────────────────────────────────────────────────────────────────

export async function leerLlavesValidaApi(): Promise<ResultadoLlaves> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return sinAcceso(ctx)
  if (!puedeOperarLlaves(ctx.role)) {
    return { estado: 'sin_acceso', razon: 'Las llaves las administran el dueño y los administradores del espacio.' }
  }
  // Cláusula 3.1 de los términos: las credenciales se entregan después de la aceptación.
  if (!(await entradaAprobada())) return { estado: 'sin_acceso', razon: MENSAJE_ENTRADA_PENDIENTE }

  const r = await llamarValida<ListadoLlaves>({
    metodo: 'GET',
    ruta: `/clientes/${ctx.clienteId}/llaves`,
    actor: ctx.actor,
  })
  if (r.tipo === 'ok') return { estado: 'ok', datos: r.datos }
  if (r.tipo === 'rechazada') return { estado: 'rechazada', codigo: r.codigo, mensaje: r.mensaje }
  return { estado: 'no_disponible', motivo: r.motivo }
}

export async function generarLlaveValidaApi(input: {
  nombre?: string | null
  reemplazaA?: string | null
  revocarAnterior?: boolean
}): Promise<ResultadoEmitir> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return { ok: false, error: 'No tienes acceso a este módulo.' }
  if (!puedeOperarLlaves(ctx.role)) return { ok: false, error: 'Solo el dueño y los administradores generan llaves.' }
  // Regenerar también pasa por aquí: entrega una llave nueva, así que exige la entrada igual.
  if (!(await entradaAprobada())) return { ok: false, error: MENSAJE_ENTRADA_PENDIENTE }

  const reemplazaA = input.reemplazaA?.trim() || null
  if (reemplazaA && !esUuid(reemplazaA)) return { ok: false, error: 'La llave a regenerar no es válida.' }
  const nombre = nombreLlaveValido(input.nombre)
  // Una llave nueva necesita nombre; al regenerar se hereda el de la anterior (EmitirLlaveBody).
  if (!reemplazaA && !nombre) return { ok: false, error: 'Ponle un nombre a la llave (1 a 60 caracteres).' }

  const cuerpo: Record<string, unknown> = { actor: ctx.actor }
  if (nombre) cuerpo.nombre = nombre
  if (reemplazaA) {
    cuerpo.reemplaza_a = reemplazaA
    cuerpo.revocar_anterior = input.revocarAnterior === true
  }

  const r = await llamarValida<unknown>({
    metodo: 'POST',
    ruta: `/clientes/${ctx.clienteId}/llaves`,
    actor: ctx.actor,
    cuerpo,
  })
  if (r.tipo === 'rechazada') return { ok: false, error: r.mensaje }
  if (r.tipo === 'no_disponible') return { ok: false, error: 'Valida no está disponible en este momento. No se creó ninguna llave.' }

  const llave = mapearLlaveEmitida(r.datos)
  if (!llave) {
    // Valida dijo 2xx pero sin la llave: no se puede afirmar que el cliente tenga una llave
    // utilizable. Se dice, en vez de mostrar «creada».
    return { ok: false, error: 'Valida respondió sin la llave. Revisa el listado antes de reintentar.' }
  }
  revalidatePath('/valida-api')
  return { ok: true, llave }
}

/** Revocar también exige la entrada: ver `MENSAJE_ENTRADA_PENDIENTE`. */
export async function revocarLlaveValidaApi(keyId: string): Promise<ResultadoRevocar> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return { ok: false, error: 'No tienes acceso a este módulo.' }
  if (!puedeOperarLlaves(ctx.role)) return { ok: false, error: 'Solo el dueño y los administradores revocan llaves.' }
  if (!(await entradaAprobada())) return { ok: false, error: MENSAJE_ENTRADA_PENDIENTE }
  if (!esUuid(keyId)) return { ok: false, error: 'La llave no es válida.' }

  const r = await llamarValida<{ ok: true; key_id: string; ya_estaba_revocada?: boolean }>({
    metodo: 'POST',
    // El `cliente_id` lo pone el servidor: una llave de otro cliente responde «no encontrada».
    ruta: `/clientes/${ctx.clienteId}/llaves/${keyId.trim()}/revocar`,
    actor: ctx.actor,
    cuerpo: { actor: ctx.actor },
  })
  if (r.tipo === 'rechazada') return { ok: false, error: r.mensaje }
  if (r.tipo === 'no_disponible') return { ok: false, error: 'Valida no está disponible en este momento. La llave sigue igual.' }
  revalidatePath('/valida-api')
  return { ok: true, yaEstabaRevocada: r.datos.ya_estaba_revocada === true }
}

// ── Términos: releer lo que el usuario aprobó ───────────────────────────────

/**
 * Los términos que la persona de la sesión aprobó en la entrada, con el texto exacto que aprobó.
 * La regla (qué versión y cómo se comprueba que es el mismo texto) vive en `terminos-aprobados.ts`;
 * aquí solo se juntan las tres lecturas, y cualquiera que falle es «no disponible», nunca una lista
 * vacía que se leería como «no aprobaste nada».
 */
export async function leerTerminosAprobadosValidaApi(): Promise<ResultadoTerminosAprobados> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return sinAcceso(ctx)
  if (!(await entradaAprobada())) return { estado: 'sin_acceso', razon: MENSAJE_ENTRADA_PENDIENTE }

  // El usuario REAL de la sesión, igual que en la entrada: lo aprobado es suyo, no del impersonado.
  const [docs, aceptaciones] = await Promise.all([
    documentosDelCliente(),
    leerAceptacionesUsuario(ctx.actor.usuario_id),
  ])
  if (!docs.ok) return { estado: 'no_disponible', motivo: docs.motivo }
  if (aceptaciones === null) return { estado: 'no_disponible', motivo: 'base' }

  const ids = [...new Set(docs.documentos.map((d) => d.documentoId))]
  const huellas = new Map<string, HuellasVersion>()
  if (ids.length > 0) {
    // Las huellas registradas de cada versión. Los ids salen de la RPC de SESIÓN, así que el
    // cliente de servicio solo lee versiones que el espacio ya puede ver.
    const versiones = await createServiceClient()
      // La tabla nace en la migración de C2; no está en `database.ts`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('documentos_contractuales_versiones' as any)
      .select('id, texto_sha256, pdf_sha256')
      .in('id', ids)
    if (versiones.error) {
      console.error('[valida-api] huellas de las versiones:', versiones.error.message)
      return { estado: 'no_disponible', motivo: 'base' }
    }
    for (const v of (versiones.data ?? []) as unknown as { id: string; texto_sha256: string; pdf_sha256: string }[]) {
      huellas.set(v.id, { textoSha256: v.texto_sha256, pdfSha256: v.pdf_sha256 })
    }
  }

  return {
    estado: 'ok',
    datos: terminosAprobados({ aceptaciones, documentos: docs.documentos, huellas, huella: huellaTexto }),
  }
}

// ── Pagos: datos del workspace metrik, solo por RPC cerrada ─────────────────

export async function leerPagosValidaApi(): Promise<ResultadoPagos> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return sinAcceso(ctx)
  if (!puedeVerPagos(ctx.role)) {
    return { estado: 'sin_acceso', razon: 'Los pagos los ven el dueño y los administradores del espacio.' }
  }
  if (!(await entradaAprobada())) return { estado: 'sin_acceso', razon: MENSAJE_ENTRADA_PENDIENTE }

  const { supabase } = await getWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const servicios = await (supabase as any).rpc('mis_servicios')
  if (servicios.error) {
    if (esFuncionAusente(servicios.error)) return { estado: 'no_disponible', motivo: 'sin_migracion' }
    console.error('[valida-api] mis_servicios:', servicios.error.message)
    return { estado: 'no_disponible', motivo: 'base' }
  }

  const propios = serviciosQuePaga(servicios.data ?? [])
  const resultado = []
  for (const s of propios) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cobros = await (supabase as any).rpc('mis_cobros_de_servicio', {
      p_servicio_contratado_id: s.servicio_contratado_id,
    })
    if (cobros.error) {
      console.error('[valida-api] mis_cobros_de_servicio:', cobros.error.message)
      return { estado: 'no_disponible', motivo: 'base' }
    }
    resultado.push(armarServicioConPagos(s, cobros.data ?? []))
  }
  return { estado: 'ok', datos: resultado }
}
