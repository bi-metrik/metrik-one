import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { leerPeriodoEnConcepto } from '@/lib/cobros/periodo-en-concepto'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { despuesDeResponder } from '@/lib/segundo-plano'
import { createServiceClient } from '@/lib/supabase/server'
import { rutaFactura } from '@/lib/valida-cda/factura-cuota'
import { BUCKET_DOCUMENTOS_SERVICIO } from '@/lib/valida-api/recibo-manual'
import { facturacionEncendida, leerConfigFacturacion, type ConfigFacturacion } from './config'
import {
  armarFactura,
  armarNotaCredito,
  decidirFacturable,
  leerComprador,
  ORIGENES_AUTOMATICOS,
  type ConceptoNotaCredito,
  type ContextoCobro,
  type EmpresaCompradora,
} from './documento'
import { procesarEmision, type CambiosEmision, type DepsEmision, type Emision, type MotivoAlerta, type RepoEmision, type ResultadoEmision } from './emision'
import { clienteMuisca, type ClienteMuisca, type ResolucionMuisca } from './muisca'

/**
 * El lado de Supabase de la factura electrónica automática, y las tres entradas:
 *
 *   · `facturarCobroTrasPago(cobroId)`: la llama el registro de un pago en línea (webhook de Bold o
 *     ePayco, y el cobro con tarjeta del cron, que pasa por el mismo `procesarEventoPasarela`).
 *     Encola y, DESPUÉS de responder, intenta emitir. Nunca lanza: el pago ya quedó.
 *   · `procesarFacturasPendientes()`: el cron. Barre los cobros pagados que se quedaron sin fila (un
 *     pago confirmado a mano, o un encolado que falló) y trabaja las filas que tocan.
 *   · `encolarNotaCredito(...)`: la nota crédito de una factura ya emitida (hoy nadie la llama sola:
 *     una devolución la decide una persona).
 *
 * Todo con el cliente de SERVICIO: `facturas_electronicas` y `facturacion_numeracion` son server-only.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const COLUMNAS =
  'id, workspace_id, cobro_id, tipo, modo, estado, prefijo, consecutivo, numero, proveedor_documento_id, cufe, fecha_emision, intentos, alerta_motivo, factura_origen_id, concepto_nota, motivo_nota, monto_nota'

type Fila = {
  id: string
  workspace_id: string
  cobro_id: string
  tipo: 'factura' | 'nota_credito'
  modo: Emision['modo']
  estado: Emision['estado']
  prefijo: string | null
  consecutivo: number | string | null
  numero: string | null
  proveedor_documento_id: string | null
  cufe: string | null
  fecha_emision: string | null
  intentos: number
  alerta_motivo: string | null
  factura_origen_id: string | null
  concepto_nota: string | null
  motivo_nota: string | null
  monto_nota: number | string | null
}

function aEmision(f: Fila): Emision {
  return {
    id: f.id,
    workspaceId: f.workspace_id,
    cobroId: f.cobro_id,
    tipo: f.tipo,
    modo: f.modo,
    estado: f.estado,
    prefijo: f.prefijo,
    consecutivo: f.consecutivo === null ? null : Number(f.consecutivo),
    numero: f.numero,
    proveedorDocumentoId: f.proveedor_documento_id,
    cufe: f.cufe,
    fechaEmision: f.fecha_emision,
    intentos: f.intentos,
    alertaMotivo: f.alerta_motivo,
  }
}

const RECLAMO_MS = 3 * 60_000

const llaveFactura = (cobroId: string, modo: string) => `factura:${cobroId}:${modo}`

// ── El contexto de un cobro ──────────────────────────────────────────────────────────────────

interface Contexto extends ContextoCobro {
  negocioId: string | null
  empresa: EmpresaCompradora | null
  correoFacturacion: string | null
  referenciaPago: string | null
  periodo: { desde: string; hasta: string } | null
}

async function contextoDelCobro(db: Db, cobroId: string): Promise<Contexto | null> {
  const c = await db
    .from('cobros')
    .select('id, workspace_id, negocio_id, monto, fecha, external_ref, anulado_at, plan_cobro_id, numero_cuota')
    .eq('id', cobroId)
    .maybeSingle()
  if (c.error) throw new Error(`leer cobro ${cobroId}: ${c.error.message}`)
  if (!c.data) return null
  const cobro = c.data as {
    id: string
    workspace_id: string
    negocio_id: string | null
    monto: number | string | null
    fecha: string | null
    external_ref: string | null
    anulado_at: string | null
    plan_cobro_id: string | null
    numero_cuota: number | null
  }

  let origenNegocio: string | null = null
  let contrato: { empresa_id: string; correo_facturacion: string | null; servicio_slug: string } | null = null
  let contratos = 0
  if (cobro.negocio_id) {
    const [n, sc] = await Promise.all([
      db.from('negocios').select('metadata').eq('id', cobro.negocio_id).maybeSingle(),
      db
        .from('servicios_contratados')
        .select('empresa_id, correo_facturacion, servicio_slug')
        .eq('negocio_id', cobro.negocio_id)
        .eq('workspace_id', cobro.workspace_id)
        .limit(2),
    ])
    if (n.error) throw new Error(`leer negocio: ${n.error.message}`)
    if (sc.error) throw new Error(`leer contrato: ${sc.error.message}`)
    const meta = (n.data?.metadata ?? null) as { origen?: unknown } | null
    origenNegocio = typeof meta?.origen === 'string' ? meta.origen : null
    contratos = (sc.data ?? []).length
    // Un negocio por contrato (§3.5). Dos = ambiguo: no se adivina a quién facturar.
    if (contratos === 1) contrato = sc.data[0]
  }

  let modulo: string | null = null
  let empresa: EmpresaCompradora | null = null
  if (contrato) {
    const [cs, em] = await Promise.all([
      db.from('catalogo_servicios').select('modulo').eq('slug', contrato.servicio_slug).maybeSingle(),
      db
        .from('empresas')
        .select('razon_social, nombre, tipo_documento, numero_documento, tipo_persona, regimen_tributario, responsable_iva, gran_contribuyente, autorretenedor, agente_retenedor, telefono')
        .eq('id', contrato.empresa_id)
        .maybeSingle(),
    ])
    if (cs.error) throw new Error(`leer ficha: ${cs.error.message}`)
    if (em.error) throw new Error(`leer empresa: ${em.error.message}`)
    modulo = (cs.data?.modulo as string | undefined) ?? null
    empresa = (em.data as EmpresaCompradora | null) ?? null
  }

  // ¿Ya se facturó a mano? La factura del cobro, o la de su cuota (los CDA).
  const yaCobro = await db.from('facturas_cobro').select('id').eq('cobro_id', cobro.id).limit(1)
  if (yaCobro.error) throw new Error(`leer facturas_cobro: ${yaCobro.error.message}`)
  let yaFacturadoAMano = (yaCobro.data ?? []).length > 0
  let periodo: Contexto['periodo'] = null
  if (cobro.plan_cobro_id && cobro.numero_cuota !== null) {
    const cu = await db
      .from('plan_cobro_cuotas')
      .select('id, concepto_detalle, fecha_vencimiento')
      .eq('plan_cobro_id', cobro.plan_cobro_id)
      .eq('numero', cobro.numero_cuota)
      .maybeSingle()
    if (cu.error) throw new Error(`leer cuota: ${cu.error.message}`)
    if (cu.data) {
      const fc = await db.from('facturas_cuota').select('id').eq('plan_cobro_cuota_id', cu.data.id).limit(1)
      if (fc.error) throw new Error(`leer facturas_cuota: ${fc.error.message}`)
      yaFacturadoAMano = yaFacturadoAMano || (fc.data ?? []).length > 0
      const p = leerPeriodoEnConcepto(cu.data.concepto_detalle ?? null, cu.data.fecha_vencimiento ?? null)
      if (p?.desde && p.hasta) periodo = { desde: p.desde, hasta: p.hasta }
    }
  }

  return {
    cobroId: cobro.id,
    workspaceId: cobro.workspace_id,
    monto: Math.round(Number(cobro.monto ?? 0)),
    fecha: cobro.fecha,
    anulado: !!cobro.anulado_at,
    modulo,
    origenNegocio,
    tieneContrato: contrato !== null,
    yaFacturadoAMano,
    negocioId: cobro.negocio_id,
    empresa,
    correoFacturacion: contrato?.correo_facturacion ?? null,
    referenciaPago: cobro.external_ref,
    periodo,
  }
}

// ── Encolar ──────────────────────────────────────────────────────────────────────────────────

export type ResultadoEncolar = { tipo: 'encolada'; id: string } | { tipo: 'no_aplica'; motivo: string }

async function encolarFacturaDeCobro(db: Db, cobroId: string, cfg: ConfigFacturacion): Promise<ResultadoEncolar> {
  const ctx = await contextoDelCobro(db, cobroId)
  if (!ctx) return { tipo: 'no_aplica', motivo: 'El cobro no existe.' }
  const d = decidirFacturable(ctx, cfg.emisorWorkspaceId, cfg.desde)
  if (!d.facturable) return { tipo: 'no_aplica', motivo: d.motivo }

  const llave = llaveFactura(cobroId, cfg.modo)
  // ON CONFLICT (llave) DO NOTHING: el segundo encolado no crea otra fila.
  const ins = await db
    .from('facturas_electronicas')
    .upsert(
      { workspace_id: ctx.workspaceId, cobro_id: cobroId, tipo: 'factura', llave, modo: cfg.modo },
      { onConflict: 'llave', ignoreDuplicates: true },
    )
  if (ins.error) throw new Error(`encolar factura de ${cobroId}: ${ins.error.message}`)
  const fila = await db.from('facturas_electronicas').select('id').eq('llave', llave).maybeSingle()
  if (fila.error || !fila.data) throw new Error(`leer la emisión de ${cobroId}: ${fila.error?.message ?? 'no quedó'}`)
  return { tipo: 'encolada', id: fila.data.id as string }
}

export interface EncolarNota {
  facturaEmisionId: string
  conceptoNota: ConceptoNotaCredito
  motivo: string
  /** Lo que identifica la corrección en quien la pide (p. ej. el id de la devolución). */
  llave: string
  /** Sin monto, la nota es por el total de la factura. */
  monto?: number
}

