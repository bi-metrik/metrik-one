/**
 * Endpoint `/api/ferreteria/[recurso]` para los escritores SIN sesión: el agente de MeTRIK
 * (publica y edita en Marketplace) y el cron que corre en el Chrome del Mac.
 *
 * Contrato completo en `docs/specs/2026-09-24_modulo-ferreteria-dimpro.md`, §5.
 *
 *   GET  pendientes      → cambios hechos en ONE que el cron tiene que aplicar en el canal.
 *   POST confirmaciones  → el cron confirma cada cambio como aplicado (con lo que vio) o con error.
 *   POST lote            → mediciones del día y conversaciones nuevas.
 *   POST productos       → upsert por SKU (con su costo de lista, opcional).
 *   POST publicaciones   → upsert por código MP. Lo que escribe el agente ya está en el canal.
 *   POST eventos         → notas en la bitácora.
 *
 * Autenticación: `Authorization: Bearer fer_...`. El token identifica el workspace y el
 * escritor; el workspace tiene que tener el módulo encendido. Toda escritura pasa por
 * `nucleo.ts`, el mismo de la pantalla: el piso del precio y la bitácora no se saltan.
 *
 * Sin imports de servidor: la ruta le pasa el repositorio y el reloj, y las pruebas le pasan
 * uno en memoria.
 */
import { z } from 'zod'
import {
  agregarNota,
  confirmarCambio,
  guardarProducto,
  guardarPublicacion,
  listarPendientes,
  registrarLote,
} from './nucleo'
import {
  CANALES,
  CANALES_CONVERSACION,
  ESTADOS_PUBLICACION,
  LINEAS,
  RESULTADOS_CONVERSACION,
} from './reglas'
import { hashToken, tokenDeCabecera } from './token'
import type { Autor, RepoFerreteria } from './tipos'

export const MAX_ITEMS_POR_PETICION = 500

export interface PeticionApi {
  metodo: string
  recurso: string
  authorization: string | null
  cuerpo: unknown
  /** ISO. Lo pasa la ruta; las pruebas lo fijan. */
  ahora: string
}

export interface RespuestaApi {
  status: number
  cuerpo: unknown
}

function error(status: number, codigo: string, mensaje: string, detalle?: unknown): RespuestaApi {
  return { status, cuerpo: { error: { codigo, mensaje, ...(detalle !== undefined ? { detalle } : {}) } } }
}

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha en formato AAAA-MM-DD')
const texto = z.string().max(5000)
const lista = <T extends z.ZodTypeAny>(item: T) => z.array(item).min(1).max(MAX_ITEMS_POR_PETICION)

const esquemaConfirmaciones = z.object({
  confirmaciones: lista(
    z.object({
      codigo: z.string().min(1),
      version: z.number().int().min(0),
      resultado: z.enum(['aplicado', 'error']),
      visto: z
        .object({
          precio: z.number().positive().nullable().optional(),
          estado: z.enum(ESTADOS_PUBLICACION).nullable().optional(),
          link: z.string().url().nullable().optional(),
          id_aviso: z.string().nullable().optional(),
        })
        .optional(),
      error: texto.nullable().optional(),
    }).refine(
      (c) => c.resultado === 'error' || (c.visto != null && (c.visto.precio != null || c.visto.estado != null)),
      { message: 'Un cambio «aplicado» se confirma con lo que se vio al releer el aviso (visto.precio o visto.estado).' },
    ),
  ),
})

