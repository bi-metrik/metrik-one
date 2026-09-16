'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { llamarValida } from './cliente'
import { contextoValidaApi, origenPeticion, type ContextoValidaApi } from './contexto'
import { filasAceptacionUsuario, textoCasillaEntrada } from './entrada'
import { entradaAprobada, entradaDelUsuario, leerAceptacionesUsuario } from './entrada-servidor'
import { huellaAvisoPolitica, huellaTexto } from './politica-huella'
import {
  armarServicioConPagos,
  esFuncionAusente,
  mapearLlaveEmitida,
  serviciosQuePaga,
} from './mapeo'
import { esUuid, nombreLlaveValido, puedeOperarLlaves, puedeVerPagos } from './reglas'
import { prepararAceptacion, type FilaAceptacionModulo, type RazonNoAcepta, type VersionContratada } from './terminos'
import { terminosAprobados, type HuellasVersion } from './terminos-aprobados'
import { documentosDelCliente, versionContratada } from './terminos-servidor'
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

const MENSAJE_NO_FIRMA: Record<RazonNoAcepta, string> = {
  soporte: 'El soporte de MeTRIK no acepta términos por un cliente: los acepta el dueño del espacio.',
  no_owner: 'Los términos del contrato los acepta primero el dueño del espacio, que es quien puede obligar a la empresa.',
  otro_espacio: 'Los términos del contrato los acepta primero el dueño de este espacio.',
}

/**
 * Qué muestra la entrada. Todos los roles la ven: quien no puede firmar el contrato necesita saber
 * por qué no entra y quién lo habilita.
 */
export async function estadoEntradaValidaApi(): Promise<EstadoEntradaPagina> {
  const entrada = await entradaDelUsuario()
  if (entrada.tipo !== 'ok') return { estado: 'no_disponible' }
  const { ctx, estado } = entrada
  if (estado.estado !== 'pendiente') return estado

  let contrato: Extract<EstadoEntradaPagina, { estado: 'pendiente' }>['contrato']
  if (estado.aceptante === null) {
    contrato = { estado: 'aceptado' }
  } else if (!estado.aceptante.puede) {
    contrato = { estado: 'pendiente', puede: false, razon: estado.aceptante.razon }
  } else {
    const versiones = await versionesPorFirmar(ctx.workspaceId, estado.contratoPendiente.map((d) => d.documentoId))
    if (!versiones) return { estado: 'no_disponible' }
    contrato = {
      estado: 'pendiente',
      puede: true,
      empresas: empresasDe(versiones),
      porFirmar: versiones.map((v) => ({
        documentoId: v.documentoId,
        titulo: v.titulo,
        version: v.version,
        pdfSha256: v.pdfSha256,
        empresaNombre: v.empresaNombre,
        empresaNit: v.empresaNit,
      })),
    }
  }

  return {
    estado: 'pendiente',
    documentos: estado.documentos.map(({ doc }) => ({
      documentoId: doc.documentoId,
      slug: doc.slug,
      titulo: doc.titulo,
      version: doc.version,
      textoMd: doc.textoMd,
    })),
    contrato,
    conflicto: estado.conflictos.length > 0,
  }
}

/** La versión con su contrato de cada documento por firmar. `null` si alguna no se pudo leer. */
async function versionesPorFirmar(workspaceId: string, documentoIds: string[]): Promise<VersionContratada[] | null> {
  const versiones = await Promise.all(documentoIds.map((id) => versionContratada(workspaceId, id)))
  const validas = versiones.filter((v): v is VersionContratada => v !== null && v !== 'error')
  return validas.length === versiones.length && validas.length > 0 ? validas : null
}

function empresasDe(versiones: readonly VersionContratada[]): string[] {
  return [...new Set(versiones.map((v) => v.empresaNombre))]
}

/**
 * El único «Acepto» de la entrada. En este orden, y todo lo que se decide se decide ANTES de
 * escribir:
 *
 *   1. Tiene que haber llegado al final de los términos y tener a la vista la casilla que arma el
 *      servidor con los documentos de la base (si no coincide, algo cambió: no se registra).
 *   2. Si el contrato del espacio está pendiente, solo sigue el dueño real, con sus datos y la
 *      declaración exacta de cada documento.
 *   3. Se escribe primero la aceptación contractual. Si falla, no se registra nada más.
 *   4. Después, en UNA sola sentencia, las constancias del usuario: la Política y cada documento.
 *
 * La base vuelve a exigir lo contractual en `aceptaciones_terminos_modulo()`: esta acción no es la
 * única barrera.
 */
