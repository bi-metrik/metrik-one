/**
 * Corrige, en los documentos YA cargados, los campos que la IA leyó distinto de lo que
 * dice la capa de texto del PDF. Es la misma regla que desde ahora corre al extraer
 * (`src/lib/ai/verificar-contra-texto.ts`), aplicada hacia atrás.
 *
 *   npx tsx scripts/corregir-campos-contra-texto-pdf.ts soena                     # simulación
 *   npx tsx scripts/corregir-campos-contra-texto-pdf.ts soena --con-digitos       # + dígito distinto
 *   npx tsx scripts/corregir-campos-contra-texto-pdf.ts soena --con-digitos --commit
 *
 * Opciones:
 *   --bloques <a,b>   slugs de bloque (default `concepto_upme,concepto_upme_anexos`)
 *   --solo <V1,V2>    solo esos negocios
 *   --todos           también negocios cerrados (default: solo `estado = abierto`)
 *   --con-digitos     además de las confusiones de lectura (rn↔m, l↔1, O↔0…), propone el
 *                     ÚNICO valor del mismo tipo en el texto, del mismo largo, a una o dos
 *                     posiciones de distancia (p. ej. un radicado leído con 0 donde el PDF
 *                     dice 9). Esa corrección NO la hace la regla al extraer: se revisa a
 *                     mano antes de pasar --commit.
 *   --commit          escribe. Sin él no toca la base.
 *
 * ── Qué escribe y qué no ─────────────────────────────────────────────────────
 * Solo el campo afectado: `value` pasa a lo que dice el texto, `leido` guarda lo que leyó
 * la IA y `origen: 'texto_pdf'`. No reprocesa (el reproceso borra datos), no cambia el
 * estado del bloque, ni el cruce guardado, ni ningún otro campo. Un campo tocado por una
 * persona (`edicion`, o `manual: true` con valor) no se toca. Cada escritura relee el
 * bloque y se salta si el valor cambió mientras tanto.
 *
 * ── Respaldo ─────────────────────────────────────────────────────────────────
 * Antes de la primera escritura deja `respaldo-campos-texto-pdf-<ws>-<fecha>.json` con el
 * `data` COMPLETO de cada bloque que va a tocar. El reporte (simulación o no) queda en
 * `corregir-campos-texto-pdf-<ws>-<fecha>.json`. Ninguno de los dos se versiona: traen
 * datos de clientes; correr el script desde una carpeta fuera del repo o borrarlos.
 *
 * Corre con service_role (bypasea RLS). Solo lee archivos de Drive.
 */
import './_load-env'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { CampoExtraccion, CampoResultado } from '../src/lib/ai/extract-fields'
import { textoDelPdf } from '../src/lib/ai/texto-pdf'
import {
  candidatoCorrector,
  candidatosEnTexto,
  estaEnTexto,
  tipoVerificable,
  type TipoVerificable,
} from '../src/lib/ai/verificar-contra-texto'
import { campoProtegido } from '../src/lib/documentos/normalizaciones'
import { mimeEfectivo } from '../src/lib/documentos/mime'
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
  console.error('Uso: npx tsx scripts/corregir-campos-contra-texto-pdf.ts <workspace_slug> [--con-digitos] [--commit]')
  process.exit(1)
}
const COMMIT = flag('--commit')
const CON_DIGITOS = flag('--con-digitos')
const TODOS = flag('--todos')
const BLOQUES = (opcion('--bloques') ?? 'concepto_upme,concepto_upme_anexos').split(',').map(s => s.trim()).filter(Boolean)
const SOLO = new Set((opcion('--solo') ?? '').split(',').map(s => s.trim()).filter(Boolean))

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

type Fila = {
  id: string
  bloque_config_id: string
  data: Record<string, unknown> | null
  negocios: { id: string; codigo: string | null; estado: string | null } | null
}

type Hallazgo = {
  codigo: string | null
  bloque_id: string
  bloque: string
  campo: string
  tipo: TipoVerificable
  leido: string
  propuesta: string | null
  motivo: 'confusion_lectura' | 'digito_distinto' | 'sin_candidato'
  estado: 'simulado' | 'escrito' | 'cambio_mientras_corria' | 'solo_reporte' | 'error'
  error?: string
}

/** El único valor del mismo tipo y largo en el texto, a 1 o 2 posiciones de distancia. */
function candidatoPorDigito(valor: string, tipo: TipoVerificable, texto: string): string | null {
  const v = valor.toLowerCase()
  const cerca = candidatosEnTexto(texto, tipo).filter(c => {
    if (c.length !== v.length) return false
    let d = 0
    for (let i = 0; i < v.length; i++) if (c[i].toLowerCase() !== v[i]) d++
    return d >= 1 && d <= 2
  })
  const distintos = [...new Set(cerca.map(c => c.toLowerCase()))]
  return distintos.length === 1 ? cerca[0] : null
}

