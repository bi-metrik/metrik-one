import './_load-env'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { calcularDvNit } from '../src/lib/dian/nit'
import { registrarCorrecciones } from '../src/lib/correcciones/registrar'

/**
 * Corrige las identificaciones (casilla 5 del RUT) que quedaron mal guardadas por
 * `nit_sin_dv` — ver el aviso de ÁMBITO en `src/lib/dian/nit.ts` y el PR #394.
 *
 * NO decide por criterio propio: cada corrección exige que DOS documentos
 * independientes coincidan en el número correcto —la casilla 26 del RUT y el
 * certificado UPME— o, cuando la casilla 26 también viene sucia, que el número del
 * UPME cuadre por aritmética del DV con lo que hay en la casilla 5. Todo lo que no
 * llegue a ese estándar sale como REVISAR y no se toca: cédulas de extranjería
 * (donde el NIT asignado difiere del documento por diseño), personas jurídicas
 * (donde el UPME imprime el NIT con su DV) y discrepancias reales entre documentos.
 *
 * Deja traza en `bloque_correcciones` + timeline, con causa `error_captura`, para
 * que la corrección se vea en el producto y no solo en el log de un script.
 *
 * Idempotente: al volver a correr, lo ya corregido deja de aparecer como discrepancia.
 *   npx tsx scripts/fix-identificaciones-recortadas.ts [--apply]
 */

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const AUTOR = 'Corrección sistémica — nit_sin_dv (PR #394)'
const D = (s: unknown) => String(s ?? '').replace(/\D/g, '')