export async function encolarNotaCredito(db: Db, n: EncolarNota): Promise<ResultadoEncolar> {
  const f = await db.from('facturas_electronicas').select(COLUMNAS).eq('id', n.facturaEmisionId).maybeSingle()
  if (f.error) throw new Error(`leer factura: ${f.error.message}`)
  const factura = f.data as Fila | null
  if (!factura || factura.tipo !== 'factura') return { tipo: 'no_aplica', motivo: 'No es una factura electrónica de ONE.' }
  if (factura.estado !== 'emitida' && factura.estado !== 'archivada') {
    return { tipo: 'no_aplica', motivo: 'La factura no está emitida: una nota crédito no corrige un documento que la DIAN no validó.' }
  }
  if (!n.motivo.trim()) return { tipo: 'no_aplica', motivo: 'La nota crédito necesita un motivo.' }
  const llave = `nota:${factura.id}:${n.llave}`
  const ins = await db.from('facturas_electronicas').upsert(
    {
      workspace_id: factura.workspace_id,
      cobro_id: factura.cobro_id,
      tipo: 'nota_credito',
      factura_origen_id: factura.id,
      llave,
      modo: factura.modo,
      concepto_nota: n.conceptoNota,
      motivo_nota: n.motivo.trim().slice(0, 500),
      monto_nota: n.monto ?? null,
    },
    { onConflict: 'llave', ignoreDuplicates: true },
  )
  if (ins.error) throw new Error(`encolar nota crédito: ${ins.error.message}`)
  const fila = await db.from('facturas_electronicas').select('id').eq('llave', llave).maybeSingle()
  if (fila.error || !fila.data) throw new Error(`leer la nota: ${fila.error?.message ?? 'no quedó'}`)
  return { tipo: 'encolada', id: fila.data.id as string }
}

