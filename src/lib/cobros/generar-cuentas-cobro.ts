/**
 * Lógica core de generación de cuentas de cobro mensuales.
 *
 * Diseñado para ser llamado desde:
 *   - Server action (UI manual) — pasa supabase client de usuario
 *   - Cron job — pasa supabase service role client
 *
 * NO contiene 'use server' directive — el wrapper lo agrega si aplica.
 *
 * Flujo `generarCuentasCobroPeriodo(supabase, workspaceId, anio, mes, options)`:
 *   1. Lee planes_cobro activos cuya frecuencia coincide con el período
 *   2. Calcula numero_cuota para cada plan según fecha_inicio
 *   3. UPSERT cobros programados (idempotente via unique index plan+cuota)
 *   4. Agrupa cobros por empresa_id del negocio
 *   5. Por cada grupo:
 *      a. Construye payload para PDF render
 *      b. Llama metrik-pdf-render
 *      c. Sube PDF a subcarpeta "4. Cuentas de cobro" del negocio principal
 *      d. Inserta cuentas_cobro_emitidas con estado='emitida_pendiente_aprobacion'
 *      e. Asocia planilla_pila_periodo del mes si existe
 *      f. Notificación in-app a Mauricio (owner del workspace)
 *
 * Refs:
 *   - cerebro/conceptos/cobros-recurrentes-metrik.md
 *   - cerebro/reglas/cuenta-cobro-persona-natural-mauricio.md
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { renderCuentaCobro, type CuentaCobroConcepto } from '@/lib/pdf/pdf-render-client'
import { createDriveFolder, uploadFileToDrive } from '@/lib/google-drive'
import { EMISOR_MAURICIO, getAnioGravableDeclaracion } from './emisor-mauricio'
import { formatCOP, formatFechaLetras, montoEnLetrasCOP } from './format'

const SUBFOLDER_CUENTAS = '4. Cuentas de cobro'
const TEMPLATE_SLUG = 'metrik'

export type GenerarCuentasOptions = {
  /** Si true, no inserta nada en DB ni envia PDF — solo retorna el preview de los payloads */
  dryRun?: boolean
  /** Si true, marca las cuentas con watermark BORRADOR en el PDF */
  isDraft?: boolean
  /** Fecha de emisión override (default: día 15 del mes target). YYYY-MM-DD */
  fechaEmisionOverride?: string
}

export type GenerarCuentasResult = {
  cuentasCreadas: number
  cuentasOmitidas: number  // ya existían
  errores: { empresa_id: string; error: string }[]
  detalles: {
    empresa_id: string
    empresa_nombre: string
    numero: string | null
    monto_total: number
    cobros_ids: string[]
    pdf_drive_url: string | null
    estado: 'creada' | 'omitida' | 'error'
  }[]
}

// ── Helpers internos ──────────────────────────────────────────────

/** Extrae folder_id de Drive URL: https://drive.google.com/drive/folders/{id}?usp=... */
function extractFolderIdFromUrl(url: string | null): string | null {
  if (!url) return null
  const m = url.match(/\/folders\/([-\w]+)/)
  return m ? m[1] : null
}

/** Calcula numero_cuota para un plan en un período mes/anio dado.
 * Asume frecuencia mensual. Cuota 1 = mes de fecha_inicio.
 * Retorna null si el período está fuera del rango del plan. */
function calcularNumeroCuota(
  fechaInicio: string,
  totalCuotas: number,
  anio: number,
  mes: number,
): number | null {
  const inicio = new Date(fechaInicio + 'T12:00:00Z')
  const inicioAnio = inicio.getUTCFullYear()
  const inicioMes = inicio.getUTCMonth() + 1
  const cuota = (anio - inicioAnio) * 12 + (mes - inicioMes) + 1
  if (cuota < 1 || cuota > totalCuotas) return null
  return cuota
}

/** Reemplaza {numero_cuota} y {total_cuotas} en el template */
function aplicarTemplateConceptoDetalle(
  template: string,
  numeroCuota: number,
  totalCuotas: number,
): string {
  return template
    .replace(/\{numero_cuota\}/g, String(numeroCuota))
    .replace(/\{total_cuotas\}/g, String(totalCuotas))
}

