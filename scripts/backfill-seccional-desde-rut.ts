/**
 * Rellena `negocios.metadata.seccional` a partir de la "Dirección seccional" del RUT.
 *
 *   npx tsx scripts/backfill-seccional-desde-rut.ts <workspace_slug>            # dry run
 *   npx tsx scripts/backfill-seccional-desde-rut.ts <workspace_slug> --commit   # escribe
 *
 * Por qué: hay negocios cuyo bloque RUT trae una seccional DIAN perfectamente
 * reconocible y aun así `metadata.seccional` quedó en NULL — el auto-init que la
 * siembra (`getNegocioDetalle`, rama `cita_dian_confirmacion`) solo corre cuando el
 * bloque de confirmación de cita aplica y alguien ABRE el negocio, así que los casos
 * cuya rama no lo activa nunca reciben el dato. De ese campo cuelgan la casilla 12 del
 * Formato 010, el buzón de la Guía de Devolución y el corte con/sin cita del tablero
 * de Proceso: un NULL ahí no rompe nada visiblemente, solo deja el caso fuera del corte.
 *
 * Hermano de `backfill-seccional-canonica.ts`, y no se pisan: aquel LLEVA A CANÓNICO lo
 * que ya está escrito; este RELLENA lo que falta. Correr aquel primero si conviven
 * variantes viejas del vocabulario.
 *
 * ⚠️ La escritura NO toca el campo directo: pasa por `fijarSeccionalNegocio`, que es el
 * único camino que lo escribe. Esa función canoniza contra el catálogo
 * (`src/lib/dian/seccionales.ts`), no pisa lo que ya existe y DESCARTA lo que no
 * reconoce en vez de degradarlo. Escribir el campo a mano aquí reintroduciría
 * exactamente el defecto que ese módulo vino a cerrar: tres caminos de escritura con
 * tres vocabularios distintos sobre un dato que todo el mundo compara por texto.
 *
 * ⚠️ El bloque del que se lee NO se hardcodea: sale de la misma config que usa el
 * producto (`bloque_configs.config_extra.cita_dian_confirmacion.rut_slug` /
 * `.seccional_field`). Si una línea renombra su bloque de RUT, el backfill la sigue;
 * hardcodear 'rut' habría leído cero filas en silencio, que es el peor resultado
 * posible — indistinguible de "no había nada que rellenar".
 *
 * Idempotente: un negocio que ya tiene seccional se reporta `ya_tenia` y no se toca,
 * incluso si otra sesión se la puso entre el dry run y el --commit (la función relee el
 * estado actual antes de escribir).
 *
 * Corre con service_role (bypasea RLS).
 */
import './_load-env'
import { createClient } from '@supabase/supabase-js'
import { canonizarSeccional } from '../src/lib/dian/seccionales'
import { fijarSeccionalNegocio } from '../src/lib/negocios/seccional-negocio'

const COMMIT = process.argv.includes('--commit')
const SLUG = process.argv[2]
if (!SLUG || SLUG.startsWith('--')) {
  console.error('Uso: npx tsx scripts/backfill-seccional-desde-rut.ts <workspace_slug> [--commit]')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

// Los mismos defaults que aplica el producto cuando la config no los declara.
const RUT_SLUG_DEFAULT = 'rut'
const SECCIONAL_FIELD_DEFAULT = 'direccion_seccional'

type Negocio = {
  id: string
  codigo: string | null
  estado: string | null
  metadata: Record<string, unknown> | null
}

/** De dónde leer la seccional, según la config de las líneas del workspace. */
async function resolverFuente(workspaceId: string): Promise<{ rutSlugs: string[]; campos: string[] }> {
  const { data: lineas } = await supabase
    .from('lineas_negocio').select('id').eq('workspace_id', workspaceId)
  const lineaIds = ((lineas ?? []) as Array<{ id: string }>).map(l => l.id)

  const rutSlugs = new Set<string>()
  const campos = new Set<string>()

  if (lineaIds.length > 0) {
    const { data: etapas } = await supabase
      .from('etapas_negocio').select('id').in('linea_id', lineaIds)
    const etapaIds = ((etapas ?? []) as Array<{ id: string }>).map(e => e.id)
    if (etapaIds.length > 0) {
      const { data: bcs } = await supabase
        .from('bloque_configs').select('config_extra').in('etapa_id', etapaIds)
      for (const bc of ((bcs ?? []) as Array<{ config_extra: Record<string, any> | null }>)) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const c = bc.config_extra?.cita_dian_confirmacion
        if (!c) continue
        rutSlugs.add(c.rut_slug ?? RUT_SLUG_DEFAULT)
        campos.add(c.seccional_field ?? SECCIONAL_FIELD_DEFAULT)
      }
    }
  }

  if (rutSlugs.size === 0) rutSlugs.add(RUT_SLUG_DEFAULT)
  if (campos.size === 0) campos.add(SECCIONAL_FIELD_DEFAULT)
  return { rutSlugs: [...rutSlugs], campos: [...campos] }
}