// ── El repositorio del motor ─────────────────────────────────────────────────────────────────

function cambiosAFila(c: CambiosEmision): Record<string, unknown> {
  const m: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const mapa: Record<keyof CambiosEmision, string> = {
    estado: 'estado',
    intentos: 'intentos',
    proximoIntentoAt: 'proximo_intento_at',
    ultimoError: 'ultimo_error',
    proveedorDocumentoId: 'proveedor_documento_id',
    cufe: 'cufe',
    numero: 'numero',
    fechaEmision: 'fecha_emision',
    alertaMotivo: 'alerta_motivo',
    enviado: 'enviado',
    respuesta: 'respuesta',
    pdfPath: 'pdf_path',
    pdfSha256: 'pdf_sha256',
    xmlPath: 'xml_path',
    xmlSha256: 'xml_sha256',
  }
  for (const [k, v] of Object.entries(c)) {
    if (v === undefined) continue
    const col = mapa[k as keyof CambiosEmision]
    m[col] = k === 'ultimoError' && typeof v === 'string' ? v.slice(0, 1000) : v
  }
  return m
}

const TITULOS: Record<MotivoAlerta, string> = {
  rechazada: 'Factura electrónica rechazada',
  sin_numeracion: 'Factura electrónica sin numeración',
  datos: 'Factura electrónica sin datos del comprador',
  no_autorizado: 'Aliaddo rechazó el token',
  sin_resolucion: 'Aliaddo sin la resolución',
  consecutivo_ocupado: 'Consecutivo ocupado en Aliaddo',
  reintentos: 'Factura electrónica sin salir',
  archivos: 'Factura emitida sin archivos en ONE',
}

