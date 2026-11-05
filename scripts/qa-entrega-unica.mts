/**
 * QA de la ENTREGA ÚNICA del bloqueo (Trappvel, brief del 2026-11-04) por el flujo nuevo, con el modelo
 * real (Haiku 5.5 por la API), la plantilla real del PDF y la base de ONE EN MEMORIA: no lee ni escribe
 * Supabase y no envía WhatsApp. El chat se simula con la misma regla del webhook (`decidirAncla`).
 *
 *   npx tsx scripts/qa-entrega-unica.mts --qa <proyectos/trappvel/clarity/qa> --salida <dir> [--solo 1,2] [--intercalados]
 *
 * Por cada caso de `<qa>/2026-11-04_entrega-unica-bloqueo/casos/*.json`: los mensajes y los pantallazos
 * entran como en WhatsApp → `procesarPedido` → se contesta lo que preguntó (como lo haría la asesora) →
 * `procesarRespuesta` → PDF. Compara contra `esperado` del caso.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { clienteDelTexto, decidirAncla, tieneSenalDeBloqueo, type EntregaAbierta, type MensajeEntrante } from '../supabase/functions/_shared/entrega-bloqueo-ancla'
import { procesarPedido, procesarRespuesta, responderTipo, type Deps, type Entrega, type Salida } from '../src/lib/cotizaciones/entrega-unica/flujo'
import { llamadorAnthropic } from '../src/lib/cotizaciones/entrega-unica/llamada'
import { entregaNueva, puertoEnMemoria } from '../src/lib/cotizaciones/entrega-unica/puerto-memoria'
import { pdfDeLaEntrega } from '../src/lib/cotizaciones/entrega-unica/pdf'
import type { Casa } from '../src/lib/cotizaciones/asistente/a-propuesta'
import type { Pantallazo } from '../src/lib/cotizaciones/asistente/armar-con-modelo'

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); if (i >= 0) return process.argv[i + 1]; if (d !== undefined) return d; throw new Error(`Falta --${n}`) }
const QA = path.resolve(arg('qa'))
const ENTREGA = path.join(QA, '2026-11-04_entrega-unica-bloqueo')
const PILOTO = path.join(QA, '2026-11-03_piloto-asistente-cotizacion')
const SALIDA = path.resolve(arg('salida'))
const SOLO = arg('solo', '').split(',').filter(Boolean)
mkdirSync(SALIDA, { recursive: true })

const manual = `MANUAL DE LA ENTREGA:\n${readFileSync(path.join(ENTREGA, 'manual-entrega.md'), 'utf8')}\n\nMANUAL DE COTIZACIÓN:\n${readFileSync(path.join(PILOTO, 'manual-de-la-casa.md'), 'utf8')}`
const casa = JSON.parse(readFileSync(path.join(PILOTO, 'casa.json'), 'utf8')) as Casa
const HOY = '2026-11-04'

function pantallazosDe(dir: string): { ref: string; p: Pantallazo }[] {
  return readdirSync(dir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort().map(f => ({
    ref: path.join(dir, f),
    p: { nombre: f, mime: f.endsWith('.png') ? 'image/png' : 'image/jpeg', base64: readFileSync(path.join(dir, f)).toString('base64') },
  }))
}

/** Un chat de WhatsApp simulado contra el puerto en memoria: lo que hace el webhook con cada mensaje. */
function chat(puerto: ReturnType<typeof puertoEnMemoria>, deps: Deps) {
  let reloj = Date.parse(`${HOY}T20:00:00Z`)
  let n = 0
  const log: string[] = []
  const preguntasDeAncla: { piezaId: string; opciones: { id: string; titulo: string }[] }[] = []
  const ahora = () => new Date(reloj)
  const abiertas = (): EntregaAbierta[] => [...puerto.estado.entregas.values()]
    .filter(e => !['listo', 'a_medida', 'error'].includes(e.estado))
    .map(e => {
      const pz = puerto.estado.piezas.filter(p => p.entregaId === e.id)
      return {
        id: e.id, codigo: e.codigo, cliente: e.salida?.requisitos.cliente ?? pz.filter(p => p.direccion === 'entrante' && p.tipo === 'texto').map(p => clienteDelTexto(p.texto)).find(Boolean) ?? null, estado: e.estado as EntregaAbierta['estado'],
        wamids: pz.map(p => p.wamid).filter((x): x is string => !!x),
        tieneEncabezado: pz.some(p => p.direccion === 'entrante' && p.tipo === 'texto' && tieneSenalDeBloqueo(p.texto)),
        ultimaEn: pz.map(p => p.en).sort().at(-1) ?? new Date(reloj).toISOString(),
      }
    })

  const enviar = (entregaId: string | null, salidas: Salida[]) => {
    const wamids: string[] = []
    for (const s of salidas) {
      const wamid = `out-${++n}`
      wamids.push(wamid)
      puerto.estado.piezas.push({ id: `pz-${n}`, entregaId: entregaId ?? '', direccion: 'saliente', wamid, contextoWamid: null, tipo: s.tipo === 'documento' ? 'documento' : 'texto', texto: s.tipo === 'documento' ? s.caption : s.texto, mediaRef: null, mime: null, en: new Date(reloj).toISOString() })
      log.push(`TRAPPI → ${s.tipo === 'documento' ? `[PDF ${s.nombre}]\n${s.caption}` : s.tipo === 'botones' ? `${s.texto} [${s.botones.map(b => b.titulo).join(' | ')}]` : s.texto}`)
    }
    return wamids
  }

  /** Un mensaje de la asesora. Devuelve su wamid. */
  async function entra(m: MensajeEntrante & { mediaRef?: string }): Promise<string> {
    reloj += 2_000
    const wamid = `in-${++n}`
    const piezaId = `pz-${n}`
    log.push(`ASESORA${m.contextoWamid ? ` (citando ${m.contextoWamid})` : ''} → ${m.tipo === 'imagen' ? `[pantallazo ${path.basename(m.mediaRef ?? '')}]` : m.texto ?? m.botonId}`)
    const d = decidirAncla(m, abiertas(), piezaId, ahora())
    const pieza = (entregaId: string) => puerto.estado.piezas.push({
      id: piezaId, entregaId, direccion: 'entrante', wamid, contextoWamid: m.contextoWamid, tipo: m.tipo === 'imagen' ? 'imagen' : m.tipo === 'boton' ? 'boton' : 'texto',
      texto: m.texto, mediaRef: m.mediaRef ?? null, mime: m.tipo === 'imagen' ? 'image/png' : null, en: new Date(reloj).toISOString(),
    })
    log.push(`   ancla: ${JSON.stringify(d.accion === 'preguntar' ? { accion: d.accion, opciones: d.opciones.map(o => o.titulo) } : d)}`)
    switch (d.accion) {
      case 'nueva': {
        const id = `E${puerto.estado.entregas.size + 1}`
        puerto.estado.entregas.set(id, entregaNueva(id, 'ws-qa', 'staff-asesora', '573000000000', new Date(reloj).toISOString()))
        pieza(id)
        break
      }
      case 'agregar': pieza(d.entregaId); break
      case 'responder': pieza(d.entregaId); enviar(d.entregaId, await procesarRespuesta(d.entregaId, m.texto ?? '', deps)); break
      case 'tipo': enviar(d.entregaId, await responderTipo(d.entregaId, d.tipo, deps)); break
      case 'asignar': {
        const pz = puerto.estado.piezas.find(p => p.id === d.piezaId)!
        if (d.entregaId === 'nuevo') {
          const id = `E${puerto.estado.entregas.size + 1}`
          puerto.estado.entregas.set(id, entregaNueva(id, 'ws-qa', 'staff-asesora', '573000000000', new Date(reloj).toISOString()))
          pz.entregaId = id
        } else pz.entregaId = d.entregaId
        break
      }
      case 'preguntar': {
        pieza('') // queda sin pedido hasta que ella elija
        enviar(null, [{ tipo: 'botones', texto: d.motivo, botones: d.opciones }])
        preguntasDeAncla.push({ piezaId, opciones: d.opciones })
        break
      }
      case 'otro': log.push('   (fuera de la entrega: flujo de siempre)')
    }
    return wamid
  }

  /** El silencio después de una tanda: lo que hace el webhook pasado el tiempo de espera. */
  async function silencio(): Promise<void> {
    reloj += 25_000
    for (const e of abiertas()) {
      if (e.estado !== 'recibiendo') continue
      const pz = puerto.estado.piezas.filter(p => p.entregaId === e.id && p.direccion === 'entrante')
      if (!pz.some(p => p.tipo === 'imagen') && !pz.some(p => tieneSenalDeBloqueo(p.texto))) continue
      const sal = await procesarPedido(e.id, deps)
      enviar(e.id, sal)
    }
  }

  return { entra, silencio, log, preguntasDeAncla, avanzar: (ms: number) => { reloj += ms }, ahora }
}

