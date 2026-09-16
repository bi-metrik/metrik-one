'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { llamarValida } from './cliente'
import { contextoValidaApi, origenPeticion, type ContextoValidaApi } from './contexto'
import { POLITICA_DATOS_VALIDA, requiereAceptacion } from './politica'
import { huellaAvisoPolitica } from './politica-huella'
import {
  armarServicioConPagos,
  esFuncionAusente,
  mapearLlaveEmitida,
  serviciosQuePaga,
} from './mapeo'
import { esUuid, nombreLlaveValido, puedeOperarLlaves, puedeVerPagos } from './reglas'
import { prepararAceptacion, puedeAceptarTerminos } from './terminos'
import { documentosDelCliente, perfilReal, terminosDelCliente, versionContratada } from './terminos-servidor'
import type { ListadoLlaves, ResumenValidaApi } from './tipos'
import type {
  Carga,
  EstadoPolitica,
  EstadoTerminosPagina,
  ResultadoAceptar,
  ResultadoAceptarTerminos,
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

/**
 * Cláusula 3.1 de los términos: las credenciales se entregan después de la aceptación. Leer,
 * generar y regenerar llaves exige que toda versión vigente del contrato esté aceptada. Un fallo
 * de lectura CIERRA: no poder comprobarlo no es haberlo aceptado.
 */
const MENSAJE_TERMINOS_PENDIENTES =
  'Las llaves se habilitan cuando el dueño del espacio acepte la versión vigente de los términos de tu contrato.'

async function terminosAceptados(): Promise<boolean> {
  return (await terminosDelCliente()).estado === 'aceptados'
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
  if (!(await terminosAceptados())) return { estado: 'sin_acceso', razon: MENSAJE_TERMINOS_PENDIENTES }

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
  // Regenerar también pasa por aquí: entrega una llave nueva, así que exige los términos igual.
  if (!(await terminosAceptados())) return { ok: false, error: MENSAJE_TERMINOS_PENDIENTES }

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

/**
 * Revocar NO exige los términos: quita acceso, no lo entrega. Si una versión nueva de los términos
 * queda pendiente, el cliente tiene que poder cortar una llave comprometida mientras la acepta.
 */
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

  // La RPC va con el cliente de SESIÓN (ver `terminos-servidor.ts`) y se comparte en el request
  // con la puerta de las llaves.
  const [docs, politica] = await Promise.all([
    documentosDelCliente(),
    createServiceClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('documentos_aceptaciones_usuario' as any)
      .select('documento_version, aceptada_at')
      .eq('usuario_id', ctx.actor.usuario_id)
      .eq('documento_slug', POLITICA_DATOS_VALIDA.slug)
      .order('aceptada_at', { ascending: false }),
  ])

  if (!docs.ok) return { estado: 'no_disponible', motivo: docs.motivo }
  if (politica.error) {
    console.error('[valida-api] aceptaciones de la Política:', politica.error.message)
    return { estado: 'no_disponible', motivo: 'base' }
  }

  const filasPolitica = (politica.data ?? []) as unknown as { documento_version: string; aceptada_at: string }[]
  return {
    estado: 'ok',
    datos: {
      contractuales: docs.documentos,
      politica: filasPolitica.map((p) => ({ version: p.documento_version, aceptadaAt: p.aceptada_at })),
    },
  }
}

// ── Términos del contrato ───────────────────────────────────────────────────

/**
 * Qué muestra la entrada del módulo sobre los términos. Todos los roles lo ven: quien no puede
 * aceptar necesita saber por qué no hay llaves y quién las habilita.
 */
export async function estadoTerminosValidaApi(): Promise<EstadoTerminosPagina> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return { estado: 'no_disponible' }

  const estado = await terminosDelCliente()
  if (estado.estado !== 'pendientes') return estado

  const doc = estado.pendientes[0]
  const [perfil, version] = await Promise.all([
    perfilReal(ctx.actor.usuario_id),
    versionContratada(ctx.workspaceId, doc.documentoId),
  ])
  if (!perfil || !version || version === 'error') return { estado: 'no_disponible' }

  return {
    estado: 'pendientes',
    totalPendientes: estado.pendientes.length,
    documento: {
      documentoId: doc.documentoId,
      titulo: doc.titulo,
      version: doc.version,
      textoMd: doc.textoMd,
      pdfSha256: doc.pdfSha256,
      empresaNombre: version.empresaNombre,
      empresaNit: version.empresaNit,
    },
    aceptante: puedeAceptarTerminos(perfil, ctx.workspaceId),
  }
}