function repoEmisionSupabase(db: Db, cfg: ConfigFacturacion): RepoEmision {
  return {
    async reclamar(id) {
      const ahora = new Date()
      const r = await db
        .from('facturas_electronicas')
        .update({ reclamada_hasta: new Date(ahora.getTime() + RECLAMO_MS).toISOString() })
        .eq('id', id)
        .or(`reclamada_hasta.is.null,reclamada_hasta.lt."${ahora.toISOString()}"`)
        .select(COLUMNAS)
        .maybeSingle()
      if (r.error) throw new Error(`reclamar emisión ${id}: ${r.error.message}`)
      return r.data ? aEmision(r.data as Fila) : null
    },

    async soltar(id) {
      const r = await db.from('facturas_electronicas').update({ reclamada_hasta: null }).eq('id', id)
      if (r.error) console.error(`[factura-electronica] no se pudo soltar ${id}: ${r.error.message}`)
    },

    async asignarConsecutivo(id) {
      const r = await db.rpc('facturacion_asignar_consecutivo', { p_emision_id: id })
      if (r.error) {
        const m = String(r.error.message ?? '')
        if (m.includes('sin_numeracion')) {
          return { ok: false, motivo: 'sin_numeracion', detalle: `No hay numeración de ${cfg.modo} cargada en facturacion_numeracion.` }
        }
        if (m.includes('rango_agotado')) {
          return { ok: false, motivo: 'rango_agotado', detalle: `Se agotó el rango autorizado de ${cfg.modo}: hay que pedir otra resolución.` }
        }
        return { ok: false, motivo: 'error', detalle: `No se pudo asignar el consecutivo: ${m}` }
      }
      const fila = (Array.isArray(r.data) ? r.data[0] : r.data) as { prefijo: string; consecutivo: number | string } | null
      if (!fila) return { ok: false, motivo: 'error', detalle: 'La numeración no devolvió número.' }
      return { ok: true, numeracion: { prefijo: fila.prefijo, consecutivo: Number(fila.consecutivo) } }
    },

    async preparar(e) {
      const f = await db.from('facturas_electronicas').select(COLUMNAS).eq('id', e.id).maybeSingle()
      if (f.error || !f.data) return { ok: false, problema: `No se pudo leer la emisión: ${f.error?.message ?? 'no existe'}` }
      const fila = f.data as Fila
      const ctx = await contextoDelCobro(db, e.cobroId)
      if (!ctx) return { ok: false, problema: 'El cobro ya no existe.' }
      if (!ctx.empresa) return { ok: false, problema: 'El cobro no tiene la empresa del contrato.' }
      const comp = leerComprador(ctx.empresa, ctx.correoFacturacion)
      if (!comp.ok) return { ok: false, problema: comp.problema }
      // Una factura cargada a mano entre el encolado y el envío frena la automática (serían dos).
      // En una nota no cuenta: la factura que corrige es la nuestra, ya publicada en facturas_cobro.
      const d = decidirFacturable({ ...ctx, yaFacturadoAMano: e.tipo === 'factura' && ctx.yaFacturadoAMano }, cfg.emisorWorkspaceId, null)
      if (!d.facturable) return { ok: false, problema: d.motivo }
      const hoy = todayBogotaISO()

      if (e.tipo === 'factura') {
        if (!ctx.fecha) return { ok: false, problema: 'El cobro no está pagado.' }
        const fechaPago = ctx.fecha
        return {
          ok: true,
          preparado: {
            identificacionComprador: comp.comprador.identificacion,
            monto: ctx.monto,
            prefijoResolucion: (n) => n.prefijo,
            armar: ({ prefijo, consecutivo, resolucion }) =>
              armarFactura({
                modo: e.modo,
                testSetId: cfg.testSetId,
                prefijo,
                consecutivo,
                resolucion,
                comprador: comp.comprador,
                concepto: d.concepto,
                monto: ctx.monto,
                fechaPago,
                hoy,
                periodo: ctx.periodo,
                // ONE no distingue hoy tarjeta de PSE en el cobro: medio «no definido» (código 1).
                medioPago: 'no_definido',
                referenciaPago: ctx.referenciaPago,
                cobroId: ctx.cobroId,
              }),
          },
        }
      }

      // Nota crédito: la factura que corrige.
      const o = await db.from('facturas_electronicas').select(COLUMNAS).eq('id', fila.factura_origen_id).maybeSingle()
      const origen = o.data as Fila | null
      if (o.error || !origen || !origen.cufe || !origen.numero || !origen.fecha_emision || !origen.prefijo || origen.consecutivo === null) {
        return { ok: false, problema: 'La factura que corrige la nota no está emitida.' }
      }
      const monto = fila.monto_nota === null ? ctx.monto : Math.round(Number(fila.monto_nota))
      if (monto > ctx.monto) return { ok: false, problema: `La nota ($${monto}) supera la factura ($${ctx.monto}).` }
      return {
        ok: true,
        preparado: {
          identificacionComprador: comp.comprador.identificacion,
          monto,
          // La doc manda la resolución de la factura también en la nota.
          prefijoResolucion: origen.prefijo,
          armar: ({ prefijo, consecutivo, resolucion }) =>
            armarNotaCredito({
              modo: e.modo,
              testSetId: cfg.testSetId,
              prefijo,
              consecutivo,
              resolucion,
              comprador: comp.comprador,
              concepto: d.concepto,
              monto,
              hoy,
              medioPago: 'no_definido',
              cobroId: ctx.cobroId,
              factura: {
                prefijo: origen.prefijo as string,
                consecutivo: Number(origen.consecutivo),
                numero: origen.numero as string,
                cufe: origen.cufe as string,
                fechaEmision: origen.fecha_emision as string,
              },
              conceptoNota: fila.concepto_nota as ConceptoNotaCredito,
              motivo: fila.motivo_nota ?? '',
            }),
        },
      }
    },

    async guardar(id, cambios) {
      const r = await db.from('facturas_electronicas').update(cambiosAFila(cambios)).eq('id', id)
      if (r.error) throw new Error(`guardar emisión ${id}: ${r.error.message}`)
    },

    async guardarArchivos(e, archivos) {
      const salida = { pdfPath: null as string | null, pdfSha: null as string | null, xmlPath: null as string | null, xmlSha: null as string | null }
      for (const clase of ['pdf', 'xml'] as const) {
        const bytes = archivos[clase]
        if (!bytes || bytes.length === 0) continue
        const sha = createHash('sha256').update(bytes).digest('hex')
        const ruta = rutaFactura(e.workspaceId, sha, clase)
        const subida = await db.storage.from(BUCKET_DOCUMENTOS_SERVICIO).upload(ruta, bytes, {
          contentType: clase === 'pdf' ? 'application/pdf' : 'application/xml',
          upsert: false,
        })
        // Por huella: si ya existe, es EL MISMO archivo.
        if (subida.error && !/exists|duplicate/i.test(subida.error.message)) {
          throw new Error(`guardar ${clase} de ${e.numero}: ${subida.error.message}`)
        }
        if (clase === 'pdf') Object.assign(salida, { pdfPath: ruta, pdfSha: sha })
        else Object.assign(salida, { xmlPath: ruta, xmlSha: sha })
      }
      return salida
    },

    async publicar(e, rutas) {
      // Solo la factura real: una de Test o de Habilitación no tiene efecto legal y no la ve el cliente.
      if (e.modo !== 'Production' || e.tipo !== 'factura' || !e.numero || !e.cufe || !e.fechaEmision) return
      if (!rutas.pdfPath && !rutas.xmlPath) return
      const r = await db.from('facturas_cobro').upsert(
        {
          workspace_id: e.workspaceId,
          cobro_id: e.cobroId,
          numero: e.numero,
          cufe: e.cufe,
          fecha_emision: e.fechaEmision,
          pdf_path: rutas.pdfPath,
          pdf_sha256: rutas.pdfSha,
          xml_path: rutas.xmlPath,
          xml_sha256: rutas.xmlSha,
        },
        { onConflict: 'cobro_id', ignoreDuplicates: true },
      )
      if (r.error) throw new Error(`publicar ${e.numero} en facturas_cobro: ${r.error.message}`)
    },

    async alertar(e, motivo, detalle) {
      const texto = `${TITULOS[motivo]} (${e.numero ?? `cobro ${e.cobroId.slice(0, 8)}`}, ${e.modo}): ${detalle}`
      console.error(`[factura-electronica] ${texto}`)
      const c = await db.from('cobros').select('negocio_id').eq('id', e.cobroId).maybeSingle()
      const negocioId = (c.data?.negocio_id as string | null | undefined) ?? null
      const perfiles = await db.from('profiles').select('id').eq('workspace_id', e.workspaceId).in('role', ['owner', 'admin'])
      if (perfiles.error) {
        console.error(`[factura-electronica] no se pudo leer a quién avisar: ${perfiles.error.message}`)
      } else {
        const filas = ((perfiles.data ?? []) as { id: string }[]).map((p) => ({
          workspace_id: e.workspaceId,
          destinatario_id: p.id,
          tipo: 'factura_electronica',
          estado: 'pendiente',
          contenido: texto.slice(0, 500),
          entidad_tipo: null,
          entidad_id: null,
          deep_link: negocioId ? `/negocios/${negocioId}` : null,
          metadata: { factura_electronica_id: e.id, cobro_id: e.cobroId, motivo },
        }))
        if (filas.length > 0) {
          const ins = await db.from('notificaciones').insert(filas)
          if (ins.error) console.error(`[factura-electronica] no se pudo crear el aviso: ${ins.error.message}`)
        }
      }
      if (negocioId) {
        await registrarActividad(
          db,
          {
            workspace_id: e.workspaceId,
            entidad_tipo: 'negocio',
            entidad_id: negocioId,
            tipo: 'sistema',
            autor_id: null,
            contenido: texto.slice(0, 280),
          },
          'factura-electronica',
        )
      }
    },
  }
}

