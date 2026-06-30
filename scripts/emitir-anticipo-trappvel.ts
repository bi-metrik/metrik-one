/**
 * Emisión one-off de la PRIMERA cuenta de cobro (anticipo) del negocio Clarity Trappvel.
 *
 * El generador recurrente (generar-cuentas-cobro.ts) es período-driven (día 15,
 * solo cuotas mensuales uniformes) y NO modela un anticipo de monto distinto con
 * vencimiento a 5 días hábiles. Por eso el anticipo se emite con este script,
 * replicando el mismo path probado (render -> Drive -> cuentas_cobro_emitidas),
 * y se deja en estado 'emitida_pendiente_aprobacion' para que Mauricio apruebe+envíe.
 *
 * Idempotente: aborta si CC-2026-06-003 ya existe.
 *
 * Uso:
 *   cd metrik-one && npx tsx scripts/emitir-anticipo-trappvel.ts
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   GOOGLE_DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN, METRIK_PDF_RENDER_URL/SECRET/SA_KEY
 */

import './_load-env'
import { createClient } from '@supabase/supabase-js'
import { renderCuentaCobro, type CuentaCobroRenderPayload } from '../src/lib/pdf/pdf-render-client'
import { EMISOR_MAURICIO, getAnioGravableDeclaracion } from '../src/lib/cobros/emisor-mauricio'
import { formatCOP, formatFechaLetras, montoEnLetrasCOP } from '../src/lib/cobros/format'

// ── Constantes del negocio ─────────────────────────────────────────
const WS = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const NEGOCIO_ID = 'b53d14da-e8ce-40f7-83fd-24983e9fcbc8'
const EMPRESA_ID = '0b0e2476-f70d-45fd-a9de-72cfe6fb7cd3'
const DRIVE_FOLDER_TRAPPVEL = '16_c_YtsQLIwKMW0Nw1Kwto7TvycVOjXp'
const SUBFOLDER_CUENTAS = '4. Cuentas de cobro'