/** Lo que contestaría la asesora a cada pregunta (sin datos que el caso no tenga). */
function respuestaA(e: Entrega): string | null {
  if (e.preguntas.some(q => q.clave === 'viajeros')) return null
  const partes = e.preguntas.map(q => `${q.numero} ${q.clave === 'tarifa' ? 'pública' : 'sí aplica'}`)
  return partes.length ? `sí, ${partes.join(', ')}` : 'sí'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function revisar(caso: any, e: Entrega, totales: Record<string, number>, pdf: boolean): string[] {
  const x = caso.esperado, q = e.salida?.requisitos, fallas: string[] = []
  const chk = (ok: boolean, m: string) => { if (!ok) fallas.push(m) }
  chk(q?.tipoViaje === x.tipoViaje, `tipo ${q?.tipoViaje} ≠ ${x.tipoViaje}`)
  if (x.adultos !== undefined) chk(q?.viajeros?.adultos === x.adultos, `adultos ${q?.viajeros?.adultos} ≠ ${x.adultos}`)
  if (x.edadesNinos) chk(JSON.stringify((q?.viajeros?.ninos ?? []).map(n => n.edad)) === JSON.stringify(x.edadesNinos), `niños ${JSON.stringify(q?.viajeros?.ninos)} ≠ ${JSON.stringify(x.edadesNinos)}`)
  if (x.faltaViajeros) chk(!q?.viajeros && e.preguntas.some(p => p.clave === 'viajeros'), 'no pidió los viajeros o los supuso')
  chk(q?.destino === x.destino, `destino ${q?.destino} ≠ ${x.destino}`)
  chk(q?.ciudadOrigen === x.ciudadOrigen, `origen ${q?.ciudadOrigen} ≠ ${x.ciudadOrigen}`)
  chk(q?.fechaIda === x.fechaIda, `ida ${q?.fechaIda} ≠ ${x.fechaIda}`)
  chk(q?.noches === x.noches, `noches ${q?.noches} ≠ ${x.noches}`)
  chk(pdf === x.conBorrador, x.conBorrador ? 'no salió el PDF' : 'salió PDF sin saber los viajeros')
  if (x.totales) for (const [v, t] of Object.entries(x.totales)) chk(totales[v] === t, `${v} ${totales[v]} ≠ ${t}`)
  return fallas
}

const deps = (puerto: ReturnType<typeof puertoEnMemoria>): Deps => ({ puerto, modelo: llamadorAnthropic })

function montarPuerto(pantallazos: { ref: string; p: Pantallazo }[]) {
  const mapa = new Map(pantallazos.map(x => [x.ref, x.p]))
  let reloj = () => new Date()
  const puerto = puertoEnMemoria({
    config: { manual, casa }, pantallazos: mapa, ahora: () => reloj(),
    renderPdf: async (e, x) => pdfDeLaEntrega({ codigo: e.codigo!, hoy: HOY, borrador: x.borrador, validado: x.validado, requisitos: x.requisitos, pantallazos: x.pantallazos, casa: x.casa }),
  })
  return { puerto, fijarReloj: (f: () => Date) => { reloj = f } }
}

async function caso(archivo: string) {
  const c = JSON.parse(readFileSync(archivo, 'utf8'))
  const nombre = path.basename(archivo, '.json')
  const dirPant = path.resolve(path.dirname(archivo), c.pantallazos)
  const pant = pantallazosDe(dirPant)
  const { puerto, fijarReloj } = montarPuerto(pant)
  const ch = chat(puerto, deps(puerto))
  fijarReloj(ch.ahora)
  const t0 = Date.now()
  for (const m of c.mensajes) await ch.entra({ tipo: 'texto', texto: m, contextoWamid: null, botonId: null })
  for (const p of pant) await ch.entra({ tipo: 'imagen', texto: null, contextoWamid: null, botonId: null, mediaRef: p.ref })
  await ch.silencio()
  let e = [...puerto.estado.entregas.values()][0]
  // Si preguntó «¿bloqueo o a medida?», ella toca «Bloqueo».
  if (e?.estado === 'tipo_por_confirmar') { await ch.entra({ tipo: 'boton', texto: null, contextoWamid: null, botonId: `eb|tipo|bloqueo|${e.id}` }); e = puerto.estado.entregas.get(e.id)! }
  const confirmacion = puerto.estado.piezas.filter(p => p.entregaId === e.id && p.direccion === 'saliente').at(-1)
  const resp = e.estado === 'por_confirmar' ? respuestaA(e) : null
  if (resp && confirmacion) await ch.entra({ tipo: 'texto', texto: resp, contextoWamid: confirmacion.wamid, botonId: null })
  e = puerto.estado.entregas.get(e.id)!
  const cot = puerto.estado.cotizaciones.find(x => x.id === e.cotizacionId)
  const pdf = puerto.estado.pdfs.at(-1)
  if (pdf) writeFileSync(path.join(SALIDA, `${nombre} - ${pdf.nombre}`), pdf.pdf)
  const fallas = e ? revisar(c, e, cot?.totales ?? {}, !!pdf && pdf.bytes > 1000) : ['no se abrió ninguna entrega']
  const viaje = puerto.estado.viajes[0]
  const resumen = {
    caso: nombre, s: Math.round((Date.now() - t0) / 1000), estado: e?.estado, codigo: e?.codigo,
    requisitos: e?.salida?.requisitos, preguntas: e?.preguntas.map(q => `${q.clave}${q.pantallazo ? `@${q.pantallazo}` : ''}`),
    preguntasPrimerMensaje: undefined as unknown, totales: cot?.totales, pdfBytes: pdf?.bytes ?? 0,
    viaje: viaje ? { etapa: viaje.etapa, modalidad: viaje.modalidad, contacto: viaje.contactoId } : null,
    historialEtapas: puerto.estado.historialEtapas, tiempos: e?.tiempos, uso: e?.uso,
    hallazgos: e?.validacion?.hallazgos, fallas,
  }
  writeFileSync(path.join(SALIDA, `${nombre}.json`), JSON.stringify(resumen, null, 1))
  writeFileSync(path.join(SALIDA, `${nombre}.chat.txt`), ch.log.join('\n'))
  console.log(JSON.stringify({ caso: nombre, s: resumen.s, estado: resumen.estado, totales: resumen.totales, pdf: resumen.pdfBytes, preguntas: resumen.preguntas, fallas }))
  return fallas.length === 0
}

/**
 * Dos pedidos intercalados en el mismo chat: Laura (Santa Marta) y Marta (San Andrés). Los
 * pantallazos de cada uno llegan citando el mensaje de su pedido, uno llega suelto (se pregunta y ella
 * elige), y las respuestas llegan citando la confirmación de cada uno, en orden cruzado.
 */
async function intercalados() {
  const sm = pantallazosDe(path.join(PILOTO, 'casos/santa-marta'))
  const sa = pantallazosDe(path.join(PILOTO, 'casos/san-andres'))
  const { puerto, fijarReloj } = montarPuerto([...sm, ...sa])
  const ch = chat(puerto, deps(puerto))
  fijarReloj(ch.ahora)
  const txt = (t: string, ctx: string | null = null) => ch.entra({ tipo: 'texto', texto: t, contextoWamid: ctx, botonId: null })
  const img = (ref: string, ctx: string | null = null) => ch.entra({ tipo: 'imagen', texto: null, contextoWamid: ctx, botonId: null, mediaRef: ref })

  const a = await txt('Trappi, bloqueo para Laura Gomez, van 2 adultos. Te mando los pantallazos')
  await img(sm[0].ref)                       // suelto: solo hay un pedido en curso → va a Laura
  const b = await txt('y otro: bloqueo de aliados para Marta Ruiz Peña, 3 adultos, San Andrés')
  await img(sa[0].ref, b)                    // citando el pedido de Marta
  await img(sm[1].ref, a)                    // citando el de Laura
  await img(sa[1].ref, b)
  await img(sm[2].ref)                       // SUELTO con dos pedidos en curso → tiene que preguntar
  const preg = ch.preguntasDeAncla.at(-1)
  const elegir = preg?.opciones.find(o => o.id.includes('|E1|'))
  if (elegir) await ch.entra({ tipo: 'boton', texto: null, contextoWamid: null, botonId: elegir.id })
  await img(sa[2].ref, b)
  await img(sm[3].ref, a)
  await img(sa[3].ref, b)
  await ch.silencio()

  const [eA, eB] = ['E1', 'E2'].map(i => puerto.estado.entregas.get(i)!)
  const confA = puerto.estado.piezas.filter(p => p.entregaId === 'E1' && p.direccion === 'saliente').at(-1)
  const confB = puerto.estado.piezas.filter(p => p.entregaId === 'E2' && p.direccion === 'saliente').at(-1)
  // Responde primero a Marta y luego a Laura, cada una citando su confirmación.
  const rB = respuestaA(eB), rA = respuestaA(eA)
  if (rB && confB) await txt(rB, confB.wamid)
  if (rA && confA) await txt(rA, confA.wamid)

  const fallas: string[] = []
  const refsDe = (id: string) => puerto.estado.piezas.filter(p => p.entregaId === id && p.tipo === 'imagen').map(p => p.mediaRef!)
  const cruzados = [...refsDe('E1').filter(r => !r.includes('/santa-marta/')), ...refsDe('E2').filter(r => !r.includes('/san-andres/'))]
  if (cruzados.length) fallas.push(`pantallazos cruzados: ${cruzados.map(r => path.basename(r)).join(', ')}`)
  if (refsDe('E1').length !== 4 || refsDe('E2').length !== 4) fallas.push(`pantallazos por pedido: E1 ${refsDe('E1').length}, E2 ${refsDe('E2').length}`)
  if (!preg) fallas.push('el pantallazo suelto con dos pedidos en curso no se preguntó')
  const totales = (id: string) => puerto.estado.cotizaciones.find(c => c.id === puerto.estado.entregas.get(id)!.cotizacionId)?.totales ?? {}
  const esperadoA = { Económica: 3040226, Recomendada: 3306050, Superior: 3685796 }
  const esperadoB = { Económica: 6884589, Recomendada: 7323615, Superior: 9332151 }
  for (const [v, t] of Object.entries(esperadoA)) if (totales('E1')[v] !== t) fallas.push(`Laura ${v} ${totales('E1')[v]} ≠ ${t}`)
  for (const [v, t] of Object.entries(esperadoB)) if (totales('E2')[v] !== t) fallas.push(`Marta ${v} ${totales('E2')[v]} ≠ ${t}`)
  for (const id of ['E1', 'E2']) if (puerto.estado.entregas.get(id)!.estado !== 'listo') fallas.push(`${id} quedó en ${puerto.estado.entregas.get(id)!.estado}`)
  puerto.estado.pdfs.forEach(p => writeFileSync(path.join(SALIDA, `intercalados - ${p.nombre}`), p.pdf))
  writeFileSync(path.join(SALIDA, 'intercalados.chat.txt'), ch.log.join('\n'))
  writeFileSync(path.join(SALIDA, 'intercalados.json'), JSON.stringify({
    entregas: [...puerto.estado.entregas.values()].map(e => ({ id: e.id, codigo: e.codigo, estado: e.estado, cliente: e.salida?.requisitos.cliente, pantallazos: refsDe(e.id).map(r => path.basename(path.dirname(r)) + '/' + path.basename(r)), totales: totales(e.id), preguntas: e.preguntas, tiempos: e.tiempos })),
    pdfs: puerto.estado.pdfs.map(p => ({ nombre: p.nombre, bytes: p.bytes })), fallas,
  }, null, 1))
  console.log(JSON.stringify({ caso: 'intercalados', estados: ['E1', 'E2'].map(i => puerto.estado.entregas.get(i)!.estado), pdfs: puerto.estado.pdfs.length, fallas }))
  return fallas.length === 0
}

const casos = readdirSync(path.join(ENTREGA, 'casos')).filter(f => f.endsWith('.json')).sort()
  .filter(f => !SOLO.length || SOLO.some(s => f.startsWith(`${s}-`)))
const resultados: boolean[] = []
if (!process.argv.includes('--solo-intercalados')) for (const f of casos) resultados.push(await caso(path.join(ENTREGA, 'casos', f)))
if (process.argv.includes('--intercalados') || process.argv.includes('--solo-intercalados')) resultados.push(await intercalados())
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length} sin fallas`)
process.exit(resultados.every(Boolean) ? 0 : 1)