async function main() {
  const { data: ws, error: wsErr } = await supabase
    .from('workspaces').select('id, name').eq('slug', SLUG).maybeSingle()
  if (wsErr) throw new Error(`workspace: ${wsErr.message}`)
  if (!ws) throw new Error(`No existe el workspace "${SLUG}"`)
  const workspaceId = (ws as { id: string }).id

  const { rutSlugs, campos } = await resolverFuente(workspaceId)

  // TODOS los negocios, no solo los abiertos: un caso cerrado sigue alimentando el
  // histórico del tablero y sus documentos se pueden regenerar.
  const { data: negs, error } = await supabase
    .from('negocios').select('id, codigo, estado, metadata').eq('workspace_id', workspaceId)
  if (error) throw new Error(`negocios: ${error.message}`)
  const filas = (negs ?? []) as unknown as Negocio[]
  const ids = filas.map(n => n.id)

  // Bloques RUT del workspace, paginados.
  const bloques: Array<{ negocio_id: string; data: Record<string, unknown> | null }> = []
  if (ids.length > 0) {
    for (let off = 0; ; off += 1000) {
      const { data, error: bErr } = await supabase
        .from('negocio_bloques')
        .select('negocio_id, data, bloque_configs!inner(slug)')
        .in('bloque_configs.slug', rutSlugs)
        .in('negocio_id', ids)
        .range(off, off + 999)
      if (bErr) throw new Error(`negocio_bloques: ${bErr.message}`)
      const page = (data ?? []) as unknown as typeof bloques
      bloques.push(...page)
      if (page.length < 1000) break
    }
  }

  // Texto crudo por negocio. El primero no vacío gana, igual que el auto-init.
  const textoPorNegocio = new Map<string, string>()
  for (const b of bloques) {
    if (textoPorNegocio.has(b.negocio_id)) continue
    const campos_ = ((b.data?.campos ?? {}) as Record<string, { value?: unknown }>)
    for (const campo of campos) {
      const v = String(campos_[campo]?.value ?? '').trim()
      if (v) { textoPorNegocio.set(b.negocio_id, v); break }
    }
  }

  const aEscribir: Array<{ id: string; codigo: string | null; texto: string; canonico: string }> = []
  const noReconocidos = new Map<string, string[]>()
  let yaTenian = 0
  let sinRut = 0

  for (const n of filas) {
    if (String(n.metadata?.seccional ?? '').trim()) { yaTenian++; continue }
    const texto = textoPorNegocio.get(n.id)
    if (!texto) { sinRut++; continue }
    // MISMA función que aplica `fijarSeccionalNegocio` al escribir: el dry run no puede
    // predecir con un criterio propio, o diría "escribiría X" donde la escritura descarta.
    const canonico = canonizarSeccional(texto)
    if (!canonico) {
      noReconocidos.set(texto, [...(noReconocidos.get(texto) ?? []), n.codigo ?? n.id])
      continue
    }
    aEscribir.push({ id: n.id, codigo: n.codigo, texto, canonico })
  }

  const porValor = new Map<string, number>()
  for (const c of aEscribir) porValor.set(c.canonico, (porValor.get(c.canonico) ?? 0) + 1)

  console.log(`\nWorkspace: ${(ws as { name: string }).name} (${SLUG})`)
  console.log(`Fuente: bloque(s) "${rutSlugs.join('", "')}" · campo(s) "${campos.join('", "')}"`)
  console.log(`\nNegocios revisados: ${filas.length}`)
  console.log(`  ya tenían seccional (no se tocan): ${yaTenian}`)
  console.log(`  sin seccional y sin RUT/campo:     ${sinRut}`)
  console.log(`  sin seccional, texto no reconocido: ${[...noReconocidos.values()].reduce((a, b) => a + b.length, 0)}`)
  console.log(`  POR ESCRIBIR:                      ${aEscribir.length}`)

  if (porValor.size > 0) {
    console.log('\nPor valor canónico:')
    for (const [k, v] of [...porValor].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(4)}  ${k}`)
    }
    console.log('\nDetalle:')
    for (const c of aEscribir.sort((a, b) => (a.codigo ?? '').localeCompare(b.codigo ?? ''))) {
      console.log(`  ${(c.codigo ?? c.id).padEnd(8)} "${c.texto}" → ${c.canonico}`)
    }
  }

  if (noReconocidos.size > 0) {
    console.log('\n⚠️  NO reconocidos (no se escriben; decidir a mano):')
    for (const [texto, codigos] of noReconocidos) {
      const muestra = codigos.slice(0, 10).join(', ')
      const resto = codigos.length > 10 ? `, +${codigos.length - 10}` : ''
      console.log(`  "${texto}" — ${codigos.length} caso(s): ${muestra}${resto}`)
    }
  } else {
    console.log('\nNo reconocidos: ninguno.')
  }

  if (!COMMIT) {
    console.log('\nDRY RUN. Nada se escribió. Volver a correr con --commit para aplicar.\n')
    return
  }

  console.log('\nEscribiendo…')
  let ok = 0
  const rechazos: string[] = []
  for (const c of aEscribir) {
    const r = await fijarSeccionalNegocio(supabase, { negocioId: c.id, entrada: c.texto })
    if (r.error) { rechazos.push(`${c.codigo ?? c.id}: error ${r.error}`); continue }
    if (!r.guardado) { rechazos.push(`${c.codigo ?? c.id}: ${r.motivo}${r.previo ? ` (previo "${r.previo}")` : ''}`); continue }
    if (r.guardado !== c.canonico) { rechazos.push(`${c.codigo ?? c.id}: se esperaba "${c.canonico}" y quedó "${r.guardado}"`); continue }
    ok++
  }
  console.log(`\n${ok} de ${aEscribir.length} escritos.`)
  if (rechazos.length > 0) {
    console.log('\nNo escritos:')
    for (const r of rechazos) console.log(`  ${r}`)
  }
  console.log('')
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
