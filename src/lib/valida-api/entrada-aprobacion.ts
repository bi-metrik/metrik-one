import 'server-only'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { origenPeticion } from './contexto'
import { filasAceptacionUsuario, textoCasillaEntrada, type EstadoEntrada } from './entrada'
import { huellaAvisoPolitica, huellaTexto } from './politica-huella'
import { PRODUCTOS_ENTRADA, type ProductoEntrada } from './producto'
import type { EstadoEntradaPagina, ResultadoAprobarEntrada } from './resultados'
import { prepararAceptacion, type FilaAceptacionModulo, type RazonNoAcepta, type VersionContratada } from './terminos'
import { documentosDelCliente, versionContratada } from './terminos-servidor'

/**
 * Lo que la entrada de términos hace del lado del servidor, compartido por los dos productos que la
 * tienen: Valida API (`acciones.ts`) y Valida de los CDA (`valida-cda/acciones.ts`). Hasta el
 * 2026-09-23 vivía dentro de `aprobarEntradaValidaApi`; se sacó aquí para que los CDA firmen con
 * EXACTAMENTE las mismas comprobaciones, y no con una copia que se separe con el primer arreglo.
 *
 * No es `'use server'` a propósito: nada de esto es un endpoint. Cada producto expone su propia
 * acción, que primero resuelve SU contexto (sesión, módulo, espacio) y después llama aquí.
 */

export interface ContextoEntrada {
  /** El espacio del cliente (el de la sesión). */
  workspaceId: string
  /** La persona REAL de la sesión, nunca la de «Ver como». */
  usuarioId: string
  producto: ProductoEntrada
}

/** Por qué quien entra no puede firmar el contrato. Los textos de Valida API no cambian. */
export function mensajeNoFirma(razon: RazonNoAcepta, producto: ProductoEntrada): string {
  const quien =
    PRODUCTOS_ENTRADA[producto].exigeDesignado || razon === 'no_designado'
      ? 'la persona que la empresa designó ante MeTRIK'
      : 'el dueño del espacio'
  switch (razon) {
    case 'soporte':
      return `El soporte de MeTRIK no acepta términos por un cliente: los acepta ${quien}.`
    case 'no_owner':
      return 'Los términos del contrato los acepta primero el dueño del espacio, que es quien puede obligar a la empresa.'
    case 'otro_espacio':
      return `Los términos del contrato los acepta primero ${quien === 'el dueño del espacio' ? 'el dueño de este espacio' : quien}.`
    case 'no_designado':
      return 'Los términos del contrato los acepta la persona que la empresa designó ante MeTRIK.'
    case 'sin_designado':
      return 'MeTRIK todavía no tiene registrada la persona que acepta estos términos por la empresa. Escríbenos para indicarla.'
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
 * Qué muestra la entrada. Todos los roles la ven: quien no puede firmar el contrato necesita saber
 * por qué no entra y a quién espera.
 */
export async function armarEstadoEntradaPagina(
  ctx: Pick<ContextoEntrada, 'workspaceId'>,
  estado: EstadoEntrada,
): Promise<EstadoEntradaPagina> {
  if (estado.estado !== 'pendiente') return estado

  let contrato: Extract<EstadoEntradaPagina, { estado: 'pendiente' }>['contrato']
  if (estado.aceptante === null) {
    contrato = { estado: 'aceptado' }
  } else if (!estado.aceptante.puede) {
    contrato = {
      estado: 'pendiente',
      puede: false,
      razon: estado.aceptante.razon,
      // Solo si hay a quién nombrar: un `null` explícito no le dice nada a nadie.
      ...(estado.designadoNombre ? { designadoNombre: estado.designadoNombre } : {}),
    }
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

export interface EntradaAprobacion {
  leyoHastaElFinal: boolean
  casillaMostrada: string
  firma?: {
    nombre: string
    cedula: string
    calidad: string
    declaraciones: { documentoId: string; texto: string }[]
  } | null
}

/**
 * El único «Acepto» de la entrada. En este orden, y todo lo que se decide se decide ANTES de
 * escribir:
 *
 *   1. Tiene que haber llegado al final de los términos y tener a la vista la casilla que arma el
 *      servidor con los documentos de la base (si no coincide, algo cambió: no se registra).
 *   2. Si el contrato del espacio está pendiente, solo sigue quien puede firmarlo (la persona
 *      designada o, si el contrato no designó a nadie, el dueño real), con sus datos y la
 *      declaración exacta de cada documento.
 *   3. Se escribe primero la aceptación contractual. Si falla, no se registra nada más.
 *   4. Después, en UNA sola sentencia, las constancias del usuario: la Política y cada documento.
 *
 * La base vuelve a exigir lo contractual en `aceptaciones_terminos_modulo()`: esta función no es la
 * única barrera.
 */
export async function registrarAprobacionEntrada(
  ctx: ContextoEntrada,
  estado: EstadoEntrada,
  hoy: string,
  input: EntradaAprobacion,
): Promise<ResultadoAprobarEntrada> {
  if (input?.leyoHastaElFinal !== true) {
    return { ok: false, error: 'Lee los términos hasta el final para poder aceptar.' }
  }
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
    if (!estado.aceptante.puede) return { ok: false, error: mensajeNoFirma(estado.aceptante.razon, ctx.producto) }
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
        usuarioId: ctx.usuarioId,
        workspaceClienteId: ctx.workspaceId,
        ip: origen.ip,
        userAgent: origen.userAgent,
        producto: ctx.producto,
      })
      if (preparacion.tipo === 'error') return { ok: false, error: preparacion.error }
      if (preparacion.tipo === 'fila') filasContrato.push(preparacion.fila)
    }
  }

  // ── La casilla: tiene que ser la que arma el servidor ──
  const documentos = estado.documentos.map((d) => d.doc)
  const casilla = textoCasillaEntrada({ documentos, firmaPor: empresas, producto: ctx.producto })
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
      console.error('[terminos] no se pudo registrar la aceptación de los términos:', error.message)
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
    usuarioId: ctx.usuarioId,
    huellaAvisoPolitica: huellaAvisoPolitica(ctx.producto),
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
    console.error('[terminos] no se pudo registrar la aprobación del usuario:', errorUsuario.message)
    return {
      ok: false,
      error: contratoRegistrado
        ? 'La aceptación del contrato quedó registrada, pero no tu aprobación. Intenta de nuevo.'
        : 'No se pudo registrar tu aprobación. Intenta de nuevo.',
    }
  }

  revalidatePath(PRODUCTOS_ENTRADA[ctx.producto].ruta)
  return { ok: true, yaEstaba: false }
}
