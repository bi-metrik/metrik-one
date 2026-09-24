/**
 * Corrige el número de identificación con el código del TIPO de documento pegado delante
 * (casilla 25 del RUT leída junto con la 26) y el `nit_completo` con el DV repetido.
 *
 *   npx tsx scripts/fix-prefijo-tipo-documento.ts <workspace_slug>            # simulación
 *   npx tsx scripts/fix-prefijo-tipo-documento.ts <workspace_slug> --commit   # escribe
 *   npx tsx scripts/fix-prefijo-tipo-documento.ts soena --solo V0521,V0177
 *
 * ── El error ─────────────────────────────────────────────────────────────────
 * V0521 guardó la casilla 26 como 1380180688 con la casilla 5 en 80180688: «13» es el
 * código de cédula de ciudadanía. V0177 (132747706 por 32747706) llegó a imprimirlo en la
 * declaración juramentada y la relación de facturas para la DIAN. El código ya lo corrige
 * al extraer (`normalizarIdentificacionRut`); este script arregla lo que ya estaba guardado.
 *
 * ── Qué corrige (y nada más) ─────────────────────────────────────────────────
 * Con el MISMO criterio del código (`sinPrefijoDeTipo`): testigo = otra casilla, nunca la
 * forma del número por sí sola.
 *   1. RUT y RUT del segundo titular (y sus copias sin slug): `campos.numero_identificacion`
 *      = «13»/«1» + la casilla 5 del mismo bloque (o, en una copia con la casilla 5 mal
 *      leída, la del RUT origen del negocio). Con otro tipo de documento legible, no.
 *   2. `campos.nit_completo` con el DV dos veces («799074677-7» → «79907467-7»).
 *   3. `solicitantes_asociados.numero_identificacion` (dato plano) contra el NIT del RUT.
 *   4. `campos_override` de los bloques que generan documentos (declaración, relación,
 *      carta, 010, 1668): la casilla que alguien escribió a mano con el prefijo.
 *
 * ── Qué NO toca, a propósito ─────────────────────────────────────────────────
 * - `campos_usados` y `formulario_versiones.datos_snapshot`: son la foto de lo que YA se
 *   imprimió. Reescribirlos haría decir a ONE que el PDF radicado trae el número bueno
 *   cuando trae el malo. Se LISTAN como documentos por regenerar.
 * - Un campo que una persona editó a mano: se lista para revisar, no se pisa.
 * - Una casilla 26 distinta de la 5 sin el patrón (cédula de ciudadanía): se lista; no se
 *   sabe cuál de las dos se leyó mal.
 *
 * Traza: marca «Editado · <autor>» en el campo, `leido` con el valor viejo, y
 * `bloque_correcciones` + línea en el timeline con causa `error_captura`
 * (`registrarCorrecciones`). Idempotente: lo corregido deja de aparecer.
 * Corre con service_role. Cada escritura relee el bloque justo antes de escribir.
 */
import './_load-env'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  esCedulaDeCiudadania,
  esOtroTipoDeDocumento,
  nitCompletoSinDvDoble,
  sinPrefijoDeTipo,
} from '../src/lib/dian/prefijo-tipo-documento'
import { traerTodo } from '../src/lib/supabase/paginar'

const AUTOR = 'Corrección sistémica — prefijo del tipo de documento'
const args = process.argv.slice(2)
const SLUG = args[0]
if (!SLUG || SLUG.startsWith('--')) {
  console.error('Uso: npx tsx scripts/fix-prefijo-tipo-documento.ts <workspace_slug> [--commit] [--solo V0001,V0002]')
  process.exit(1)
}
const COMMIT = args.includes('--commit')
const iSolo = args.indexOf('--solo')
const SOLO = new Set((iSolo >= 0 ? args[iSolo + 1] ?? '' : '').split(',').map(s => s.trim()).filter(Boolean))

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

