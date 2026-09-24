/**
 * Lee los COMPRADORES de las facturas ya cargadas, sin re-extraer nada más.
 *
 *   npx tsx scripts/backfill-compradores-factura.ts <workspace_slug>                 # simulación
 *   npx tsx scripts/backfill-compradores-factura.ts <workspace_slug> --commit        # escribe
 *   npx tsx scripts/backfill-compradores-factura.ts soena --solo V0207,V0151         # unos casos
 *
 * Opciones:
 *   --bloque <slug>        bloque de la factura (default `factura_venta_vehiculo`)
 *   --campos <a,b>         campos a leer (default `compradores,cantidad_compradores`)
 *   --todos                también negocios cerrados (default: solo `estado = abierto`)
 *   --concurrencia <n>     facturas en paralelo contra Gemini (default 4)
 *
 * ── Por qué es un script aparte y no el reproceso ────────────────────────────
 * El reproceso vuelve a extraer TODOS los campos y pisa lo que el bloque tenía, incluido
 * lo que alguien corrigió a mano con confianza baja. Este script le pide a la IA SOLO los
 * campos nuevos y los agrega con `completarCampos`: un campo que el bloque ya trae —con
 * valor, corregido a mano o vacío de un intento anterior— no se toca. No cambia el estado
 * del bloque, ni el cruce guardado, ni ningún otro campo.
 *
 * ── Antes de correrlo ────────────────────────────────────────────────────────
 * Los campos tienen que estar declarados en la config del bloque (la migración
 * `20260924190000_soena_datos_clave_y_titularidad.sql` para SOENA). Sin eso el script
 * se niega: la descripción que se le da a la IA sale de ESA config, no de este archivo.
 *
 * ── Qué deja ─────────────────────────────────────────────────────────────────
 * Un JSON con cada caso (código, compradores leídos, cantidad y la titularidad del caso)
 * en `backfill-compradores-<workspace>-<fecha>.json`, en simulación y con --commit. Los
 * casos donde la cantidad no coincide con la titularidad se listan al final: son los que
 * la tarjeta de datos clave va a mostrar en rojo.
 *
 * Idempotente: una factura que ya trae los campos se reporta `ya_tenia` y no se toca.
 * Cada escritura relee el bloque justo antes de escribir, para no pisar lo que otra
 * persona haya guardado mientras corría la extracción.
 *
 * Corre con service_role (bypasea RLS). Solo lee archivos de Drive; una factura guardada
 * por referencia (`one://`, almacenamiento externo) se reporta y se salta.
 */
import './_load-env'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { extractFieldsFromDocument, type CampoExtraccion, type CampoResultado } from '../src/lib/ai/extract-fields'
import { completarCampos, faltanCampos } from '../src/lib/documentos/completar-campos'
import { mimeEfectivo } from '../src/lib/documentos/mime'
import { parsearPersonas } from '../src/lib/documentos/personas'
import { extraerDriveFileId } from '../src/lib/compliance/documentos'
import { traerTodo } from '../src/lib/supabase/paginar'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(n)
const opcion = (n: string) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : undefined
}
const SLUG = args[0]
if (!SLUG || SLUG.startsWith('--')) {
  console.error('Uso: npx tsx scripts/backfill-compradores-factura.ts <workspace_slug> [--commit] [--solo V0001,V0002]')
  process.exit(1)
}
const COMMIT = flag('--commit')
const BLOQUE = opcion('--bloque') ?? 'factura_venta_vehiculo'
const CAMPOS = (opcion('--campos') ?? 'compradores,cantidad_compradores').split(',').map(s => s.trim()).filter(Boolean)
const SOLO = new Set((opcion('--solo') ?? '').split(',').map(s => s.trim()).filter(Boolean))
const TODOS = flag('--todos')
const CONCURRENCIA = Math.max(1, Number(opcion('--concurrencia') ?? 4))

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})
const GEMINI = process.env.GEMINI_API_KEY
if (!GEMINI) {
  console.error('Falta GEMINI_API_KEY en .env.local')
  process.exit(1)
}

