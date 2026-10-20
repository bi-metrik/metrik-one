/**
 * Una corrida por familia: llama la FUNCIÓN REAL de producción (mismo prompt, mismo esquema, mismo manejo de errores)
 * y compara lo que devuelve contra el oráculo. El modelo lo pone `fetchModelo` (Haiku 5.5, o el simulado en --mock).
 * La llave de Gemini que piden las firmas es un relleno: ninguna llamada a Gemini sale (la bloquea `entorno.ts`).
 */
import { comparar, parecido, type ComparacionCampo } from './comparar'

export interface Caso {
  familia: string
  id: string
  entrada: Record<string, unknown>
  oraculo: Record<string, unknown>
}

export interface ResultadoFamilia {
  campos: ComparacionCampo[]
  error?: string
  noAplica?: string
}

export interface Contexto {
  leerArchivo(entrada: Record<string, unknown>): Promise<{ buffer: Buffer; mime: string }>
  leerTextoDrive(fileId: string, workspaceId?: string): Promise<string>
}

/** Relleno para las firmas que todavía piden «apiKey» de Gemini. No se manda a ningún lado. */
const LLAVE_RELLENO = 'eval-haiku-sin-gemini'

type Corrida = (c: Caso, ctx: Contexto) => Promise<ResultadoFamilia>

const gastos: Corrida = async (c) => {
  process.env.GEMINI_API_KEY ||= LLAVE_RELLENO
  const { clasificarGastoConIA } = await import('../../src/lib/gastos/clasificar-gasto-ia')
  const r = await clasificarGastoConIA(String(c.entrada.descripcion ?? ''))
  if (!r) return { campos: [], error: 'sin propuesta' }
  // `origen: 'palabras'` = el modelo falló y entró el respaldo determinista: es un fallo del modelo.
  if (r.origen !== 'ia') return { campos: [], error: `el modelo no respondió bien (respaldo ${r.origen})` }
  const humano = c.oraculo.revisado === true
  const campos = [comparar('categoria', c.oraculo.categoria, r.categoria, humano)]
  if (['variable', 'fijo', 'no_operativo'].includes(String(c.oraculo.clasificacion))) {
    campos.push(comparar('clasificacion', c.oraculo.clasificacion, r.clasificacion, humano))
  }
  return { campos }
}

let denoListo = false
function shimDeno() {
  if (denoListo) return
  denoListo = true
  const g = globalThis as unknown as { Deno?: unknown }
  g.Deno ??= { env: { get: (k: string) => (k === 'GEMINI_API_KEY' ? process.env[k] || LLAVE_RELLENO : process.env[k]) } }
}

const intencionWa: Corrida = async (c) => {
  shimDeno()
  const m = await import('../../supabase/functions/_shared/wa-parse')
  const r = await m.parseMessage(String(c.entrada.texto ?? ''))
  const t = m.getLastParseTelemetry()
  if (t.parser_source === 'fast_path') return { campos: [], noAplica: 'lo resuelve el camino rápido sin modelo' }
  if (t.parser_source !== 'gemini') return { campos: [], error: `el modelo no respondió bien (cayó a ${t.parser_source})` }
  return { campos: [comparar('intent', c.oraculo.intent, r.intent)] }
}

const documento: Corrida = async (c, ctx) => {
  const { extractFieldsFromDocument } = await import('../../src/lib/ai/extract-fields')
  const campos = (c.entrada.campos ?? []) as Array<{ slug: string }>
  const { buffer, mime } = await ctx.leerArchivo(c.entrada)
  const r = await extractFieldsFromDocument(buffer, mime, campos as never, LLAVE_RELLENO)
  if (!r.data) return { campos: [], error: r.error ?? 'sin datos' }
  const oraculo = (c.oraculo.campos ?? {}) as Record<string, { value?: unknown; edicion?: unknown }>
  return {
    campos: campos
      .filter((k) => k.slug in oraculo)
      .map((k) => comparar(k.slug, oraculo[k.slug]?.value ?? null, r.data?.[k.slug]?.value ?? null, oraculo[k.slug]?.edicion !== undefined)),
  }
}

const CAMPOS_RUT: Array<[string, string]> = [
  ['nit', 'nit'], ['razon_social', 'razon_social'], ['tipo_persona', 'tipo_persona'], ['tipo_documento', 'tipo_documento'],
  ['regimen_tributario', 'regimen_tributario'], ['direccion_fiscal', 'direccion_fiscal'], ['municipio', 'municipio'],
  ['departamento', 'departamento'], ['telefono', 'telefono'], ['email_fiscal', 'email_fiscal'], ['actividad_ciiu', 'actividad_ciiu'],
  ['responsable_iva', 'responsable_iva'], ['gran_contribuyente', 'gran_contribuyente'], ['agente_retenedor', 'agente_retenedor'],
  ['autorretenedor', 'autorretenedor'], ['fecha_inicio_actividades', 'fecha_inicio_actividades'],
]