const esquemaLote = z.object({
  fecha,
  mediciones: z
    .array(
      z.object({
        codigo: z.string().min(1),
        clics: z.number().int().min(0),
        guardados: z.number().int().min(0).nullable().optional(),
        estado_visto: z.string().max(100).nullable().optional(),
        link: z.string().url().nullable().optional(),
        id_aviso: z.string().max(200).nullable().optional(),
      }),
    )
    .max(MAX_ITEMS_POR_PETICION)
    .default([]),
  conversaciones: z
    .array(
      z.object({
        codigo: z.string().min(1),
        fecha: fecha.optional(),
        interesado: z.string().trim().min(1).max(200),
        canal: z.enum(CANALES_CONVERSACION),
        resultado: z.enum(RESULTADOS_CONVERSACION).optional(),
        motivo_perdida: texto.nullable().optional(),
        id_externo: z.string().max(200).nullable().optional(),
      }),
    )
    .max(MAX_ITEMS_POR_PETICION)
    .default([]),
})

const esquemaProductos = z.object({
  productos: lista(
    z.object({
      sku: z.string().trim().min(1).max(100),
      nombre: z.string().trim().min(1).max(300).optional(),
      marca: z.string().max(200).nullable().optional(),
      categoria: z.string().max(200).nullable().optional(),
      proveedor: z.string().max(200).nullable().optional(),
      pagina_catalogo: z.string().max(50).nullable().optional(),
      fotos: z.array(z.string().url()).max(50).optional(),
      ficha: z
        .array(
          z.object({
            etiqueta: z.string().min(1).max(200),
            valor: z.string().max(1000),
            fuente: z.string().max(200).nullable().optional(),
            verificado: z.boolean().optional(),
          }),
        )
        .max(200)
        .optional(),
      observaciones: texto.nullable().optional(),
      costo: z
        .object({ fecha_lista: fecha, costo_f: z.number().positive(), costo_d: z.number().positive().nullable().optional() })
        .optional(),
    }),
  ),
})

const esquemaPublicaciones = z.object({
  publicaciones: lista(
    z.object({
      codigo: z.string().trim().min(1).max(50),
      sku: z.string().trim().min(1).max(100).optional(),
      canal: z.enum(CANALES).optional(),
      titulo: z.string().max(300).optional(),
      descripcion: texto.nullable().optional(),
      etiquetas: z.array(z.string().max(100)).max(50).optional(),
      precio: z.number().positive().nullable().optional(),
      linea: z.enum(LINEAS).nullable().optional(),
      link: z.string().url().nullable().optional(),
      id_aviso: z.string().max(200).nullable().optional(),
      perfil: z.string().max(200).nullable().optional(),
      fecha_publicacion: fecha.nullable().optional(),
      estado: z.enum(ESTADOS_PUBLICACION).optional(),
      motivo: texto.nullable().optional(),
    }),
  ),
})

const esquemaEventos = z.object({
  eventos: lista(z.object({ codigo: z.string().min(1), tipo: z.literal('nota'), texto: z.string().trim().min(1).max(2000) })),
})

function validar<T>(esquema: z.ZodType<T>, cuerpo: unknown): { ok: true; datos: T } | { ok: false; respuesta: RespuestaApi } {
  const r = esquema.safeParse(cuerpo)
  if (r.success) return { ok: true, datos: r.data }
  const detalle = r.error.issues.slice(0, 20).map((i) => ({ ruta: i.path.join('.'), mensaje: i.message }))
  return { ok: false, respuesta: error(400, 'cuerpo_invalido', 'El cuerpo de la petición no cumple el contrato.', detalle) }
}

const RECURSOS: Record<string, 'GET' | 'POST'> = {
  pendientes: 'GET',
  confirmaciones: 'POST',
  lote: 'POST',
  productos: 'POST',
  publicaciones: 'POST',
  eventos: 'POST',
}