const NUMERO = 'CC-2026-06-003'
const FECHA_EMISION = '2026-06-30'
const FECHA_VENCIMIENTO = '2026-07-07' // 5 días hábiles tras firma (martes 30-jun)
const MONTO_ANTICIPO = 1_000_000
const DESTINATARIO = 'gerencia@trappvel.com'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Drive helpers (inline — evita el import @/lib/supabase de google-drive.ts) ──
async function driveAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Drive token falló (${res.status}): ${await res.text()}`)
  return ((await res.json()) as { access_token: string }).access_token
}

async function findOrCreateSubfolder(token: string, parentId: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  const list = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const found = (await list.json()) as { files?: { id: string }[] }
  if (found.files && found.files.length > 0) return found.files[0].id

  const create = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  if (!create.ok) throw new Error(`Crear subcarpeta falló (${create.status}): ${await create.text()}`)
  return ((await create.json()) as { id: string }).id
}

async function uploadPdf(token: string, folderId: string, name: string, bytes: Buffer): Promise<{ id: string; webViewLink: string }> {
  const boundary = 'metrik-boundary-' + Math.random().toString(36).slice(2)
  const meta = JSON.stringify({ name, parents: [folderId] })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ])
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  )
  if (!res.ok) throw new Error(`Upload PDF falló (${res.status}): ${await res.text()}`)
  const j = (await res.json()) as { id: string; webViewLink?: string }
  return { id: j.id, webViewLink: j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view` }
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('▶ Emitiendo anticipo Trappvel', NUMERO)

  // Guard idempotencia
  const { data: dup } = await supabase
    .from('cuentas_cobro_emitidas')
    .select('id, numero, estado')
    .eq('workspace_id', WS)
    .eq('numero', NUMERO)
    .maybeSingle()
  if (dup) {
    console.log('⚠ Ya existe', NUMERO, '— estado', (dup as { estado: string }).estado, '. Abortando sin duplicar.')
    return
  }

  // Empresa (pagador)
  const { data: empresa, error: eErr } = await supabase
    .from('empresas')
    .select('nombre, razon_social, numero_documento, direccion_fiscal, email_fiscal, telefono, contacto_nombre')
    .eq('id', EMPRESA_ID)
    .single()
  if (eErr || !empresa) throw new Error('Empresa Trappvel no encontrada: ' + eErr?.message)
  const emp = empresa as Record<string, string | null>

  // 1) plan_cobro (6 cuotas) — INACTIVO: las fechas de cuota del contrato no calzan con
  //    el generador (día 15) y la cuota 6 lleva +$2. Se activa cuando Mik/Hana cierren el
  //    cronograma real. El anticipo (hoy) NO depende de esto.
  const { data: planExist } = await supabase
    .from('planes_cobro').select('id').eq('negocio_id', NEGOCIO_ID).maybeSingle()
  let planId = (planExist as { id: string } | null)?.id ?? null
  if (!planId) {
    const { data: plan, error: pErr } = await supabase.from('planes_cobro').insert({
      workspace_id: WS,
      negocio_id: NEGOCIO_ID,
      monto: 833333,
      frecuencia: 'mensual',
      total_cuotas: 6,
      fecha_inicio: '2026-08-07',
      fecha_fin: '2027-01-07',
      concepto_detalle_template: 'Cuota {numero_cuota} de {total_cuotas} — Saldo Contrato Integral MéTRIK–Trappvel (Clarity)',
      activo: false,
      auto_renovar: false,
      notas: 'PENDIENTE confirmar cronograma. Contrato cl.3.4: cuotas "mismo día calendario del mes siguiente al anticipo"; el generador usa día 15. Cuota 6 = $833.335 (+$2 de ajuste). Activar cuando se cierre el calendario real.',
    }).select('id').single()
    if (pErr) throw new Error('Insert plan_cobro: ' + pErr.message)
    planId = (plan as { id: string }).id
    console.log('  ✓ plan_cobro creado (inactivo):', planId)
  } else {
    console.log('  • plan_cobro ya existía:', planId)
  }

  // 2) cobro anticipo (idempotente — reusa si ya existe por re-ejecución)
  const { data: cobroExist } = await supabase
    .from('cobros').select('id')
    .eq('negocio_id', NEGOCIO_ID).eq('tipo_cobro', 'anticipo').is('fecha', null)
    .maybeSingle()
  let cobroId = (cobroExist as { id: string } | null)?.id ?? null
  if (!cobroId) {
    const { data: cobro, error: cErr } = await supabase.from('cobros').insert({
      workspace_id: WS,
      negocio_id: NEGOCIO_ID,
      plan_cobro_id: planId,
      numero_cuota: 0,
      tipo_cobro: 'anticipo',
      monto: MONTO_ANTICIPO,
      fecha: null, // override DEFAULT CURRENT_DATE — anticipo emitido, NO pagado
      fecha_esperada: FECHA_VENCIMIENTO,
      vencido: false,
      notas: 'Anticipo Contrato Integral Trappvel (Clarity). Emitido en CC-2026-06-003.',
    }).select('id').single()
    if (cErr) throw new Error('Insert cobro anticipo: ' + cErr.message)
    cobroId = (cobro as { id: string }).id
    console.log('  ✓ cobro anticipo:', cobroId)
  } else {
    console.log('  • cobro anticipo ya existía:', cobroId)
  }

  // 3) Render PDF
  const payload: CuentaCobroRenderPayload = {
    numero: NUMERO,
    lugar_emision: 'Bogotá D.C.',
    fecha_emision_letras: formatFechaLetras(FECHA_EMISION),
    fecha_vencimiento_letras: formatFechaLetras(FECHA_VENCIMIENTO),
    emisor_nombre: EMISOR_MAURICIO.nombre,
    emisor_documento: EMISOR_MAURICIO.documento_completo,
    emisor_documento_sin_dv: EMISOR_MAURICIO.documento_numero,
    emisor_regimen: EMISOR_MAURICIO.regimen,
    emisor_direccion: EMISOR_MAURICIO.direccion,
    emisor_email: EMISOR_MAURICIO.email,
    emisor_telefono: EMISOR_MAURICIO.telefono,
    emisor_ciiu: EMISOR_MAURICIO.ciiu_full,
    pagador_nombre: emp.razon_social ?? emp.nombre ?? 'TRAPPVEL ENTERPRISE S.A.S.',
    pagador_nit: emp.numero_documento ?? '900.945.317-1',
    pagador_direccion: emp.direccion_fiscal ?? '—',
    pagador_representante: emp.contacto_nombre ?? '—',
    pagador_email: emp.email_fiscal ?? DESTINATARIO,
    pagador_telefono: emp.telefono ?? '—',
    concepto_titulo: 'Concepto',
    concepto_parrafos:
      '<p>Anticipo correspondiente al Contrato Integral de Servicios suscrito entre las Partes, firmado el 30 de junio de 2026, conforme a la cláusula 3.4 (forma de pago). El valor no causa IVA: MéTRIK opera como persona natural no responsable de IVA.</p>',
    conceptos: [
      {
        detalle: 'Anticipo del plan de pago (anticipo + 6 cuotas mensuales) — Contrato Integral MéTRIK–Trappvel (Clarity, línea vacacional personalizada).',
        monto: formatCOP(MONTO_ANTICIPO),
      },
    ],
    total_label: `Total a cobrar — ${formatFechaLetras(FECHA_VENCIMIENTO).replace(/^\d+ de /, '')}`,
    total_formato: formatCOP(MONTO_ANTICIPO),
    total_letras: montoEnLetrasCOP(MONTO_ANTICIPO),
    nota_redondeo: '',
    banco_nombre: EMISOR_MAURICIO.banco.nombre,
    banco_tipo: EMISOR_MAURICIO.banco.tipo,
    banco_numero: EMISOR_MAURICIO.banco.numero,
    banco_titular: EMISOR_MAURICIO.banco.titular,
    banco_identificacion: EMISOR_MAURICIO.banco.identificacion,
    nota_pila_html: '',
    año_gravable_declaracion: String(getAnioGravableDeclaracion(new Date(FECHA_EMISION + 'T12:00:00Z'))),
  }

  console.log('  … render PDF vía metrik-pdf-render')
  const pdfBytes = await renderCuentaCobro('metrik', payload, false)
  console.log('  ✓ PDF', pdfBytes.length, 'bytes')

  // 4) Subir a Drive
  const token = await driveAccessToken()
  const subId = await findOrCreateSubfolder(token, DRIVE_FOLDER_TRAPPVEL, SUBFOLDER_CUENTAS)
  const fileName = `${NUMERO} — ${emp.razon_social ?? emp.nombre}.pdf`
  const up = await uploadPdf(token, subId, fileName, pdfBytes)
  console.log('  ✓ PDF en Drive:', up.webViewLink)

  // 5) Insertar cuenta
  const { error: insErr } = await supabase.from('cuentas_cobro_emitidas').insert({
    workspace_id: WS,
    numero: NUMERO,
    anio: 2026,
    mes: 6,
    empresa_id_pagador: EMPRESA_ID,
    cobros_ids: [cobroId],
    monto_total: MONTO_ANTICIPO,
    pdf_drive_id: up.id,
    pdf_drive_url: up.webViewLink,
    estado: 'emitida_pendiente_aprobacion',
    fecha_emision: FECHA_EMISION,
    fecha_vencimiento: FECHA_VENCIMIENTO,
    email_destinatarios: [DESTINATARIO],
    notas: 'Anticipo Contrato Integral Trappvel (Clarity), firmado 2026-06-30. Persona natural Mauricio, sin IVA.',
  })
  if (insErr) throw new Error('Insert cuenta: ' + insErr.message)

  console.log('\n✅ EMITIDA', NUMERO, '· $1.000.000 · vence 2026-07-07 · estado emitida_pendiente_aprobacion')
  console.log('   PDF:', up.webViewLink)
  console.log('   → Aprobar+enviar desde ONE: /cobros-recurrentes')
}

main().catch((e) => {
  console.error('\n❌ ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