type Campo = { value?: unknown; edicion?: { editado_por_nombre?: string } | null; [k: string]: unknown }
type Fila = {
  id: string
  negocio_id: string
  data: Record<string, unknown> | null
  bloque_configs: { slug: string | null } | null
  negocios: { codigo: string; estado: string; workspace_id: string }
}

/** Casillas de documentos generados que imprimen el número de un titular, y de qué RUT sale. */
const OVERRIDES_TITULAR: Record<string, 'rut' | 'rut_solicitante_2'> = {
  numero_identificacion: 'rut',
  nit: 'rut',
  beneficiario_identificacion: 'rut',
  numero_identificacion_2: 'rut_solicitante_2',
  autorizante_identificacion: 'rut_solicitante_2',
}

type Cambio = {
  cod: string
  estado: string
  bloqueId: string
  bloque: string
  tipo: 'casilla_26' | 'nit_completo' | 'solicitantes_asociados' | 'override'
  campo: string
  antes: string
  despues: string
}
type Aviso = { cod: string; estado: string; bloque: string; que: string }

const d = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const valor = (c: unknown) => (c && typeof c === 'object' ? (c as Campo).value : c) as unknown
const editado = (c: unknown) => !!(c && typeof c === 'object' && (c as Campo).edicion)

async function filas(etiqueta: string, filtro: string): Promise<Fila[]> {
  return traerTodo<Fila>(
    (desde, hasta) =>
      sb
        .from('negocio_bloques')
        .select('id, negocio_id, data, bloque_configs(slug), negocios!inner(codigo, estado, workspace_id)')
        .eq('negocios.workspace_id', WS)
        .not(filtro, 'is', null)
        .order('id')
        .range(desde, hasta) as unknown as PromiseLike<{ data: Fila[] | null; error: { message: string } | null }>,
    { etiqueta },
  )
}

let WS = ''