/**
 * Registra la aceptación de una versión vigente de los términos por el dueño del espacio.
 *
 * Todo lo que va a la constancia sale de la base (huellas, empresa, contrato, perfil); del
 * navegador solo llegan el documento elegido, los datos de la persona y el texto que tenía a la
 * vista, que tiene que coincidir con el que arma el servidor. La base vuelve a comprobarlo todo
 * en `aceptaciones_terminos_modulo()`: esta acción no es la única barrera.
 */
export async function aceptarTerminosValidaApi(input: {
  documentoId: string
  nombre: string
  cedula: string
  calidad: string
  declaraFacultades: boolean
  declaracionMostrada: string
}): Promise<ResultadoAceptarTerminos> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return { ok: false, error: 'No tienes acceso a este módulo.' }
  if ((await politicaAceptada(ctx.actor.usuario_id)) !== true) {
    return { ok: false, error: 'Acepta la Política de Datos antes de aceptar los términos.' }
  }

  const documentoId = typeof input?.documentoId === 'string' ? input.documentoId.trim() : ''
  if (!esUuid(documentoId)) return { ok: false, error: 'El documento no es válido.' }

  const perfil = await perfilReal(ctx.actor.usuario_id)
  if (!perfil) return { ok: false, error: 'No se pudo verificar tu usuario. Intenta de nuevo.' }
  const aceptante = puedeAceptarTerminos(perfil, ctx.workspaceId)
  if (!aceptante.puede) {
    return {
      ok: false,
      error:
        aceptante.razon === 'soporte'
          ? 'El soporte de MeTRIK no acepta términos por un cliente: los acepta el dueño del espacio.'
          : 'Los términos los acepta el dueño del espacio, que es quien puede obligar a la empresa.',
    }
  }

  const [docs, version, origen] = await Promise.all([
    documentosDelCliente(),
    versionContratada(ctx.workspaceId, documentoId),
    origenPeticion(),
  ])
  if (!docs.ok || version === 'error') {
    return { ok: false, error: 'No se pudieron leer los términos de tu contrato. Intenta de nuevo.' }
  }

  const preparacion = prepararAceptacion({
    documentos: docs.documentos,
    hoy: todayBogotaISO(),
    documentoId,
    version,
    input,
    declaracionMostrada: input.declaracionMostrada,
    // El usuario real de la sesión: acepta quien marca la casilla, no el impersonado.
    usuarioId: ctx.actor.usuario_id,
    workspaceClienteId: ctx.workspaceId,
    ip: origen.ip,
    userAgent: origen.userAgent,
  })
  if (preparacion.tipo === 'ya_aceptado') return { ok: true, yaEstaba: true }
  if (preparacion.tipo === 'error') return { ok: false, error: preparacion.error }

  const { error } = await createServiceClient()
    // `aceptaciones_terminos` no está en `database.ts`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('aceptaciones_terminos' as any)
    .insert(preparacion.fila as never)
  if (error) {
    // Otra pestaña (o WhatsApp) la registró primero: la versión ya quedó aceptada.
    if (error.code === '23505') {
      revalidatePath('/valida-api')
      return { ok: true, yaEstaba: true }
    }
    console.error('[valida-api] no se pudo registrar la aceptación de los términos:', error.message)
    return { ok: false, error: 'No se pudo registrar la aceptación. Nada quedó guardado; intenta de nuevo.' }
  }

  revalidatePath('/valida-api')
  return { ok: true, yaEstaba: false }
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