// ── Las dependencias reales ──────────────────────────────────────────────────────────────────

const CACHE_RESOLUCIONES_MS = 10 * 60_000
let cacheResoluciones: { token: string; hasta: number; lista: ResolucionMuisca[] } | null = null

function depsReales(db: Db, cfg: ConfigFacturacion, muisca?: ClienteMuisca): DepsEmision {
  const cliente = muisca ?? clienteMuisca({ token: cfg.token, apiUrl: cfg.apiUrl, archivosUrl: cfg.archivosUrl })
  return {
    repo: repoEmisionSupabase(db, cfg),
    muisca: cliente,
    ahora: () => new Date(),
    async resolucion(prefijo) {
      const ahora = Date.now()
      if (!cacheResoluciones || cacheResoluciones.token !== cfg.token || cacheResoluciones.hasta < ahora) {
        const r = await cliente.resoluciones()
        if (!r.ok) {
          console.error(`[factura-electronica] no se pudieron leer las resoluciones: ${r.mensaje}`)
          return null
        }
        cacheResoluciones = { token: cfg.token, hasta: ahora + CACHE_RESOLUCIONES_MS, lista: r.resoluciones }
      }
      return cacheResoluciones.lista.find((x) => x.prefix === prefijo) ?? null
    },
  }
}