// ── Función principal ──────────────────────────────────────────────

type PlanRow = {
  id: string
  workspace_id: string
  negocio_id: string
  monto: number
  total_cuotas: number
  fecha_inicio: string
  fecha_fin: string
  concepto_detalle_template: string | null
}

type NegocioRow = {
  id: string
  codigo: string
  nombre: string
  empresa_id: string | null
  carpeta_url: string | null
}

type EmpresaRow = {
  id: string
  nombre: string
  razon_social: string | null
  numero_documento: string | null
  direccion_fiscal: string | null
  email_fiscal: string | null
  telefono: string | null
  contacto_nombre: string | null
}

export async function generarCuentasCobroPeriodo(
  supabase: SupabaseClient,
  workspaceId: string,
  anio: number,
  mes: number,
  options: GenerarCuentasOptions = {},
): Promise<GenerarCuentasResult> {
  const result: GenerarCuentasResult = {
    cuentasCreadas: 0,
    cuentasOmitidas: 0,
    errores: [],
    detalles: [],
  }

  // 1. Planes activos del workspace
  const { data: planes, error: pErr } = await supabase
    .from('planes_cobro')
    .select('id, workspace_id, negocio_id, monto, total_cuotas, fecha_inicio, fecha_fin, concepto_detalle_template')
    .eq('workspace_id', workspaceId)
    .eq('activo', true)
    .eq('frecuencia', 'mensual')

  if (pErr) throw new Error(`Error leyendo planes_cobro: ${pErr.message}`)
  if (!planes || planes.length === 0) return result

  // 2. Para cada plan, calcular numero_cuota del periodo
  const planesEnPeriodo = (planes as PlanRow[])
    .map(p => ({
      plan: p,
      numeroCuota: calcularNumeroCuota(p.fecha_inicio, p.total_cuotas, anio, mes),
    }))
    .filter(x => x.numeroCuota !== null) as { plan: PlanRow; numeroCuota: number }[]

  if (planesEnPeriodo.length === 0) return result

  // 3. UPSERT cobros programados (idempotente via unique index plan+cuota)
  const fechaEsperada = `${anio}-${String(mes).padStart(2, '0')}-15`

  for (const { plan, numeroCuota } of planesEnPeriodo) {
    if (options.dryRun) continue

    // Verificar si ya existe el cobro programado
    const { data: existing } = await supabase
      .from('cobros')
      .select('id')
      .eq('plan_cobro_id', plan.id)
      .eq('numero_cuota', numeroCuota)
      .maybeSingle()

    if (existing) continue // ya creado por cron o emision previa

    await supabase.from('cobros').insert({
      workspace_id: workspaceId,
      negocio_id: plan.negocio_id,
      plan_cobro_id: plan.id,
      numero_cuota: numeroCuota,
      tipo_cobro: 'programado',
      monto: plan.monto,
      fecha_esperada: fechaEsperada,
      vencido: false,
    })
  }

  // 4. Re-leer cobros programados del período con join a negocio + empresa
  const { data: cobros, error: cErr } = await supabase
    .from('cobros')
    .select(`
      id, plan_cobro_id, numero_cuota, monto, negocio_id, fecha_esperada,
      negocios:negocio_id (id, codigo, nombre, empresa_id, carpeta_url)
    `)
    .eq('workspace_id', workspaceId)
    .eq('tipo_cobro', 'programado')
    .eq('fecha_esperada', fechaEsperada)
    .is('fecha', null) // no pagados

  if (cErr) throw new Error(`Error leyendo cobros: ${cErr.message}`)
  if (!cobros) return result

  // 5. Mapa plan_id -> plan (para concepto_detalle_template)
  const planMap = new Map(planesEnPeriodo.map(x => [x.plan.id, x]))

  // 6. Agrupar cobros por empresa_id (del negocio)
  type CobroConNegocio = {
    id: string
    plan_cobro_id: string
    numero_cuota: number
    monto: number
    negocio_id: string
    negocios: NegocioRow | null
  }

  const grupos = new Map<string, CobroConNegocio[]>()
  for (const c of cobros as unknown as CobroConNegocio[]) {
    const empresaId = c.negocios?.empresa_id
    if (!empresaId) {
      result.errores.push({
        empresa_id: 'NO_EMPRESA',
        error: `Cobro ${c.id} sin empresa asociada al negocio ${c.negocio_id}`,
      })
      continue
    }
    if (!grupos.has(empresaId)) grupos.set(empresaId, [])
    grupos.get(empresaId)!.push(c)
  }

  // 7. Resolver datos de empresas (en lote)
  const empresaIds = Array.from(grupos.keys())
  const { data: empresas } = await supabase
    .from('empresas')
    .select('id, nombre, razon_social, numero_documento, direccion_fiscal, email_fiscal, telefono, contacto_nombre')
    .in('id', empresaIds)
  const empresaMap = new Map(((empresas ?? []) as EmpresaRow[]).map(e => [e.id, e]))

  // 8. Planilla PILA del periodo (opcional)
  const { data: pila } = await supabase
    .from('planillas_pila_periodo')
    .select('id, file_drive_url')
    .eq('workspace_id', workspaceId)
    .eq('anio', anio)
    .eq('mes', mes)
    .maybeSingle()

  const planillaPilaId = (pila as { id: string } | null)?.id ?? null
  const planillaPilaUrl = (pila as { file_drive_url: string } | null)?.file_drive_url ?? null

  // 9. Por cada grupo (empresa) → emitir cuenta
  const fechaEmision = options.fechaEmisionOverride ?? fechaEsperada
  const fechaVencimiento = fechaEsperada
  const anioGravable = getAnioGravableDeclaracion(new Date(fechaEmision + 'T12:00:00Z'))

  for (const [empresaId, cobrosGrupo] of grupos) {
    const empresa = empresaMap.get(empresaId)
    if (!empresa) {
      result.errores.push({ empresa_id: empresaId, error: 'Empresa no encontrada' })
      continue
    }

    try {
      // Idempotencia: skip si ya existe cuenta para esta empresa+periodo
      const { data: existingCuenta } = await supabase
        .from('cuentas_cobro_emitidas')
        .select('id, numero')
        .eq('workspace_id', workspaceId)
        .eq('anio', anio)
        .eq('mes', mes)
        .eq('empresa_id_pagador', empresaId)
        .maybeSingle()

      if (existingCuenta) {
        result.cuentasOmitidas++
        result.detalles.push({
          empresa_id: empresaId,
          empresa_nombre: empresa.razon_social ?? empresa.nombre,
          numero: (existingCuenta as { numero: string }).numero,
          monto_total: 0,
          cobros_ids: [],
          pdf_drive_url: null,
          estado: 'omitida',
        })
        continue
      }

      // Construir conceptos
      const conceptos: CuentaCobroConcepto[] = cobrosGrupo.map(c => {
        const planInfo = planMap.get(c.plan_cobro_id)
        const template = planInfo?.plan.concepto_detalle_template
          ?? `Cuota ${c.numero_cuota} — ${c.negocios?.nombre ?? 'Servicio'}`
        const totalCuotas = planInfo?.plan.total_cuotas ?? 0
        return {
          detalle: aplicarTemplateConceptoDetalle(template, c.numero_cuota, totalCuotas),
          monto: formatCOP(c.monto),
        }
      })

      const montoTotal = cobrosGrupo.reduce((sum, c) => sum + Number(c.monto), 0)
      const negocioPrincipal = cobrosGrupo
        .slice()
        .sort((a, b) => Number(b.monto) - Number(a.monto))[0]
      const negocio = negocioPrincipal.negocios!

      // Nota PILA si existe
      const notaPilaHtml = planillaPilaId
        ? `<p style="font-size:9pt; color:var(--gris-acero); margin-top:8px;"><em>Nota:</em> se anexa Planilla Integrada de Liquidación de Aportes (PILA) correspondiente al período cobrado, conforme al Decreto 1273 de 2018 y el Artículo 244 de la Ley 1955 de 2019.</p>`
        : ''

      // Concepto parrafos genérico (mismo para todas las cuentas — sintetizado)
      const conceptoTitulo = cobrosGrupo.length > 1 ? 'Conceptos' : 'Concepto'
      const conceptoParrafos = cobrosGrupo.length > 1
        ? `<p>Cuotas mensuales correspondientes a los acuerdos vigentes con <strong>${empresa.razon_social ?? empresa.nombre}</strong>, conforme a los contratos suscritos entre las Partes y vigentes a la fecha.</p>`
        : `<p>Cuota mensual correspondiente al acuerdo vigente con <strong>${empresa.razon_social ?? empresa.nombre}</strong>, conforme al contrato suscrito entre las Partes.</p>`

      // Build payload PDF
      const payload = {
        numero: '', // se asigna por trigger DB al insertar, pero el PDF necesita placeholder
        lugar_emision: 'Bogotá D.C.',
        fecha_emision_letras: formatFechaLetras(fechaEmision),
        fecha_vencimiento_letras: formatFechaLetras(fechaVencimiento),

        emisor_nombre: EMISOR_MAURICIO.nombre,
        emisor_documento: EMISOR_MAURICIO.documento_completo,
        emisor_documento_sin_dv: EMISOR_MAURICIO.documento_numero,
        emisor_regimen: EMISOR_MAURICIO.regimen,
        emisor_direccion: EMISOR_MAURICIO.direccion,
        emisor_email: EMISOR_MAURICIO.email,
        emisor_telefono: EMISOR_MAURICIO.telefono,
        emisor_ciiu: EMISOR_MAURICIO.ciiu_full,

        pagador_nombre: empresa.razon_social ?? empresa.nombre,
        pagador_nit: empresa.numero_documento ?? '—',
        pagador_direccion: empresa.direccion_fiscal ?? '—',
        pagador_representante: empresa.contacto_nombre ?? '—',
        pagador_email: empresa.email_fiscal ?? '—',
        pagador_telefono: empresa.telefono ?? '—',

        concepto_titulo: conceptoTitulo,
        concepto_parrafos: conceptoParrafos,
        conceptos,

        total_label: `Total a cobrar — ${formatFechaLetras(fechaVencimiento).replace(/^\d+ de /, '')}`,
        total_formato: formatCOP(montoTotal),
        total_letras: montoEnLetrasCOP(montoTotal),
        nota_redondeo: '',

        banco_nombre: EMISOR_MAURICIO.banco.nombre,
        banco_tipo: EMISOR_MAURICIO.banco.tipo,
        banco_numero: EMISOR_MAURICIO.banco.numero,
        banco_titular: EMISOR_MAURICIO.banco.titular,
        banco_identificacion: EMISOR_MAURICIO.banco.identificacion,

        nota_pila_html: notaPilaHtml,
        año_gravable_declaracion: String(anioGravable),
      }

      // Pre-asignar numero por la function DB (para incluirlo en el PDF)
      const { data: numeroRow } = await supabase
        .rpc('generate_cuenta_cobro_numero', {
          p_workspace_id: workspaceId,
          p_anio: anio,
          p_mes: mes,
        })

      const numero = (numeroRow as unknown as string) || `CC-${anio}-${String(mes).padStart(2, '0')}-PREVIEW`
      payload.numero = numero

      if (options.dryRun) {
        result.detalles.push({
          empresa_id: empresaId,
          empresa_nombre: empresa.razon_social ?? empresa.nombre,
          numero,
          monto_total: montoTotal,
          cobros_ids: cobrosGrupo.map(c => c.id),
          pdf_drive_url: null,
          estado: 'creada',
        })
        continue
      }

      // Render PDF
      const pdfBytes = await renderCuentaCobro(TEMPLATE_SLUG, payload, options.isDraft ?? false)

      // Subir a Drive — subcarpeta "4. Cuentas de cobro" del negocio principal
      const negocioFolderId = extractFolderIdFromUrl(negocio.carpeta_url)
      let pdfDriveId: string | null = null
      let pdfDriveUrl: string | null = null

      if (negocioFolderId) {
        const subfolderId = await createDriveFolder(SUBFOLDER_CUENTAS, negocioFolderId, workspaceId)
        const fileName = `${numero} — ${empresa.razon_social ?? empresa.nombre}.pdf`
        const uploaded = await uploadFileToDrive(
          pdfBytes,
          fileName,
          'application/pdf',
          subfolderId,
          workspaceId,
        )
        pdfDriveId = uploaded.fileId
        pdfDriveUrl = uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.fileId}/view`
      }

      // Insertar en cuentas_cobro_emitidas
      const { error: insErr } = await supabase
        .from('cuentas_cobro_emitidas')
        .insert({
          workspace_id: workspaceId,
          numero,
          anio,
          mes,
          empresa_id_pagador: empresaId,
          cobros_ids: cobrosGrupo.map(c => c.id),
          monto_total: montoTotal,
          pdf_drive_id: pdfDriveId,
          pdf_drive_url: pdfDriveUrl,
          planilla_pila_id: planillaPilaId,
          estado: 'emitida_pendiente_aprobacion',
          fecha_emision: fechaEmision,
          fecha_vencimiento: fechaVencimiento,
          email_destinatarios: empresa.email_fiscal ? [empresa.email_fiscal] : null,
        })

      if (insErr) {
        result.errores.push({ empresa_id: empresaId, error: insErr.message })
        result.detalles.push({
          empresa_id: empresaId,
          empresa_nombre: empresa.razon_social ?? empresa.nombre,
          numero,
          monto_total: montoTotal,
          cobros_ids: cobrosGrupo.map(c => c.id),
          pdf_drive_url: pdfDriveUrl,
          estado: 'error',
        })
        continue
      }

      // Re-query la cuenta recien insertada para obtener su id (no usamos returning porque
      // el insert lo hacemos con la API supabase-js sin .select())
      const { data: cuentaInsertada } = await supabase
        .from('cuentas_cobro_emitidas')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('numero', numero)
        .maybeSingle()
      const cuentaId = (cuentaInsertada as { id: string } | null)?.id ?? null

      // Notificación in-app al owner del workspace
      const { data: owner } = await supabase
        .from('profiles')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle()

      if (owner) {
        await supabase.from('notificaciones').insert({
          workspace_id: workspaceId,
          destinatario_id: (owner as { id: string }).id,
          tipo: 'cuenta_cobro_pendiente_aprobacion',
          estado: 'pendiente',
          contenido: `Cuenta ${numero} lista para aprobación — ${empresa.razon_social ?? empresa.nombre} · ${formatCOP(montoTotal)}`,
          entidad_tipo: 'cuenta_cobro',
          entidad_id: cuentaId,
          deep_link: '/cobros-recurrentes',
          metadata: {
            cuenta_cobro_id: cuentaId,
            numero,
            empresa_id: empresaId,
            monto_total: montoTotal,
            cobros_ids: cobrosGrupo.map(c => c.id),
          },
        })
      }

      result.cuentasCreadas++
      result.detalles.push({
        empresa_id: empresaId,
        empresa_nombre: empresa.razon_social ?? empresa.nombre,
        numero,
        monto_total: montoTotal,
        cobros_ids: cobrosGrupo.map(c => c.id),
        pdf_drive_url: pdfDriveUrl,
        estado: 'creada',
      })

      // Marcar PILA URL como soporte si existe (para info — no se inserta como cobro, pero el cliente debe verla)
      void planillaPilaUrl
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errores.push({ empresa_id: empresaId, error: msg })
      result.detalles.push({
        empresa_id: empresaId,
        empresa_nombre: empresaMap.get(empresaId)?.razon_social
          ?? empresaMap.get(empresaId)?.nombre
          ?? '?',
        numero: null,
        monto_total: 0,
        cobros_ids: cobrosGrupo.map(c => c.id),
        pdf_drive_url: null,
        estado: 'error',
      })
    }
  }

  return result
}