async function main() {
  const { data: ws, error: errWs } = await supabase.from('workspaces').select('id').eq('slug', SLUG).maybeSingle()
  if (errWs || !ws) throw new Error(`workspace ${SLUG} no encontrado: ${errWs?.message ?? ''}`)
  const workspaceId = (ws as { id: string }).id

  const { data: cfgs, error: errCfg } = await supabase
    .from('bloque_configs').select('id, slug, config_extra').eq('workspace_id', workspaceId).in('slug', BLOQUES)
  if (errCfg) throw new Error(`configs: ${errCfg.message}`)
  const configs = (cfgs ?? []) as Array<{ id: string; slug: string; config_extra: { campos_extraccion?: CampoExtraccion[] } | null }>
  if (configs.length === 0) throw new Error(`el workspace no tiene bloques ${BLOQUES.join(', ')}`)
  const slugDeConfig = new Map(configs.map(c => [c.id, c.slug]))
  // Solo campos `texto`: los mismos que verifica la regla al extraer.
  const camposTexto = new Map(configs.map(c => [
    c.id,
    (c.config_extra?.campos_extraccion ?? []).filter(x => x.tipo === 'texto').map(x => x.slug),
  ]))

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
    { etiqueta: 'bloques del workspace' },
  )
  const objetivo = filas.filter(f => SOLO.size === 0 || SOLO.has(f.negocios?.codigo ?? ''))

  const { downloadDriveFile } = await import('../src/lib/google-drive')
  const textos = new Map<string, string | null>()
  const hallazgos: Hallazgo[] = []
  const conteo = { bloques: objetivo.length, sin_archivo: 0, sin_capa_texto: 0, error_descarga: 0 }

  for (const f of objetivo) {
    const data = f.data ?? {}
    const campos = (data.campos ?? {}) as Record<string, CampoResultado>
    const url = typeof data.drive_url === 'string' ? data.drive_url : ''
    const fileId = (typeof data.drive_file_id === 'string' && data.drive_file_id) || (url ? extraerDriveFileId(url) : null)
    if (!fileId) { conteo.sin_archivo++; continue }

    if (!textos.has(fileId)) {
      try {
        const buffer = await downloadDriveFile(fileId, workspaceId)
        const esPdf = mimeEfectivo(buffer, 'application/pdf') === 'application/pdf'
        textos.set(fileId, esPdf ? await textoDelPdf(buffer) : null)
      } catch (e) {
        console.warn(`${f.negocios?.codigo}: no se pudo bajar ${fileId}: ${e instanceof Error ? e.message : e}`)
        conteo.error_descarga++
        continue
      }
    }
    const texto = textos.get(fileId)
    if (!texto) { conteo.sin_capa_texto++; continue }

    for (const slug of camposTexto.get(f.bloque_config_id) ?? []) {
      const c = campos[slug]
      if (!c?.value || campoProtegido(c)) continue
      const leido = String(c.value)
      const tipo = tipoVerificable(leido)
      if (!tipo || estaEnTexto(leido, tipo, texto)) continue
      let propuesta = candidatoCorrector(leido, tipo, texto)
      let motivo: Hallazgo['motivo'] = 'confusion_lectura'
      if (!propuesta) {
        const porDigito = candidatoPorDigito(leido, tipo, texto)
        propuesta = porDigito
        motivo = porDigito ? 'digito_distinto' : 'sin_candidato'
      }
      if (propuesta && tipo === 'correo') propuesta = propuesta.toLowerCase()
      const aplica = propuesta !== null && (motivo === 'confusion_lectura' || CON_DIGITOS)
      hallazgos.push({
        codigo: f.negocios?.codigo ?? null,
        bloque_id: f.id,
        bloque: slugDeConfig.get(f.bloque_config_id) ?? '',
        campo: slug,
        tipo,
        leido,
        propuesta,
        motivo,
        estado: aplica ? 'simulado' : 'solo_reporte',
      })
    }
  }

  const sello = new Date().toISOString().replace(/[:.]/g, '-')
  const aEscribir = hallazgos.filter(h => h.estado === 'simulado')

  if (COMMIT && aEscribir.length > 0) {
    const ids = [...new Set(aEscribir.map(h => h.bloque_id))]
    const respaldo = objetivo.filter(f => ids.includes(f.id)).map(f => ({ id: f.id, codigo: f.negocios?.codigo, data: f.data }))
    const archivoRespaldo = `respaldo-campos-texto-pdf-${SLUG}-${sello}.json`
    writeFileSync(archivoRespaldo, JSON.stringify(respaldo, null, 2))
    console.log(`Respaldo: ${archivoRespaldo} (${respaldo.length} bloques)`)

    for (const h of aEscribir) {
      // Se relee justo antes de escribir: alguien pudo corregir el campo a mano.
      const { data: fresco, error: errLeer } = await supabase.from('negocio_bloques').select('data').eq('id', h.bloque_id).single()
      if (errLeer || !fresco) { h.estado = 'error'; h.error = errLeer?.message ?? 'no se pudo releer'; continue }
      const dataFresca = ((fresco as { data: Record<string, unknown> | null }).data ?? {}) as Record<string, unknown>
      const camposFrescos = (dataFresca.campos ?? {}) as Record<string, CampoResultado>
      const actual = camposFrescos[h.campo]
      if (!actual || String(actual.value) !== h.leido || campoProtegido(actual)) { h.estado = 'cambio_mientras_corria'; continue }
      const { error: errEscribir } = await supabase
        .from('negocio_bloques')
        .update({
          data: {
            ...dataFresca,
            campos: { ...camposFrescos, [h.campo]: { ...actual, value: h.propuesta, leido: h.leido, origen: 'texto_pdf' } },
          },
        })
        .eq('id', h.bloque_id)
      if (errEscribir) { h.estado = 'error'; h.error = errEscribir.message; continue }
      h.estado = 'escrito'
    }
  }

  for (const h of hallazgos) {
    console.log(`${h.codigo}\t${h.bloque}\t${h.campo}\t${h.leido} → ${h.propuesta ?? '(sin candidato)'}\t${h.motivo}\t${h.estado}`)
  }
  const archivo = `corregir-campos-texto-pdf-${SLUG}-${sello}.json`
  writeFileSync(archivo, JSON.stringify({ commit: COMMIT, con_digitos: CON_DIGITOS, conteo, hallazgos }, null, 2))
  console.log(`${COMMIT ? 'ESCRITO' : 'SIMULACIÓN'} · ${JSON.stringify(conteo)} · ${hallazgos.length} hallazgos · reporte ${archivo}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