type Caso = {
  cod: string; negocioId: string; rutId: string
  nit: string; dv: string; ni: string; upme: string
  tipoDoc: string; tipoPer: string
  veredicto: string; correcto: string; razon: string
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data, error } = await sb
    .from('negocio_bloques')
    .select('id,data,negocio_id,bloque_configs!inner(slug),negocios!inner(codigo,workspace_id)')
    .in('bloque_configs.slug', ['rut', 'concepto_upme'])
    .limit(5000)
  if (error) throw error

  const m = new Map<string, Partial<Caso>>()
  type Fila = { id: string; data: Record<string, unknown> | null; negocio_id: string
    bloque_configs: { slug: string }; negocios: { codigo: string; workspace_id: string } }
  for (const nb of (data ?? []) as unknown as Fila[]) {
    if (nb.negocios.workspace_id !== WS) continue
    const c = (((nb.data ?? {}) as Record<string, unknown>).campos ?? {}) as Record<string, { value?: unknown }>
    const e = m.get(nb.negocio_id) ?? { negocioId: nb.negocio_id, cod: nb.negocios.codigo }
    if (nb.bloque_configs.slug === 'rut') {
      e.rutId = nb.id
      e.nit = D(c.nit?.value); e.dv = D(c.dv?.value); e.ni = D(c.numero_identificacion?.value)
      e.tipoDoc = String(c.tipo_documento?.value ?? ''); e.tipoPer = String(c.tipo_persona?.value ?? '')
    } else e.upme = D(c.numero_identificacion_certificado?.value)
    m.set(nb.negocio_id, e)
  }

  const casos: Caso[] = []
  for (const r of [...m.values()] as Caso[]) {
    if (!r.nit || !r.upme || r.nit === r.upme) continue
    let veredicto = 'REVISAR', correcto = '', razon = ''
    if (/extranjer/i.test(r.tipoDoc)) { veredicto = 'OK-CEx'; razon = 'cédula de extranjería: el NIT asignado difiere del documento por diseño' }
    else if (/jur/i.test(r.tipoPer) || /^NIT$/i.test(r.tipoDoc.trim())) { veredicto = 'OK-jurídica'; razon = 'persona jurídica: el certificado UPME trae el NIT con su DV' }
    else if (r.ni && r.ni === r.upme) {
      veredicto = r.nit.length < r.upme.length ? 'RECORTADO' : 'DV-PEGADO'
      correcto = r.upme; razon = 'casilla 26 y certificado UPME coinciden en un número distinto al de la casilla 5'
    }
    else if (r.upme === r.nit + calcularDvNit(r.nit)) {
      if (r.ni.endsWith(r.upme)) { veredicto = 'RECORTADO'; correcto = r.upme; razon = 'la casilla 26 termina en el número del UPME (trae el código de tipo pegado adelante)' }
      else if (r.ni === r.nit) { veredicto = 'OK-upme-con-dv'; razon = 'casillas 5 y 26 coinciden: es el UPME el que trae el DV pegado' }
      else razon = 'aritmética ambigua y la casilla 26 no desempata'
    }
    else if (r.nit === r.upme + calcularDvNit(r.upme)) { veredicto = 'DV-PEGADO'; correcto = r.upme; razon = 'la casilla 5 trae el DV pegado' }
    else razon = 'ni recorte ni DV pegado: discrepancia real entre documentos'
    casos.push({ ...r, veredicto, correcto, razon })
  }
  casos.sort((a, b) => a.cod.localeCompare(b.cod))

  for (const v of ['RECORTADO', 'DV-PEGADO', 'REVISAR', 'OK-CEx', 'OK-jurídica', 'OK-upme-con-dv']) {
    const g = casos.filter(c => c.veredicto === v)
    if (!g.length) continue
    console.log(`\n### ${v} (${g.length})`)
    for (const c of g) {
      const destino = c.correcto ? ` → ${c.correcto} (dv ${calcularDvNit(c.correcto)})` : ''
      console.log(`  ${c.cod}  casilla5=${c.nit}${destino}  casilla26=${c.ni} upme=${c.upme}  | ${c.razon}`)
    }
  }

  const aCorregir = casos.filter(c => c.correcto)
  console.log(`\n${aCorregir.length} identificaciones a corregir, ${casos.filter(c => c.veredicto === 'REVISAR').length} a revisar a mano.`)
  if (!apply) { console.log('dry-run: usa --apply'); return }

  const sesionId = randomUUID()
  let hechas = 0
  for (const c of aCorregir) {
    const dvNuevo = calcularDvNit(c.correcto)!
    const { data: bloque } = await sb.from('negocio_bloques').select('data').eq('id', c.rutId).single()
    const dataActual = ((bloque?.data ?? {}) as Record<string, unknown>)
    const campos = (dataActual.campos ?? {}) as Record<string, Record<string, unknown>>
    const marca = { editado_por_id: '', editado_por_nombre: AUTOR, editado_en: new Date().toISOString() }
    const dvPrevio = String(campos.dv?.value ?? '')
    campos.nit = { value: c.correcto, confidence: 1.0, manual: false, edicion: marca }
    campos.dv = { value: dvNuevo, confidence: 1.0, manual: false, edicion: marca }
    dataActual.campos = campos

    const { error: upErr } = await sb.from('negocio_bloques')
      .update({ data: dataActual, updated_at: new Date().toISOString() }).eq('id', c.rutId)
    if (upErr) { console.error(`  ✗ ${c.cod}: ${upErr.message}`); continue }

    const cambios = [{ slug: 'nit', antes: c.nit, despues: c.correcto }]
    if (dvPrevio !== dvNuevo) cambios.push({ slug: 'dv', antes: dvPrevio, despues: dvNuevo })
    await registrarCorrecciones({
      supabase: sb, workspaceId: WS, userId: undefined, staffId: null, userNombre: AUTOR,
      negocioBloqueId: c.rutId, campos: cambios, causa: 'error_captura', sesionId,
    })
    hechas++
    console.log(`  ✔ ${c.cod}  ${c.nit} → ${c.correcto} (dv ${dvPrevio} → ${dvNuevo})`)
  }
  console.log(`\n${hechas}/${aCorregir.length} corregidas. sesion_id=${sesionId}`)
}

main().catch(e => { console.error(e); process.exit(1) })
