/**
 * ¿Qué de la cola de facturación EXISTE ya en Siigo?
 *
 * Cruza los negocios que la cola considera facturables contra los documentos
 * reales de Siigo (terceros, facturas y recibos de caja) para responder dos
 * preguntas antes de tocar nada:
 *
 *   1. ¿Tiene sentido un backfill de terceros, o ya están casi todos?
 *   2. ¿Cuántos casos YA están facturados en Siigo sin que ONE lo sepa?
 *
 * La segunda es la que importa: si Diana facturó por fuera y ONE no lo registró,
 * un botón de "emitir" volvería a facturar. Una factura electrónica aceptada por
 * la DIAN no se deshace, así que este cruce es requisito del botón, no un extra.
 * Y solo la fuente EXTERNA puede responderlo: por dentro ONE cuadra consigo mismo.
 *
 * NO escribe nada, ni en Siigo ni en ONE. Es una medición.
 *
 * Uso:  npx tsx scripts/cruzar-cola-con-siigo.ts <slug-workspace>
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const slug = process.argv[2]
if (!slug) {
  console.error('Uso: npx tsx scripts/cruzar-cola-con-siigo.ts <slug-workspace>')
  process.exit(1)
}

const COP = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)

interface SiigoDoc {
  id: string
  name: string
  date: string
  customer?: { identification?: string }
  items?: Array<{ code?: string }>
}

async function traerTodo<T>(wsId: string, ruta: string, siigoRequest: <R>(w: string, p: string) => Promise<R>): Promise<T[]> {
  const acc: T[] = []
  for (let page = 1; ; page++) {
    const sep = ruta.includes('?') ? '&' : '?'
    const r = await siigoRequest<{ results: T[]; pagination?: { total_results: number } }>(
      wsId, `${ruta}${sep}page=${page}&page_size=100`,
    )
    const lote = r.results ?? []
    acc.push(...lote)
    const total = r.pagination?.total_results ?? acc.length
    if (lote.length === 0 || acc.length >= total) break
  }
  return acc
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { siigoRequest, getSiigoConfig } = await import('../src/lib/siigo/client')

  const one = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: ws } = await one.from('workspaces').select('id, name').eq('slug', slug).single()
  if (!ws) { console.error(`Workspace "${slug}" no existe`); process.exit(1) }
  const wsId = (ws as { id: string }).id
  const cfg = await getSiigoConfig(wsId)

  // ── Desde qué etapa la cola considera facturable ───────────────────────────
  const { data: lineas } = await one
    .from('lineas_negocio').select('id, nombre, config_extra').eq('workspace_id', wsId)
  let desde: number | null = null
  for (const l of ((lineas ?? []) as Array<{ config_extra?: Record<string, unknown> | null }>)) {
    const f = (l.config_extra?.facturacion ?? {}) as { desde_etapa_numero?: number }
    if (typeof f.desde_etapa_numero === 'number') { desde = f.desde_etapa_numero; break }
  }
  if (desde == null) { console.error('La línea no declara facturacion.desde_etapa_numero'); process.exit(1) }

  // ── Cola en ONE ────────────────────────────────────────────────────────────
  const { data: negocios, error: errNeg } = await one
    .from('negocios')
    .select('id, codigo, nombre, precio_aprobado, metadata, etapas_negocio!inner(nombre, numero)')
    .eq('workspace_id', wsId)
    .eq('estado', 'abierto')
  if (errNeg) { console.error('Error leyendo negocios:', errNeg.message); process.exit(1) }

  type Neg = {
    id: string; codigo: string | null; nombre: string | null
    precio_aprobado: number | null; metadata: Record<string, unknown> | null
    etapas_negocio: { nombre: string | null; numero: number | null } | null
  }
  const cola = ((negocios ?? []) as unknown as Neg[]).filter(n => (n.etapas_negocio?.numero ?? 0) > desde!)

  // Identificación y "ONE cree que ya está facturado" salen de los mismos bloques
  // que lee la cola, para medir lo que la cola ve y no otra cosa.
  const { data: bloques } = await one
    .from('negocio_bloques')
    .select('negocio_id, data, bloque_configs!inner(slug)')
    .in('negocio_id', cola.map(n => n.id))
    .in('bloque_configs.slug', ['rut', 'factura_emitida'])

  type Bl = { negocio_id: string; data: { campos?: Record<string, { value?: unknown }> } | null; bloque_configs: { slug: string } }
  const idPorNegocio = new Map<string, string>()
  const rutPorNegocio = new Map<string, Record<string, string>>()
  const oneDiceFacturado = new Map<string, string>()
  for (const b of ((bloques ?? []) as unknown as Bl[])) {
    const campos = b.data?.campos ?? {}
    if (b.bloque_configs?.slug === 'rut') {
      const plano: Record<string, string> = {}
      for (const [k, v] of Object.entries(campos)) {
        if (v?.value != null && v.value !== '') plano[k] = String(v.value)
      }
      rutPorNegocio.set(b.negocio_id, plano)
      const raw = String(campos.numero_identificacion?.value ?? campos.nit?.value ?? '').trim()
      const limpio = raw.replace(/[^\d]/g, '')
      if (limpio) idPorNegocio.set(b.negocio_id, limpio)
    } else if (b.bloque_configs?.slug === 'factura_emitida') {
      const n = String(campos.numero_factura?.value ?? '').trim()
      if (n) oneDiceFacturado.set(b.negocio_id, n)
    }
  }

  // ── Documentos reales en Siigo ─────────────────────────────────────────────
  console.log('Trayendo terceros, facturas y recibos de Siigo…')
  const [terceros, facturas, recibos] = await Promise.all([
    traerTodo<{ id: string; identification?: string }>(wsId, '/v1/customers', siigoRequest),
    traerTodo<SiigoDoc>(wsId, '/v1/invoices?created_start=2020-01-01', siigoRequest),
    traerTodo<SiigoDoc>(wsId, '/v1/vouchers', siigoRequest),
  ])

  const norm = (s?: string | null) => (s ?? '').replace(/[^\d]/g, '')
  const tercerosPorId = new Set(terceros.map(t => norm(t.identification)).filter(Boolean))

  // Solo cuentan las facturas del producto del servicio: SOENA factura otras cosas
  // y contarlas todas daría por facturado a quien no lo está.
  const facturasUpmePorId = new Map<string, SiigoDoc[]>()
  for (const f of facturas) {
    if (!f.items?.some(i => i.code === cfg.productoCode)) continue
    const id = norm(f.customer?.identification)
    if (!id) continue
    if (!facturasUpmePorId.has(id)) facturasUpmePorId.set(id, [])
    facturasUpmePorId.get(id)!.push(f)
  }
  const recibosPorId = new Map<string, SiigoDoc[]>()
  for (const r of recibos) {
    const id = norm(r.customer?.identification)
    if (!id) continue
    if (!recibosPorId.has(id)) recibosPorId.set(id, [])
    recibosPorId.get(id)!.push(r)
  }

  // ── Cruce ──────────────────────────────────────────────────────────────────
  let sinId = 0, conTercero = 0, sinTercero = 0
  let yaMarcadoEnOne = 0
  const facturadoEnSiigoSinSaberlo: Array<{ codigo: string | null; etapa: string | null; id: string; factura: string; honorario: number | null }> = []
  const conRecibo: string[] = []

  for (const n of cola) {
    const id = idPorNegocio.get(n.id)
    if (!id) { sinId++; continue }
    if (tercerosPorId.has(id)) conTercero++; else sinTercero++

    const facs = facturasUpmePorId.get(id) ?? []
    const marcado = oneDiceFacturado.get(n.id)
    if (marcado) yaMarcadoEnOne++
    if (facs.length > 0 && !marcado) {
      facturadoEnSiigoSinSaberlo.push({
        codigo: n.codigo, etapa: n.etapas_negocio?.nombre ?? null, id,
        factura: facs.map(f => f.name).join(', '),
        honorario: n.precio_aprobado == null ? null : Number(n.precio_aprobado),
      })
    }
    if ((recibosPorId.get(id) ?? []).length > 0) conRecibo.push(id)
  }

  // ── Reporte ────────────────────────────────────────────────────────────────
  console.log(`\n══ Cola de facturación de ${slug} (etapas con numero > ${desde}) ══`)
  console.log(`  Casos en la cola:                  ${cola.length}`)
  console.log(`  Sin identificación en el RUT:      ${sinId}`)
  console.log(`\n── Terceros ──`)
  console.log(`  Ya existen en Siigo:               ${conTercero}`)
  console.log(`  Habría que crearlos (backfill):    ${sinTercero}`)
  console.log(`  Terceros totales en Siigo:         ${terceros.length}`)

  // De los que faltan, cuántos se podrían crear HOY. Un backfill no vale por el
  // número de casos que toca, sino por los que de verdad pasan completos: el
  // resto sigue necesitando que alguien complete el dato.
  const { borradorCliente } = await import('../src/lib/siigo/mapeo')
  const contactoIds = new Map<string, { email: string | null; telefono: string | null }>()
  const { data: negsContacto } = await one
    .from('negocios').select('id, contacto_id').in('id', cola.map(n => n.id))
  const idsContacto = ((negsContacto ?? []) as Array<{ id: string; contacto_id: string | null }>)
  const { data: contactos } = await one
    .from('contactos').select('id, email, telefono')
    .in('id', idsContacto.map(x => x.contacto_id).filter(Boolean) as string[])
  const contactoPorId = new Map(((contactos ?? []) as Array<{ id: string; email: string | null; telefono: string | null }>).map(c => [c.id, c]))
  for (const x of idsContacto) {
    const c = x.contacto_id ? contactoPorId.get(x.contacto_id) : null
    contactoIds.set(x.id, { email: c?.email ?? null, telefono: c?.telefono ?? null })
  }

  let listos = 0
  const motivos = new Map<string, number>()
  for (const n of cola) {
    const id = idPorNegocio.get(n.id)
    if (!id || tercerosPorId.has(id)) continue
    const b = borradorCliente(rutPorNegocio.get(n.id) ?? {}, contactoIds.get(n.id) ?? {})
    if (b.faltantes.length === 0) listos++
    for (const f of b.faltantes) motivos.set(f, (motivos.get(f) ?? 0) + 1)
  }
  console.log(`  De los que faltan, se crearían ya: ${listos} de ${sinTercero}`)
  for (const [motivo, n] of [...motivos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      falta ${motivo}: ${n}`)
  }
  console.log(`\n── Facturas ──`)
  console.log(`  Facturas del producto ${cfg.productoCode} en Siigo: ${[...facturasUpmePorId.values()].flat().length} (${facturasUpmePorId.size} clientes)`)
  console.log(`  ONE ya los da por facturados:      ${yaMarcadoEnOne}`)
  console.log(`  ⚠️  FACTURADOS EN SIIGO Y ONE NO LO SABE: ${facturadoEnSiigoSinSaberlo.length}`)
  console.log(`\n── Recibos de caja ──`)
  console.log(`  Casos de la cola con recibo:       ${conRecibo.length}`)
  console.log(`  Recibos totales en Siigo:          ${recibos.length}`)

  if (facturadoEnSiigoSinSaberlo.length > 0) {
    console.log(`\n══ Los que un botón de "emitir" volvería a facturar ══`)
    for (const c of facturadoEnSiigoSinSaberlo) {
      console.log(`  ${(c.codigo ?? '?').padEnd(8)} ${String(c.etapa ?? '').padEnd(16)} id ${c.id.padEnd(12)} ya tiene ${c.factura}  (honorario ${COP(c.honorario)})`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
