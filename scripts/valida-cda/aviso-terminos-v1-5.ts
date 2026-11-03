/**
 * El correo que acompaña el aviso de la v1.5 de los Términos VALIDA · Plan CDA (anexo C de la fuente de
 * Emilio; cláusula 15.1): a los correos registrados de cada CDA, con el PDF adjunto, por Resend, con
 * acuse registrado en `avisos_cliente` (la misma tabla que leen `resend-webhook` y el backfill de
 * acuses: entregado, rebotado, queja).
 *
 * ── Cuándo sale ───────────────────────────────────────────────────────────────
 * El mismo día de la publicación, sin nadie el domingo: el script se corre DESPUÉS de registrar la v1.5
 * (sql/valida-cda/2026-11-01_terminos-v1.5-por-aviso.sql) y programa cada correo en Resend
 * (`scheduled_at`, hasta 30 días) para el día de `publicada_at` a la hora `--hora` (Bogotá, 08:00 por
 * defecto). Si esa hora ya pasó y hoy es el día de la publicación, sale de inmediato. Otro día, no sale.
 *
 * ── Qué lo activa ─────────────────────────────────────────────────────────────
 * Que la v1.5 del CDA ESTÉ registrada. Sin la fila no hay correo: no puede salir antes de la publicación
 * que lo justifica. Y solo con `--enviar`: por defecto es un ensayo que no manda ni escribe nada.
 *
 * ── A quién ───────────────────────────────────────────────────────────────────
 * Los mismos correos registrados que reciben la factura de una cuota (`enviar-factura-cuota`): el correo
 * de facturación de la empresa (`empresas.email_fiscal`) y el de la persona designada del contrato
 * (Auth). Sin repetir.
 *
 * ── Idempotente ───────────────────────────────────────────────────────────────
 * Un destino que ya tiene su fila en `avisos_cliente` con este asunto no se vuelve a mandar, y cada envío
 * lleva `Idempotency-Key` = versión + destino (Resend no lo duplica en 24 h).
 *
 * ── Cómo deshacer un correo programado ────────────────────────────────────────
 * `curl -X POST https://api.resend.com/emails/<id>/cancel -H "Authorization: Bearer $RESEND_API_KEY"`
 * (el id queda en `avisos_cliente.proveedor_id` y en la salida de este script).
 *
 * Uso:
 *   RESEND_API_KEY=… npx tsx scripts/valida-cda/aviso-terminos-v1-5.ts            # ensayo, los 4 CDA
 *   RESEND_API_KEY=… npx tsx scripts/valida-cda/aviso-terminos-v1-5.ts --enviar   # programa y registra
 *   … --qa                    # solo CDA Pruebas (el espacio de pruebas), en vez de los 4
 *   … --solo <espacio>        # uno de los 4
 *   … --hora 08:00            # hora (Bogotá) del día de la publicación
 *   … --probar-con v1.4       # solo ensayo: recorre el camino con una versión ya registrada
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (.env.local) y, para --enviar,
 * RESEND_API_KEY (no está en .env.local: va por entorno).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { FROM_FACTURACION } from '../../supabase/functions/_shared/remitente-facturacion.ts'
import { correoAvisoV15, datosDelTextoV15 } from '../../src/lib/valida-cda/terminos-v1-5.ts'

const CDAS = ['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec'] as const
const QA = ['cda-pruebas'] as const
const SLUG_DOC = 'terminos-suscripcion-valida-cda'
const args = process.argv.slice(2)
const ENVIAR = args.includes('--enviar')
const valorDe = (bandera: string) => (args.includes(bandera) ? args[args.indexOf(bandera) + 1] : undefined)
// `--probar-con v1.4`: SOLO en ensayo, recorre todo el camino (contrato, PDF del bucket, huellas, correos,
// texto) con una versión ya registrada, para probar el script antes de que exista la v1.5. Nunca manda.
const PROBAR_CON = ENVIAR ? undefined : valorDe('--probar-con')
const VERSION = PROBAR_CON ?? 'v1.5'
const SOLO = valorDe('--solo')
const HORA = valorDe('--hora') ?? '08:00'
if (!/^\d{2}:\d{2}$/.test(HORA)) {
  console.error('--hora va como HH:MM (Bogotá)')
  process.exit(1)
}
const espacios: readonly string[] = args.includes('--qa') ? QA : SOLO ? CDAS.filter((s) => s === SOLO) : CDAS
if (espacios.length === 0) {
  console.error(`--solo tiene que ser uno de: ${CDAS.join(', ')}`)
  process.exit(1)
}

const env: Record<string, string> = { ...(process.env as Record<string, string>) }
try {
  for (const linea of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
  }
} catch {
  // Sin .env.local se sigue: puede venir todo por entorno.
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (ENVIAR && !env.RESEND_API_KEY) {
  console.error('Falta RESEND_API_KEY (no está en .env.local: va por entorno)')
  process.exit(1)
}
const BASE = (env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) as any

/** El día (Bogotá) de un instante. */
const diaBogota = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d)
/** 'YYYY-MM-DD' + 'HH:MM' de Bogotá (UTC−5, sin horario de verano) → instante. */
const instanteBogota = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-05:00`)

async function uno(slug: string): Promise<{ slug: string; ok: boolean }> {
  const fallo = (msg: string) => {
    console.error(`✗ ${slug}: ${msg}`)
    return { slug, ok: false }
  }

  const ws = await db.from('workspaces').select('id, slug').eq('slug', slug).maybeSingle()
  if (ws.error || !ws.data) return fallo(`no se encontró el espacio (${ws.error?.message ?? 'sin fila'})`)
  const contrato = await db
    .from('servicios_contratados')
    .select('id, workspace_id, empresa_id, negocio_id, aceptante_designado_id, estado')
    .eq('workspace_pagador_id', ws.data.id)
    .eq('servicio_slug', 'valida-cda-licencia')
    .eq('estado', 'activo')
  if (contrato.error) return fallo(`contrato: ${contrato.error.message}`)
  if ((contrato.data ?? []).length !== 1) return fallo(`se esperaba 1 contrato activo y hay ${(contrato.data ?? []).length}`)
  const sc = contrato.data[0]

  // La activación: sin la v1.5 registrada, no hay correo.
  const doc = await db
    .from('documentos_contractuales_versiones')
    .select('id, version, texto_md, texto_sha256, pdf_bucket, pdf_path, pdf_sha256, vigente_desde, publicada_at, rige_por_aviso')
    .eq('empresa_id', sc.empresa_id)
    .eq('slug', SLUG_DOC)
    .eq('version', VERSION)
    .maybeSingle()
  if (doc.error) return fallo(`v1.5: ${doc.error.message}`)
  if (!doc.data) return fallo('la v1.5 no está registrada: primero el SQL de publicación. No se manda nada.')
  const d = doc.data
  if (!d.rige_por_aviso || !d.publicada_at) return fallo('la v1.5 registrada no es por aviso o no tiene publicada_at')

  // Cuándo: el día de la publicación, a la hora pedida; si ya pasó ese día, no sale.
  const diaPublicacion = diaBogota(new Date(d.publicada_at))
  const hoy = diaBogota(new Date())
  if (hoy > diaPublicacion && !PROBAR_CON) return fallo(`la publicación fue el ${diaPublicacion} y hoy es ${hoy}: el correo tenía que salir ese día`)
  const programado = instanteBogota(diaPublicacion, HORA)
  const publicada = new Date(d.publicada_at)
  const salida = programado < publicada ? publicada : programado
  const inmediato = salida.getTime() <= Date.now() + 60_000

  // El PDF que se adjunta es el registrado.
  const pdf = await db.storage.from(d.pdf_bucket).download(d.pdf_path)
  if (pdf.error || !pdf.data) return fallo(`no se pudo bajar el PDF ${d.pdf_path}: ${pdf.error?.message ?? 'vacío'}`)
  const bytes = Buffer.from(await pdf.data.arrayBuffer())
  const huella = createHash('sha256').update(bytes).digest('hex')
  if (huella !== d.pdf_sha256) return fallo(`el PDF subido no es el registrado (${huella} ≠ ${d.pdf_sha256})`)
  if (createHash('sha256').update(d.texto_md, 'utf8').digest('hex') !== d.texto_sha256) {
    return fallo('el texto registrado no coincide con su huella')
  }

  // A quién: correo de facturación de la empresa + persona designada.
  const empresa = await db.from('empresas').select('email_fiscal').eq('id', sc.empresa_id).maybeSingle()
  if (empresa.error) return fallo(`empresa: ${empresa.error.message}`)
  let correoDesignado: string | null = null
  if (sc.aceptante_designado_id) {
    const u = await db.auth.admin.getUserById(sc.aceptante_designado_id)
    if (u.error) return fallo(`correo de la persona designada: ${u.error.message}`)
    correoDesignado = u.data?.user?.email ?? null
  }
  const destinos = [...new Set([empresa.data?.email_fiscal, correoDesignado].filter((x): x is string => !!x).map((x) => x.trim().toLowerCase()))]
  if (destinos.length === 0) return fallo('sin correos registrados (ni email_fiscal ni la persona designada)')

  const correo = correoAvisoV15({
    doc: { documentoId: d.id, version: d.version, vigenteDesde: d.vigente_desde, publicadaAt: d.publicada_at, pdfSha256: d.pdf_sha256 },
    texto: datosDelTextoV15(d.texto_md),
    urlValida: `https://${slug}.${BASE}/valida`,
  })

  const yaEnviados = await db
    .from('avisos_cliente')
    .select('destino, proveedor_id, estado')
    .eq('negocio_id', sc.negocio_id)
    .eq('canal', 'email')
    .eq('titulo', correo.asunto)
  if (yaEnviados.error) return fallo(`avisos_cliente: ${yaEnviados.error.message}`)
  const ya = new Set(((yaEnviados.data ?? []) as { destino: string | null; estado: string }[]).filter((f) => f.estado !== 'fallido').map((f) => (f.destino ?? '').toLowerCase()))

  console.log(`\n${slug} · ${VERSION} ${d.id} · publicada ${d.publicada_at} · PDF ${huella.slice(0, 12)}… OK`)
  console.log(`  asunto: ${correo.asunto}`)
  console.log(`  correos registrados: facturación ${empresa.data?.email_fiscal ?? '—'} · persona designada ${correoDesignado ?? '—'}`)
  console.log(`  sale: ${inmediato ? 'de inmediato' : `${salida.toISOString()} (${diaPublicacion} ${HORA} Bogotá)`}`)
  let ok = true
  for (const destino of destinos) {
    if (ya.has(destino)) {
      console.log(`  = ${destino}: ya registrado, no se repite`)
      continue
    }
    if (!ENVIAR) {
      console.log(`  · ${destino}: (ensayo) se programaría`)
      continue
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `terminos-${VERSION}:${d.id}:${destino}`,
      },
      body: JSON.stringify({
        from: FROM_FACTURACION,
        to: [destino],
        subject: correo.asunto,
        html: correo.html,
        text: correo.texto,
        attachments: [{ filename: d.pdf_path.split('/').pop(), content: bytes.toString('base64') }],
        ...(inmediato ? {} : { scheduled_at: salida.toISOString() }),
      }),
    })
    const cuerpo = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    const fila = {
      workspace_id: sc.workspace_id,
      negocio_id: sc.negocio_id,
      canal: 'email',
      estado: res.ok ? 'enviado' : 'fallido',
      destino,
      titulo: correo.asunto,
      motivo: res.ok
        ? inmediato
          ? null
          : `programado: ${salida.toISOString()}`
        : `resend_${res.status}${cuerpo.message ? `: ${cuerpo.message}` : ''}`,
      proveedor_id: cuerpo.id ?? null,
    }
    const ins = await db.from('avisos_cliente').insert(fila)
    if (!res.ok) {
      ok = false
      console.error(`  ✗ ${destino}: Resend ${res.status} ${cuerpo.message ?? ''}`)
    } else {
      console.log(`  ✓ ${destino}: ${inmediato ? 'enviado' : 'programado'} (id ${cuerpo.id})`)
    }
    if (ins.error) {
      ok = false
      console.error(`  ⚠️ ${destino}: el correo ${res.ok ? 'SÍ salió/quedó programado' : 'falló'} pero no se pudo registrar en avisos_cliente: ${ins.error.message}. Fila: ${JSON.stringify(fila)}`)
    }
  }
  return { slug, ok }
}

async function main() {
  const resultados = []
  for (const slug of espacios) resultados.push(await uno(slug))
  console.log(
    `\n${ENVIAR ? 'ENVÍO' : 'ENSAYO (nada se mandó ni se escribió; --enviar para programar)'}: ` +
      `${resultados.filter((r) => r.ok).length}/${resultados.length} espacios OK`,
  )
  if (resultados.some((r) => !r.ok)) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