async function main() {
  const { data: ws, error: wsErr } = await sb.from('workspaces').select('id, name').eq('slug', SLUG).maybeSingle()
  if (wsErr || !ws) throw new Error(`workspace ${SLUG} no encontrado: ${wsErr?.message ?? ''}`)
  WS = ws.id as string
  console.log(`Workspace ${ws.name} (${WS}) — ${COMMIT ? 'ESCRIBE (--commit)' : 'simulación (sin --commit no se escribe nada)'}\n`)

  const [conIdentificacion, conNitCompleto, planos, conOverride, conUsados] = await Promise.all([
    filas('casilla 26', 'data->campos->numero_identificacion'),
    filas('nit_completo', 'data->campos->nit_completo'),
    filas('solicitantes_asociados', 'data->numero_identificacion'),
    filas('overrides', 'data->campos_override'),
    filas('campos_usados', 'data->campos_usados'),
  ])
  const enAlcance = (f: Fila) => SOLO.size === 0 || SOLO.has(f.negocios.codigo)

  // NIT (casilla 5) de los RUT ORIGEN de cada negocio: el testigo de todo lo demás.
  const nitOrigen = new Map<string, { rut?: string; rut_solicitante_2?: string }>()
  for (const f of [...conIdentificacion, ...conNitCompleto]) {
    const slug = f.bloque_configs?.slug
    if (slug !== 'rut' && slug !== 'rut_solicitante_2') continue
    const campos = (f.data?.campos ?? {}) as Record<string, unknown>
    const nit = d(valor(campos.nit))
    if (!nit) continue
    nitOrigen.set(f.negocio_id, { ...nitOrigen.get(f.negocio_id), [slug]: nit })
  }

  const cambios: Cambio[] = []
  const revisar: Aviso[] = []
  const regenerar: Aviso[] = []
  const vistos = new Set<string>()

  // 1 y 2. RUT, RUT 2 y copias.
  for (const f of [...conIdentificacion, ...conNitCompleto]) {
    if (vistos.has(f.id) || !enAlcance(f)) continue
    vistos.add(f.id)
    const campos = (f.data?.campos ?? {}) as Record<string, unknown>
    if (!('nit' in campos)) continue // no es un RUT
    const slug = f.bloque_configs?.slug ?? null
    const nombre = slug ?? '(copia heredada)'
    const base = { cod: f.negocios.codigo, estado: f.negocios.estado, bloqueId: f.id, bloque: nombre }
    const nit = d(valor(campos.nit))

    const nc = valor(campos.nit_completo)
    const ncBueno = nc ? nitCompletoSinDvDoble(nc, nit) : null
    if (ncBueno) {
      if (editado(campos.nit_completo)) revisar.push({ ...base, que: `nit_completo ${nc} editado a mano` })
      else cambios.push({ ...base, tipo: 'nit_completo', campo: 'nit_completo', antes: String(nc), despues: ncBueno })
    }

    const tipo = valor(campos.tipo_documento)
    const ni = d(valor(campos.numero_identificacion))
    if (!ni || esOtroTipoDeDocumento(tipo)) continue
    const origen = nitOrigen.get(f.negocio_id) ?? {}
    const testigos = slug ? [nit] : [nit, origen.rut, origen.rut_solicitante_2]
    const limpio = testigos.map(t => sinPrefijoDeTipo(ni, t)).find(Boolean) ?? null
    if (limpio) {
      if (editado(campos.numero_identificacion)) {
        revisar.push({ ...base, que: `casilla 26 ${ni} (prefijo de ${limpio}) editada a mano: no se pisa` })
      } else {
        cambios.push({ ...base, tipo: 'casilla_26', campo: 'numero_identificacion', antes: ni, despues: limpio })
      }
    } else if (slug && esCedulaDeCiudadania(tipo) && nit && ni !== nit) {
      revisar.push({ ...base, que: `cédula de ciudadanía con casilla 26 ${ni} ≠ casilla 5 ${nit}, sin el patrón del prefijo` })
    }
  }

  // 3. solicitantes_asociados (dato plano, sin `campos`).
  for (const f of planos) {
    if (!enAlcance(f) || f.bloque_configs?.slug !== 'solicitantes_asociados') continue
    const ni = d(f.data?.numero_identificacion)
    const limpio = sinPrefijoDeTipo(ni, nitOrigen.get(f.negocio_id)?.rut)
    if (limpio) {
      cambios.push({
        cod: f.negocios.codigo, estado: f.negocios.estado, bloqueId: f.id, bloque: 'solicitantes_asociados',
        tipo: 'solicitantes_asociados', campo: 'numero_identificacion', antes: ni, despues: limpio,
      })
    }
  }

  // 4. Overrides de documentos generados; y lo ya impreso, solo para listar.
  for (const f of conOverride) {
    if (!enAlcance(f)) continue
    const ov = (f.data?.campos_override ?? {}) as Record<string, unknown>
    for (const [k, rutSlug] of Object.entries(OVERRIDES_TITULAR)) {
      const limpio = sinPrefijoDeTipo(ov[k], nitOrigen.get(f.negocio_id)?.[rutSlug])
      if (limpio) {
        cambios.push({
          cod: f.negocios.codigo, estado: f.negocios.estado, bloqueId: f.id, bloque: f.bloque_configs?.slug ?? '?',
          tipo: 'override', campo: k, antes: d(ov[k]), despues: limpio,
        })
      }
    }
  }
  for (const f of conUsados) {
    if (!enAlcance(f)) continue
    const usados = (f.data?.campos_usados ?? {}) as Record<string, unknown>
    for (const [k, rutSlug] of Object.entries(OVERRIDES_TITULAR)) {
      const limpio = sinPrefijoDeTipo(usados[k], nitOrigen.get(f.negocio_id)?.[rutSlug])
      if (limpio) {
        regenerar.push({
          cod: f.negocios.codigo, estado: f.negocios.estado, bloque: f.bloque_configs?.slug ?? '?',
          que: `${k} impreso ${d(usados[k])} (debía ser ${limpio}): regenerar el documento`,
        })
      }
    }
  }

  const orden = (a: { cod: string }, b: { cod: string }) => a.cod.localeCompare(b.cod)
  console.log(`### Correcciones (${cambios.length})`)
  for (const c of cambios.sort(orden)) {
    console.log(`  ${c.cod} [${c.estado}] ${c.bloque}.${c.campo} (${c.tipo}): ${c.antes} → ${c.despues}`)
  }
  console.log(`\n### Documentos ya generados con el número malo: regenerar (${regenerar.length})`)
  for (const r of regenerar.sort(orden)) console.log(`  ${r.cod} [${r.estado}] ${r.bloque}: ${r.que}`)
  console.log(`\n### Revisar a mano, no se tocan (${revisar.length})`)
  for (const r of revisar.sort(orden)) console.log(`  ${r.cod} [${r.estado}] ${r.bloque}: ${r.que}`)

  if (!COMMIT) {
    console.log('\nSimulación: no se escribió nada. Con --commit se aplican las correcciones de arriba.')
    return
  }

  // La traza vive en un módulo de servidor: se importa solo en el camino que escribe.
  const { registrarCorrecciones } = await import('../src/lib/correcciones/registrar')
  const sesionId = randomUUID()
  const marca = { editado_por_id: '', editado_por_nombre: AUTOR, editado_en: new Date().toISOString() }
  const porBloque = new Map<string, Cambio[]>()
  for (const c of cambios) porBloque.set(c.bloqueId, [...(porBloque.get(c.bloqueId) ?? []), c])

  let hechos = 0
  for (const [bloqueId, cs] of porBloque) {
    const { data: fresco, error: rErr } = await sb.from('negocio_bloques').select('data').eq('id', bloqueId).single()
    if (rErr || !fresco) { console.error(`  ✗ ${cs[0].cod}: no se pudo releer el bloque (${rErr?.message})`); continue }
    const data = { ...((fresco.data ?? {}) as Record<string, unknown>) }
    const aplicados: Cambio[] = []
    for (const c of cs) {
      if (c.tipo === 'casilla_26' || c.tipo === 'nit_completo') {
        const campos = { ...((data.campos ?? {}) as Record<string, Campo>) }
        const prev = campos[c.campo] ?? {}
        const actual = c.tipo === 'nit_completo' ? String(prev.value ?? '') : d(prev.value)
        if (actual !== c.antes || prev.edicion) continue // cambió mientras tanto: no se pisa
        campos[c.campo] = { ...prev, value: c.despues, leido: String(prev.value ?? ''), confidence: 1, manual: false, edicion: marca }
        data.campos = campos
      } else if (c.tipo === 'solicitantes_asociados') {
        if (d(data.numero_identificacion) !== c.antes) continue
        data.numero_identificacion = c.despues
      } else {
        const ov = { ...((data.campos_override ?? {}) as Record<string, unknown>) }
        if (d(ov[c.campo]) !== c.antes) continue
        ov[c.campo] = c.despues
        data.campos_override = ov
      }
      aplicados.push(c)
    }
    if (aplicados.length === 0) continue
    const { error: uErr } = await sb
      .from('negocio_bloques')
      .update({ data, updated_at: new Date().toISOString() })
      .eq('id', bloqueId)
    if (uErr) { console.error(`  ✗ ${cs[0].cod}: ${uErr.message}`); continue }
    await registrarCorrecciones({
      supabase: sb, workspaceId: WS, userId: undefined, staffId: null, userNombre: AUTOR,
      negocioBloqueId: bloqueId,
      campos: aplicados.map(c => ({ slug: c.campo, antes: c.antes, despues: c.despues })),
      causa: 'error_captura', sesionId,
    })
    hechos += aplicados.length
    for (const c of aplicados) console.log(`  ✔ ${c.cod} ${c.bloque}.${c.campo}: ${c.antes} → ${c.despues}`)
  }
  console.log(`\n${hechos}/${cambios.length} correcciones aplicadas. sesion_id=${sesionId}`)
}

main().catch(e => { console.error(e); process.exit(1) })