export async function atenderPeticion(repo: RepoFerreteria, pet: PeticionApi): Promise<RespuestaApi> {
  const metodoEsperado = RECURSOS[pet.recurso]
  if (!metodoEsperado) return error(404, 'recurso_desconocido', `No existe /api/ferreteria/${pet.recurso}.`)
  if (pet.metodo.toUpperCase() !== metodoEsperado) {
    return error(405, 'metodo_no_permitido', `${pet.recurso} se usa con ${metodoEsperado}.`)
  }

  // ── Autenticación: un valor ausente nunca autoriza ──
  const token = tokenDeCabecera(pet.authorization)
  if (!token) return error(401, 'sin_token', 'Falta la cabecera Authorization: Bearer fer_...')
  const fila = await repo.buscarTokenPorHash(hashToken(token))
  if (!fila || fila.revocado_at) return error(401, 'token_invalido', 'El token no existe o fue revocado.')
  if (!(await repo.moduloActivo(fila.workspace_id))) {
    return error(403, 'modulo_no_activo', 'El workspace del token no tiene activo el módulo Ferretería.')
  }
  await repo.marcarUsoToken(fila.id, pet.ahora)

  const ws = fila.workspace_id
  const autor: Autor = { tipo: fila.escritor, id: null, nombre: fila.nombre }

  switch (pet.recurso) {
    case 'pendientes': {
      const pendientes = await listarPendientes(repo, ws)
      return { status: 200, cuerpo: { generado_at: pet.ahora, pendientes } }
    }

    case 'confirmaciones': {
      const v = validar(esquemaConfirmaciones, pet.cuerpo)
      if (!v.ok) return v.respuesta
      const resultados = []
      for (const c of v.datos.confirmaciones) resultados.push(await confirmarCambio(repo, ws, c, { autor, ahora: pet.ahora }))
      return { status: 200, cuerpo: { resultados } }
    }

    case 'lote': {
      const v = validar(esquemaLote, pet.cuerpo)
      if (!v.ok) return v.respuesta
      if (v.datos.mediciones.length === 0 && v.datos.conversaciones.length === 0) {
        return error(400, 'lote_vacio', 'El lote no trae mediciones ni conversaciones.')
      }
      const r = await registrarLote(repo, ws, v.datos, { autor, ahora: pet.ahora })
      return { status: 200, cuerpo: r }
    }

    case 'productos': {
      const v = validar(esquemaProductos, pet.cuerpo)
      if (!v.ok) return v.respuesta
      const resultados = []
      for (const p of v.datos.productos) {
        const r = await guardarProducto(repo, ws, p, pet.ahora)
        resultados.push(r.ok ? { sku: p.sku, estado: r.estado } : { sku: p.sku, estado: 'rechazado', codigo: r.codigo, mensaje: r.mensaje })
      }
      return { status: 200, cuerpo: { resultados } }
    }

    case 'publicaciones': {
      const v = validar(esquemaPublicaciones, pet.cuerpo)
      if (!v.ok) return v.respuesta
      const resultados = []
      for (const p of v.datos.publicaciones) {
        const r = await guardarPublicacion(repo, ws, p, { origen: 'canal', autor, ahora: pet.ahora })
        resultados.push(
          r.ok
            ? { codigo: p.codigo, estado: r.estado, ganancia: r.ganancia, pendiente_en_canal: r.pendiente_en_canal }
            : { codigo: p.codigo, estado: 'rechazada', codigo_error: r.codigo, mensaje: r.mensaje },
        )
      }
      return { status: 200, cuerpo: { resultados } }
    }

    case 'eventos': {
      const v = validar(esquemaEventos, pet.cuerpo)
      if (!v.ok) return v.respuesta
      const resultados = []
      for (const e of v.datos.eventos) {
        const pub = await repo.publicacionPorCodigo(ws, e.codigo)
        if (!pub) {
          resultados.push({ codigo: e.codigo, estado: 'rechazado', mensaje: 'La publicación no existe en ONE.' })
          continue
        }
        const r = await agregarNota(repo, ws, pub, e.texto, autor)
        resultados.push(r.ok ? { codigo: e.codigo, estado: 'registrado' } : { codigo: e.codigo, estado: 'rechazado', mensaje: r.mensaje })
      }
      return { status: 200, cuerpo: { resultados } }
    }
  }
  return error(404, 'recurso_desconocido', `No existe /api/ferreteria/${pet.recurso}.`)
}