// ── Entradas ─────────────────────────────────────────────────────────────────────────────────

/**
 * Tras registrar un pago en línea. Apagada = no hace nada. Encola (idempotente) y emite DESPUÉS de
 * responder (`after()`), para que la pasarela no espere a la DIAN. Nunca lanza: si algo falla, el
 * barrido del cron la encuentra (el cobro quedó pagado y sin fila).
 */
export async function facturarCobroTrasPago(db: SupabaseClient, cobroId: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  if (!facturacionEncendida(env)) return
  try {
    const lectura = leerConfigFacturacion(env)
    if (!lectura.ok) {
      console.error(`[factura-electronica] encendida pero sin configurar: ${lectura.detalle}`)
      return
    }
    const r = await encolarFacturaDeCobro(db, cobroId, lectura.config)
    if (r.tipo !== 'encolada') return
    const deps = depsReales(db, lectura.config)
    despuesDeResponder(`factura-electronica ${cobroId}`, () => procesarEmision(r.id, deps))
  } catch (e) {
    console.error(`[factura-electronica] no se pudo encolar la factura del cobro ${cobroId}:`, (e as Error)?.message ?? e)
  }
}

/** Cobros pagados desde `desde`, de los orígenes automáticos, que no tienen fila en este modo. */
async function cobrosSinFila(db: Db, cfg: ConfigFacturacion, limite: number): Promise<string[]> {
  if (!cfg.desde) return []
  const n = await db
    .from('negocios')
    .select('id')
    .eq('workspace_id', cfg.emisorWorkspaceId)
    .in('metadata->>origen', ORIGENES_AUTOMATICOS as unknown as string[])
    .limit(1000)
  if (n.error) throw new Error(`barrido, negocios: ${n.error.message}`)
  const negocios = ((n.data ?? []) as { id: string }[]).map((x) => x.id)
  const candidatos: string[] = []
  // De a 100: un `.in()` con cientos de uuid rompe la URL.
  for (let i = 0; i < negocios.length && candidatos.length < limite; i += 100) {
    const c = await db
      .from('cobros')
      .select('id')
      .eq('workspace_id', cfg.emisorWorkspaceId)
      .in('negocio_id', negocios.slice(i, i + 100))
      .gte('fecha', cfg.desde)
      .is('anulado_at', null)
      .gt('monto', 0)
      .limit(500)
    if (c.error) throw new Error(`barrido, cobros: ${c.error.message}`)
    const ids = ((c.data ?? []) as { id: string }[]).map((x) => x.id)
    if (ids.length === 0) continue
    const ya = await db.from('facturas_electronicas').select('cobro_id').eq('tipo', 'factura').eq('modo', cfg.modo).in('cobro_id', ids)
    if (ya.error) throw new Error(`barrido, emisiones: ${ya.error.message}`)
    const con = new Set(((ya.data ?? []) as { cobro_id: string }[]).map((x) => x.cobro_id))
    candidatos.push(...ids.filter((id) => !con.has(id)))
  }
  return candidatos.slice(0, limite)
}