const rut: Corrida = async (c, ctx) => {
  const { parseRut } = await import('../../src/lib/rut/parse-rut')
  const { buffer, mime } = await ctx.leerArchivo(c.entrada)
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  const r = await parseRut(ab, mime, LLAVE_RELLENO)
  if (!r.data) return { campos: [], error: r.error ?? 'sin datos' }
  const d = r.data as unknown as Record<string, { value?: unknown } | undefined>
  // La empresa guardada es lo que la persona CONFIRMÓ: oráculo humano. Un campo vacío en la empresa no se califica.
  return {
    campos: CAMPOS_RUT
      .filter(([o]) => c.oraculo[o] !== null && c.oraculo[o] !== undefined && c.oraculo[o] !== '')
      .map(([o, k]) => comparar(o, c.oraculo[o], d[k]?.value ?? null, true)),
  }
}

const acta: Corrida = async (c, ctx) => {
  const { parseTranscripcion } = await import('../../src/lib/actas/transcripcion')
  const { generarActa } = await import('../../src/lib/actas/generacion')
  const texto = typeof c.entrada.transcripcion_texto === 'string'
    ? c.entrada.transcripcion_texto
    : await ctx.leerTextoDrive(String(c.entrada.transcript_file_id), c.entrada.workspace_id as string | undefined)
  const transcripcion = parseTranscripcion(texto)
  const candidata = {
    reunion: {
      eventId: c.id, titulo: (c.entrada.titulo as string) ?? transcripcion.titulo, inicio: '', fin: '', duracionAgendadaSegundos: 0,
      participantes: [], transcriptFileId: (c.entrada.transcript_file_id as string) ?? null, transcriptNombre: null,
      motivoSinTranscripcion: null, meetUrl: null,
    },
    transcripcion,
    duracionRealSegundos: Number(c.entrada.duracion_segundos ?? transcripcion.duracionSegundos ?? 0),
    tipo: (c.entrada.tipo as string) ?? 'interna',
    dominiosExternos: [],
  }
  let r: Awaited<ReturnType<typeof generarActa>>
  try {
    r = await generarActa(candidata as never, LLAVE_RELLENO)
  } catch (e) {
    return { campos: [], error: String((e as Error).message ?? e).slice(0, 200) }
  }
  const o = c.oraculo as { resumen?: string; decisiones?: unknown[]; compromisos?: Array<{ responsable?: string }> }
  const nDec = Array.isArray(o.decisiones) ? o.decisiones.length : 0
  const nCom = Array.isArray(o.compromisos) ? o.compromisos.length : 0
  const sim = parecido(String(o.resumen ?? ''), r.resumen)
  // Texto libre: no hay acierto exacto. Se califica por forma (cuántas decisiones y compromisos, ±1) y por parecido
  // del resumen (Jaccard de palabras ≥ 0,2). Es una señal, no un veredicto: el acta se revisa a ojo.
  return {
    campos: [
      { campo: 'n_decisiones(±1)', esperado: nDec, obtenido: r.decisiones.length, ok: Math.abs(nDec - r.decisiones.length) <= 1 },
      { campo: 'n_compromisos(±1)', esperado: nCom, obtenido: r.compromisos.length, ok: Math.abs(nCom - r.compromisos.length) <= 1 },
      { campo: 'resumen(jaccard≥0,2)', esperado: '(texto guardado)', obtenido: Number(sim.toFixed(2)), ok: sim >= 0.2 },
    ],
  }
}

export const FAMILIAS: Record<string, Corrida> = {
  gastos,
  intencion_wa: intencionWa,
  documento,
  rut,
  acta,
}

/** Casos de demostración para la prueba en seco (`--demo --mock`): sin base, sin Drive, sin datos de clientes. */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
export const CASOS_DEMO: Caso[] = [
  { familia: 'gastos', id: 'demo-1', entrada: { descripcion: 'Almuerzo de la cuadrilla en la obra' }, oraculo: { categoria: 'alimentacion', clasificacion: 'variable', revisado: true } },
  { familia: 'gastos', id: 'demo-2', entrada: { descripcion: 'Arriendo de la bodega de octubre' }, oraculo: { categoria: 'otros', clasificacion: 'fijo', revisado: false } },
  { familia: 'intencion_wa', id: 'demo-1', entrada: { texto: 'pagué 120 mil de gasolina para la camioneta' }, oraculo: { intent: 'GASTO' } },
  { familia: 'documento', id: 'demo-1', entrada: { mime: 'image/png', archivo_base64: PNG_1X1, campos: [{ slug: 'numero_factura', label: 'Número de factura', tipo: 'texto', required: true }] }, oraculo: { campos: { numero_factura: { value: 'FE-123' } } } },
  { familia: 'rut', id: 'demo-1', entrada: { mime: 'image/png', archivo_base64: PNG_1X1 }, oraculo: { nit: '900123456', razon_social: 'Ejemplo SAS' } },
  { familia: 'acta', id: 'demo-1', entrada: { transcripcion_texto: 'Reunión de prueba\nTranscripción\nAna: Quedamos en enviar la propuesta el viernes.\nLuis: De acuerdo, yo la reviso.' }, oraculo: { resumen: 'Se acordó enviar la propuesta el viernes.', decisiones: ['Enviar la propuesta'], compromisos: [{ responsable: 'Ana', tarea: 'Enviar la propuesta' }] } },
]