export async function aprobarEntradaValidaApi(input: {
  leyoHastaElFinal: boolean
  casillaMostrada: string
  firma?: {
    nombre: string
    cedula: string
    calidad: string
    declaraciones: { documentoId: string; texto: string }[]
  } | null
}): Promise<ResultadoAprobarEntrada> {
  const entrada = await entradaDelUsuario()
  if (entrada.tipo !== 'ok') return { ok: false, error: 'No tienes acceso a este módulo.' }
  if (input?.leyoHastaElFinal !== true) {
    return { ok: false, error: 'Lee los términos hasta el final para poder aceptar.' }
  }

  const { ctx, estado, hoy } = entrada
  if (estado.estado === 'aprobada') return { ok: true, yaEstaba: true }
  if (estado.estado === 'sin_documentos') {
    return { ok: false, error: 'Los términos de tu contrato todavía no están registrados. Escríbenos para habilitarlos.' }
  }
  if (estado.estado === 'no_disponible') {
    return { ok: false, error: 'No se pudieron leer los términos de tu contrato. Intenta de nuevo en un momento.' }
  }
  if (estado.conflictos.length > 0) {
    return {
      ok: false,
      error: 'Ya tienes registrada la aceptación de otro documento con el mismo nombre y versión. Escríbenos para resolverlo.',
    }
  }

  const origen = await origenPeticion()

  // ── Lo contractual, si falta ──
  const filasContrato: FilaAceptacionModulo[] = []
  let empresas: string[] | null = null
  if (estado.aceptante !== null) {
    if (!estado.aceptante.puede) return { ok: false, error: MENSAJE_NO_FIRMA[estado.aceptante.razon] }
    const firma = input.firma
    if (!firma || !Array.isArray(firma.declaraciones)) {
      return { ok: false, error: 'Completa tu nombre, tu cédula y en qué calidad aceptas en nombre de la empresa.' }
    }

    const [docs, versiones] = await Promise.all([
      documentosDelCliente(),
      versionesPorFirmar(ctx.workspaceId, estado.contratoPendiente.map((d) => d.documentoId)),
    ])
    if (!docs.ok || !versiones) {
      return { ok: false, error: 'No se pudieron leer los términos de tu contrato. Intenta de nuevo.' }
    }
    empresas = empresasDe(versiones)

    for (const version of versiones) {
      const preparacion = prepararAceptacion({
        documentos: docs.documentos,
        hoy,
        documentoId: version.documentoId,
        version,
        // La única casilla de la entrada es la que declara las facultades: sin marcarla no hay clic.
        input: { nombre: firma.nombre, cedula: firma.cedula, calidad: firma.calidad, declaraFacultades: true },
        declaracionMostrada: firma.declaraciones.find((d) => d?.documentoId === version.documentoId)?.texto,
        // El usuario real de la sesión: acepta quien marca la casilla, no el impersonado.
        usuarioId: ctx.actor.usuario_id,
        workspaceClienteId: ctx.workspaceId,
        ip: origen.ip,
        userAgent: origen.userAgent,
      })
      if (preparacion.tipo === 'error') return { ok: false, error: preparacion.error }
      if (preparacion.tipo === 'fila') filasContrato.push(preparacion.fila)
    }
  }

  // ── La casilla: tiene que ser la que arma el servidor ──
  const documentos = estado.documentos.map((d) => d.doc)
  const casilla = textoCasillaEntrada({ documentos, firmaPor: empresas })
  if (input.casillaMostrada !== casilla) {
    return {
      ok: false,
      error: 'Los términos cambiaron mientras los leías. Recarga la página y vuelve a leerlos antes de aceptar.',
    }
  }

  const svc = createServiceClient()

  // ── 1. Primero lo contractual ──
  let contratoRegistrado = false
  if (filasContrato.length > 0) {
    const { error } = await svc
      // `aceptaciones_terminos` no está en `database.ts`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('aceptaciones_terminos' as any)
      .insert(filasContrato as never)
    if (error && error.code !== '23505') {
      console.error('[valida-api] no se pudo registrar la aceptación de los términos:', error.message)
      return { ok: false, error: 'No se pudo registrar la aceptación de los términos. Nada quedó guardado; intenta de nuevo.' }
    }
    // 23505: otra pestaña (o WhatsApp) registró primero esa versión. La puerta lo vuelve a mirar
    // al recargar; si quedara alguna pendiente, se pide de nuevo.
    contratoRegistrado = !error
  }

  // ── 2. Las constancias del usuario, en una sola sentencia ──
  const filasUsuario = filasAceptacionUsuario({
    documentos,
    workspaceId: ctx.workspaceId,
    usuarioId: ctx.actor.usuario_id,
    huellaAvisoPolitica: huellaAvisoPolitica(),
    huellaCasilla: huellaTexto(casilla),
    ip: origen.ip,
    userAgent: origen.userAgent,
  })
  const { error: errorUsuario } = await svc
    // La tabla nace en la migración de C2; hasta aplicarla no está en `database.ts`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('documentos_aceptaciones_usuario' as any)
    .upsert(filasUsuario as never, {
      onConflict: 'usuario_id,documento_slug,documento_version',
      ignoreDuplicates: true,
    })
  if (errorUsuario) {
    console.error('[valida-api] no se pudo registrar la aprobación del usuario:', errorUsuario.message)
    return {
      ok: false,
      error: contratoRegistrado
        ? 'La aceptación del contrato quedó registrada, pero no tu aprobación. Intenta de nuevo.'
        : 'No se pudo registrar tu aprobación. Intenta de nuevo.',
    }
  }

  revalidatePath('/valida-api')
  return { ok: true, yaEstaba: false }
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