type Fila = {
  id: string
  bloque_config_id: string
  data: Record<string, unknown> | null
  negocios: { id: string; codigo: string | null; estado: string | null; workspace_id: string } | null
}

type Resultado = {
  codigo: string | null
  negocio_id: string
  bloque_id: string
  estado: 'escrito' | 'simulado' | 'ya_tenia' | 'sin_archivo' | 'no_drive' | 'error'
  compradores?: string | null
  cantidad?: string | null
  titularidad?: string | null
  error?: string
}

async function main() {
  const { data: ws, error: errWs } = await supabase.from('workspaces').select('id').eq('slug', SLUG).maybeSingle()
  if (errWs || !ws) throw new Error(`workspace ${SLUG} no encontrado: ${errWs?.message ?? ''}`)
  const workspaceId = (ws as { id: string }).id

  const { data: cfgs, error: errCfg } = await supabase
    .from('bloque_configs').select('id, config_extra').eq('workspace_id', workspaceId).eq('slug', BLOQUE)
  if (errCfg) throw new Error(`configs: ${errCfg.message}`)
  const configs = (cfgs ?? []) as Array<{ id: string; config_extra: { campos_extraccion?: CampoExtraccion[] } | null }>
  if (configs.length === 0) throw new Error(`el workspace no tiene bloques con slug ${BLOQUE}`)

  // La descripción de cada campo sale de la config del bloque, no de este archivo.
  const camposPorConfig = new Map<string, CampoExtraccion[]>()
  for (const c of configs) {
    const declarados = (c.config_extra?.campos_extraccion ?? []).filter(x => CAMPOS.includes(x.slug))
    if (declarados.length !== CAMPOS.length) {
      throw new Error(
        `el bloque ${c.id} no declara ${CAMPOS.join(', ')} en campos_extraccion: aplique primero la migración de configuración`,
      )
    }
    camposPorConfig.set(c.id, declarados)
  }

  const filas = await traerTodo<Fila>(
    (desde, hasta) => {
      let q = supabase
        .from('negocio_bloques')
        .select('id, bloque_config_id, data, negocios!inner(id, codigo, estado, workspace_id)')
        .in('bloque_config_id', configs.map(c => c.id))
        .eq('negocios.workspace_id', workspaceId)
      if (!TODOS) q = q.eq('negocios.estado', 'abierto')
      return q.order('id').range(desde, hasta) as unknown as PromiseLike<{ data: Fila[] | null; error: { message: string } | null }>
    },
    { etiqueta: 'facturas del workspace' },
  )
  const objetivo = filas.filter(f => SOLO.size === 0 || SOLO.has(f.negocios?.codigo ?? ''))

  // Titularidad de cada caso, solo para el reporte.
  const titularidad = new Map<string, string>()
  const ids = [...new Set(objetivo.map(f => f.negocios?.id).filter((x): x is string => !!x))]
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase
      .from('negocio_bloques')
      .select('negocio_id, data, bloque_configs!inner(slug)')
      .eq('bloque_configs.slug', 'titularidad')
      .in('negocio_id', ids.slice(i, i + 100))
    for (const r of (data ?? []) as Array<{ negocio_id: string; data: Record<string, unknown> | null }>) {
      const v = r.data?.modalidad_solicitante
      if (typeof v === 'string') titularidad.set(r.negocio_id, v)
    }
  }

  const { downloadDriveFile } = await import('../src/lib/google-drive')

  async function procesar(f: Fila): Promise<Resultado> {
    const base = {
      codigo: f.negocios?.codigo ?? null,
      negocio_id: f.negocios?.id ?? '',
      bloque_id: f.id,
      titularidad: titularidad.get(f.negocios?.id ?? '') ?? null,
    }
    const data = f.data ?? {}
    const campos = (data.campos ?? null) as Record<string, CampoResultado> | null
    if (!faltanCampos(campos, CAMPOS)) return { ...base, estado: 'ya_tenia' }

    const url = typeof data.drive_url === 'string' ? data.drive_url : ''
    const fileId = (typeof data.drive_file_id === 'string' && data.drive_file_id) || (url ? extraerDriveFileId(url) : null)
    if (!url && !fileId) return { ...base, estado: 'sin_archivo' }
    if (!fileId) return { ...base, estado: 'no_drive', error: url.slice(0, 40) }

    try {
      const buffer = await downloadDriveFile(fileId, workspaceId)
      const nombre = typeof data.file_name === 'string' ? data.file_name : 'factura.pdf'
      const mime = mimeEfectivo(buffer, nombre.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
      const r = await extractFieldsFromDocument(buffer, mime, camposPorConfig.get(f.bloque_config_id)!, GEMINI!)
      if (!r.data) return { ...base, estado: 'error', error: r.error ?? 'extracción vacía' }
      const leido = {
        compradores: r.data.compradores?.value ?? null,
        cantidad: r.data.cantidad_compradores?.value ?? null,
      }
      if (!COMMIT) return { ...base, ...leido, estado: 'simulado' }

      // Se relee justo antes de escribir: entre la lectura inicial y ahora pasaron
      // segundos de extracción, y alguien pudo guardar algo en este mismo bloque.
      const { data: fresco, error: errLeer } = await supabase
        .from('negocio_bloques').select('data').eq('id', f.id).single()
      if (errLeer || !fresco) return { ...base, ...leido, estado: 'error', error: errLeer?.message ?? 'no se pudo releer' }
      const dataFresca = ((fresco as { data: Record<string, unknown> | null }).data ?? {}) as Record<string, unknown>
      const { campos: nuevos, agregados } = completarCampos(
        dataFresca.campos as Record<string, CampoResultado> | null,
        r.data,
        CAMPOS,
      )
      if (agregados.length === 0) return { ...base, ...leido, estado: 'ya_tenia' }
      const { error: errEscribir } = await supabase
        .from('negocio_bloques')
        .update({
          data: {
            ...dataFresca,
            campos: nuevos,
            _campos_completados: {
              campos: agregados,
              at: new Date().toISOString(),
              via: 'scripts/backfill-compradores-factura.ts',
            },
          },
        })
        .eq('id', f.id)
      if (errEscribir) return { ...base, ...leido, estado: 'error', error: errEscribir.message }
      return { ...base, ...leido, estado: 'escrito' }
    } catch (e) {
      return { ...base, estado: 'error', error: e instanceof Error ? e.message : String(e) }
    }
  }

  console.log(`${COMMIT ? 'ESCRIBIENDO' : 'SIMULACIÓN'} · ${objetivo.length} facturas · campos ${CAMPOS.join(', ')}`)
  const resultados: Resultado[] = []
  for (let i = 0; i < objetivo.length; i += CONCURRENCIA) {
    const lote = await Promise.all(objetivo.slice(i, i + CONCURRENCIA).map(procesar))
    for (const r of lote) {
      resultados.push(r)
      console.log(`${r.codigo ?? r.negocio_id}\t${r.estado}\t${r.cantidad ?? ''}\t${r.compradores ?? r.error ?? ''}`)
    }
  }

  const MAPEO: Record<string, number> = { unico: 1, copropiedad: 2 }
  const contradicen = resultados.filter(r => {
    const esperado = r.titularidad ? MAPEO[r.titularidad] : undefined
    const n = r.cantidad ? Number(r.cantidad) : parsearPersonas(r.compradores).length || undefined
    return esperado !== undefined && n !== undefined && n !== esperado
  })
  const conteo = resultados.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.estado]: (acc[r.estado] ?? 0) + 1 }), {})
  const archivo = `backfill-compradores-${SLUG}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(archivo, JSON.stringify({ commit: COMMIT, conteo, contradicen, resultados }, null, 2))
  console.log('\nResumen:', conteo)
  console.log(`Cantidad de compradores distinta de la titularidad: ${contradicen.length}`)
  for (const r of contradicen) console.log(`  ${r.codigo}\t${r.titularidad}\t${r.cantidad}\t${r.compradores}`)
  console.log(`Detalle en ${archivo}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