export interface ResumenCron {
  estado: 'apagada' | 'sin_configurar' | 'corrida'
  detalle?: string
  encoladas: number
  noAplica: number
  resultados: ResultadoEmision[]
  errores: string[]
}

export async function procesarFacturasPendientes(
  opciones: { db?: Db; env?: Record<string, string | undefined>; presupuestoMs?: number; muisca?: ClienteMuisca } = {},
): Promise<ResumenCron> {
  const env = opciones.env ?? process.env
  const vacio = { encoladas: 0, noAplica: 0, resultados: [], errores: [] }
  if (!facturacionEncendida(env)) return { estado: 'apagada', ...vacio }
  const lectura = leerConfigFacturacion(env)
  if (!lectura.ok) return { estado: 'sin_configurar', detalle: lectura.detalle, ...vacio }
  const cfg = lectura.config
  const db = opciones.db ?? createServiceClient()
  const fin = Date.now() + (opciones.presupuestoMs ?? 45_000)
  const resumen: ResumenCron = { estado: 'corrida', encoladas: 0, noAplica: 0, resultados: [], errores: [] }

  // 1. El barrido: lo pagado que no tiene fila.
  try {
    for (const cobroId of await cobrosSinFila(db, cfg, 50)) {
      try {
        const r = await encolarFacturaDeCobro(db, cobroId, cfg)
        if (r.tipo === 'encolada') resumen.encoladas += 1
        else resumen.noAplica += 1
      } catch (e) {
        resumen.errores.push((e as Error).message)
      }
    }
  } catch (e) {
    resumen.errores.push((e as Error).message)
  }

  // 2. Lo que toca trabajar, del modo de este despliegue.
  const q = await db
    .from('facturas_electronicas')
    .select('id')
    .eq('modo', cfg.modo)
    .eq('workspace_id', cfg.emisorWorkspaceId)
    .in('estado', ['pendiente', 'enviada', 'emitida'])
    .lte('proximo_intento_at', new Date().toISOString())
    .order('proximo_intento_at', { ascending: true })
    .limit(50)
  if (q.error) {
    resumen.errores.push(`leer emisiones: ${q.error.message}`)
    return resumen
  }
  const deps = depsReales(db, cfg, opciones.muisca)
  for (const { id } of (q.data ?? []) as { id: string }[]) {
    if (Date.now() > fin) break
    try {
      resumen.resultados.push(await procesarEmision(id, deps))
    } catch (e) {
      resumen.errores.push(`${id}: ${(e as Error).message}`)
    }
  }
  return resumen
}
