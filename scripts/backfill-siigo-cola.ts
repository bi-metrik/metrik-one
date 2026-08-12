/**
 * Puesta al día de la cola de facturación contra Siigo. Dos cosas, ninguna de las
 * cuales emite una factura:
 *
 *   1. Crea en Siigo los TERCEROS de los casos que ya pasaron Documentación. El
 *      disparo automático solo cubre a los que avancen de ahora en adelante.
 *   2. Marca en ONE los casos que Siigo YA tiene facturados. Sin esa marca siguen
 *      en la cola como pendientes y alguien podría volver a facturarlos.
 *
 * Un tercero no es un documento contable: crearlo dos veces no asienta nada. Por
 * eso el paso 1 es seguro. El paso 2 solo escribe en ONE.
 *
 * SIMULA por defecto. Para aplicar de verdad hay que pasar `--commit`.
 *
 * Uso:
 *   npx tsx scripts/backfill-siigo-cola.ts soena             # simula
 *   npx tsx scripts/backfill-siigo-cola.ts soena --commit    # aplica
 *   npx tsx scripts/backfill-siigo-cola.ts soena --commit --solo-marcas
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const slug = process.argv[2]
const commit = process.argv.includes('--commit')
const soloMarcas = process.argv.includes('--solo-marcas')

if (!slug) {
  console.error('Uso: npx tsx scripts/backfill-siigo-cola.ts <slug> [--commit] [--solo-marcas]')
  process.exit(1)
}

/** Siigo pide ~19 s cuando se pasa el límite; se le da margen. */
const ESPERA_429_MS = 40_000

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { siigoRequest, getSiigoConfig } = await import('../src/lib/siigo/client')
  const { asegurarClienteSiigo } = await import('../src/lib/siigo/clientes')

  const one = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: ws } = await one.from('workspaces').select('id').eq('slug', slug).single()
  if (!ws) { console.error(`Workspace "${slug}" no existe`); process.exit(1) }
  const wsId = (ws as { id: string }).id
  const cfg = await getSiigoConfig(wsId)

  // ── Cola ───────────────────────────────────────────────────────────────────
  const { data: lineas } = await one
    .from('lineas_negocio').select('config_extra').eq('workspace_id', wsId)
  let desde: number | null = null
  for (const l of ((lineas ?? []) as Array<{ config_extra?: Record<string, unknown> | null }>)) {
    const f = (l.config_extra?.facturacion ?? {}) as { desde_etapa_numero?: number }
    if (typeof f.desde_etapa_numero === 'number') { desde = f.desde_etapa_numero; break }
  }
  if (desde == null) { console.error('La línea no declara facturacion.desde_etapa_numero'); process.exit(1) }

  const { data: negocios } = await one
    .from('negocios')
    .select('id, codigo, metadata, etapas_negocio!inner(numero)')
    .eq('workspace_id', wsId).eq('estado', 'abierto')
  type Neg = { id: string; codigo: string | null; metadata: Record<string, unknown> | null; etapas_negocio: { numero: number | null } | null }
  const cola = ((negocios ?? []) as unknown as Neg[]).filter(n => (n.etapas_negocio?.numero ?? 0) > desde!)

  const { data: ruts } = await one
    .from('negocio_bloques').select('negocio_id, data, bloque_configs!inner(slug)')
    .in('negocio_id', cola.map(n => n.id)).eq('bloque_configs.slug', 'rut')
  const idPorNegocio = new Map<string, string>()
  for (const b of ((ruts ?? []) as unknown as Array<{ negocio_id: string; data: { campos?: Record<string, { value?: unknown }> } | null }>)) {
    const c = b.data?.campos ?? {}
    const limpio = String(c.numero_identificacion?.value ?? c.nit?.value ?? '').replace(/[^\d]/g, '')
    if (limpio) idPorNegocio.set(b.negocio_id, limpio)
  }

  console.log(`\n${commit ? '⚠️  APLICANDO' : 'Simulación (sin --commit no se escribe nada)'} · ${cola.length} casos en la cola\n`)

  // ── 1. Marcar los que Siigo ya tiene facturados ────────────────────────────
  // Va PRIMERO: si el proceso se corta a la mitad, es preferible haber sacado de
  // la cola a los ya facturados que haber creado terceros de más.
  let marcados = 0
  for (const n of cola) {
    const id = idPorNegocio.get(n.id)
    if (!id) continue
    if ((n.metadata?.siigo_factura ?? null) !== null) continue

    const r = await siigoRequest<{ results?: Array<{ id?: string; name?: string; date?: string; items?: Array<{ code?: string }> }> }>(
      wsId, `/v1/invoices?customer_identification=${encodeURIComponent(id)}&page_size=100`,
      // Un barrido de cientos de casos SIEMPRE se pasa del límite de peticiones
      // de Siigo (salta alrededor de las 100 y pide ~19 s). Aquí la pausa es
      // parte del trabajo, así que se aguanta en vez de abortar a media lista.
      { maxEspera429Ms: ESPERA_429_MS },
    )
    const suyas = (r.results ?? []).filter(f => f.items?.some(i => i.code === cfg.productoCode))
    if (suyas.length === 0) continue

    const f = suyas[0]
    console.log(`  marca  ${(n.codigo ?? '?').padEnd(8)} ya facturado en Siigo: ${f.name}`)
    marcados++
    if (!commit) continue

    const metadata = {
      ...((n.metadata ?? {}) as Record<string, unknown>),
      siigo_factura: {
        numero: f.name ?? '(sin número)',
        siigo_id: f.id ?? '',
        total: 0,
        emitida: true,
        at: f.date ? `${f.date}T00:00:00.000Z` : new Date().toISOString(),
        por: null,
        // Deja dicho que la factura NO la emitió ONE: la encontró. El total no se
        // copia porque el de Siigo puede diferir del honorario de ONE y una cifra
        // inventada en un registro de plata es peor que su ausencia.
        origen: 'encontrada_en_siigo',
      },
    }
    const { error } = await one.from('negocios').update({ metadata }).eq('id', n.id).eq('workspace_id', wsId)
    if (error) console.error(`    ERROR marcando ${n.codigo}: ${error.message}`)
  }

  // ── 2. Crear los terceros que faltan ───────────────────────────────────────
  let creados = 0, yaEstaban = 0, incompletos = 0, errores = 0
  if (!soloMarcas) {
    for (const n of cola) {
      if (!idPorNegocio.get(n.id)) continue
      if (!commit) {
        // En simulación no se llama a Siigo por cada caso: eso son cientos de
        // peticiones para no escribir nada. El conteo real de cuántos faltan lo
        // da `cruzar-cola-con-siigo.ts`, que los trae en lote.
        continue
      }
      const r = await asegurarClienteSiigo(wsId, n.id, 'automatico', ESPERA_429_MS)
      if (r.estado === 'creado') { creados++; console.log(`  crea   ${(n.codigo ?? '?').padEnd(8)} ${r.identificacion}`) }
      else if (r.estado === 'ya_existia') yaEstaban++
      else if (r.estado === 'incompleto') { incompletos++; console.log(`  falta  ${(n.codigo ?? '?').padEnd(8)} ${r.faltantes.join(', ')}`) }
      else { errores++; console.error(`  ERROR  ${(n.codigo ?? '?').padEnd(8)} ${r.mensaje}`) }
    }
  }

  console.log(`\n── Resumen ──`)
  console.log(`  Casos marcados como ya facturados: ${marcados}`)
  if (!soloMarcas) {
    if (commit) {
      console.log(`  Terceros creados:                  ${creados}`)
      console.log(`  Ya existían:                       ${yaEstaban}`)
      console.log(`  Sin datos suficientes:             ${incompletos}`)
      console.log(`  Errores:                           ${errores}`)
    } else {
      console.log(`  Terceros: corre cruzar-cola-con-siigo.ts para el conteo, o --commit para crearlos.`)
    }
  }
  if (!commit) console.log(`\n  Nada se escribió. Repite con --commit para aplicar.`)
}

main().catch(e => { console.error(e); process.exit(1) })
