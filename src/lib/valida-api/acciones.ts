'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { llamarValida } from './cliente'
import { contextoValidaApi, origenPeticion, type ContextoValidaApi } from './contexto'
import { POLITICA_DATOS_VALIDA, requiereAceptacion } from './politica'
import { huellaAvisoPolitica } from './politica-huella'
import {
  armarServicioConPagos,
  esFuncionAusente,
  mapearDocumentos,
  mapearLlaveEmitida,
  serviciosQuePaga,
} from './mapeo'
import { esUuid, nombreLlaveValido, puedeOperarLlaves, puedeVerPagos } from './reglas'
import type { ListadoLlaves, ResumenValidaApi } from './tipos'
import type {
  Carga,
  EstadoPolitica,
  ResultadoAceptar,
  ResultadoDocumentos,
  ResultadoEmitir,
  ResultadoLlaves,
  ResultadoPagos,
  ResultadoResumen,
  ResultadoRevocar,
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

/** La aceptación de la Política es previa a TODO lo demás del módulo (§5.4). */
async function politicaAceptada(userId: string): Promise<boolean | null> {
  const { data, error } = await createServiceClient()
    // La tabla nace en la migración de C2; hasta aplicarla no está en `database.ts`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('documentos_aceptaciones_usuario' as any)
    .select('documento_version, aceptada_at')
    .eq('usuario_id', userId)
    .eq('documento_slug', POLITICA_DATOS_VALIDA.slug)
  if (error) {
    console.error('[valida-api] no se pudo leer la aceptación de la Política:', error.message)
    return null
  }
  const filas = (data ?? []) as unknown as { documento_version: string; aceptada_at: string }[]
  return !requiereAceptacion(filas)
}

// ── Política de Datos ────────────────────────────────────────────────────────

export async function estadoPoliticaValidaApi(): Promise<EstadoPolitica> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') {
    const s = sinAcceso(ctx)
    return s.estado === 'sin_acceso' ? { estado: 'sin_acceso', razon: s.razon } : { estado: 'no_disponible' }
  }
  const aceptada = await politicaAceptada(ctx.actor.usuario_id)
  if (aceptada === null) return { estado: 'no_disponible' }
  return { estado: aceptada ? 'aceptada' : 'pendiente' }
}

/**
 * Registra la aceptación de la Política vigente por el usuario de la sesión. Idempotente: la
 * misma versión no crea dos filas (la base lo impide con un UNIQUE), y reintentar responde ok.
 */
export async function aceptarPoliticaValidaApi(): Promise<ResultadoAceptar> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return { ok: false, error: 'No tienes acceso a este módulo.' }

  const { ip, userAgent } = await origenPeticion()
  const { error } = await createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('documentos_aceptaciones_usuario' as any)
    .upsert(
      {
        workspace_id: ctx.workspaceId,
        // El usuario real de la sesión, no uno impersonado: acepta quien marca la casilla.
        usuario_id: ctx.actor.usuario_id,
        documento_slug: POLITICA_DATOS_VALIDA.slug,
        documento_version: POLITICA_DATOS_VALIDA.version,
        documento_url: POLITICA_DATOS_VALIDA.url,
        documento_sha256: null,
        aviso_texto_sha256: huellaAvisoPolitica(),
        ip,
        user_agent: userAgent,
      } as never,
      { onConflict: 'usuario_id,documento_slug,documento_version', ignoreDuplicates: true },
    )
  if (error) {
    console.error('[valida-api] no se pudo registrar la aceptación:', error.message)
    return { ok: false, error: 'No se pudo registrar la aceptación. Intenta de nuevo.' }
  }
  revalidatePath('/valida-api')
  return { ok: true }
}

// ── Consumo ─────────────────────────────────────────────────────────────────

/** Todos los roles del workspace ven el consumo (§5.4). */
export async function leerResumenValidaApi(): Promise<ResultadoResumen> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return sinAcceso(ctx)

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
  if ((await politicaAceptada(ctx.actor.usuario_id)) !== true) {
    return { ok: false, error: 'Acepta la Política de Datos antes de operar el módulo.' }
  }

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

export async function revocarLlaveValidaApi(keyId: string): Promise<ResultadoRevocar> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return { ok: false, error: 'No tienes acceso a este módulo.' }
  if (!puedeOperarLlaves(ctx.role)) return { ok: false, error: 'Solo el dueño y los administradores revocan llaves.' }
  if ((await politicaAceptada(ctx.actor.usuario_id)) !== true) {
    return { ok: false, error: 'Acepta la Política de Datos antes de operar el módulo.' }
  }
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

// ── Documentos y Pagos: datos del workspace metrik, solo por RPC cerrada ─────

export async function leerDocumentosValidaApi(): Promise<ResultadoDocumentos> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return sinAcceso(ctx)

  // Cliente de SESIÓN, no de servicio: la RPC deriva el workspace de `current_user_workspace_id()`,
  // que con el cliente de servicio no tiene de dónde leerlo y devolvería nada.
  const { supabase } = await getWorkspace()
  const [docs, politica] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('mis_documentos_de_servicio'),
    createServiceClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('documentos_aceptaciones_usuario' as any)
      .select('documento_version, aceptada_at')
      .eq('usuario_id', ctx.actor.usuario_id)
      .eq('documento_slug', POLITICA_DATOS_VALIDA.slug)
      .order('aceptada_at', { ascending: false }),
  ])

  if (docs.error) {
    if (esFuncionAusente(docs.error)) return { estado: 'no_disponible', motivo: 'sin_migracion' }
    console.error('[valida-api] mis_documentos_de_servicio:', docs.error.message)
    return { estado: 'no_disponible', motivo: 'base' }
  }
  if (politica.error) {
    console.error('[valida-api] aceptaciones de la Política:', politica.error.message)
    return { estado: 'no_disponible', motivo: 'base' }
  }

  const filasPolitica = (politica.data ?? []) as unknown as { documento_version: string; aceptada_at: string }[]
  return {
    estado: 'ok',
    datos: {
      contractuales: mapearDocumentos(docs.data ?? []),
      politica: filasPolitica.map((p) => ({ version: p.documento_version, aceptadaAt: p.aceptada_at })),
    },
  }
}

export async function leerPagosValidaApi(): Promise<ResultadoPagos> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return sinAcceso(ctx)
  if (!puedeVerPagos(ctx.role)) {
    return { estado: 'sin_acceso', razon: 'Los pagos los ven el dueño y los administradores del espacio.' }
  }

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
