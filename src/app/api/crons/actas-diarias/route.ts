import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { seleccionarDelDia, type ReunionDescartada } from '@/lib/actas/seleccion'
import { generarActa } from '@/lib/actas/generacion'
import { enviarActa, fechaReunionISO, MODO_ENVIO_DEFAULT } from '@/lib/actas/envio'

// Cron diario: genera y envia el acta de cada reunion candidata del dia
// anterior (hora Bogota), usando el pipeline de lectura de src/lib/actas/.
//
// Schedule: 00:00 UTC diario (vercel.json), es decir 19:00 Bogota del DIA
// ANTERIOR — ver el ajuste de fecha mas abajo, que es el gotcha ya
// documentado en CLAUDE.md (fecha Bogota/UTC).
//
// SIN LOOP POR WORKSPACE. `listarReunionesDelDia`/`seleccionarDelDia` operan
// sobre UN SOLO calendario ('primary', el de Mauricio/MéTRIK): el
// `workspaceId` que aceptan es solo para resolver credenciales (Drive/
// Calendar OAuth), no para filtrar reuniones por workspace. Sin pasarlo, cae
// al fallback global de src/lib/google-drive.ts (cuenta
// mauricio.moreno@metrik.com.co), que es exactamente la cuenta cuyo
// calendario hay que leer. No hay "todos los workspaces con Calendar
// configurado" que iterar: el pipeline de lectura no esta scopeado por
// workspace hoy (ver el comentario en calendario.ts sobre por que el cron se
// maneja desde Calendar y no desde Drive).
//
// workspace_id en actas_generadas queda SIEMPRE NULL en esta iteracion: no se
// resuelve a que negocio/cliente pertenece la reunion (eso es un frente
// aparte, "§8bis", fuera de alcance — ver la migracion 20260824163717).
//
// Idempotencia por transcript_file_id (fileId de Drive, unico global):
// se chequea ANTES de llamar al LLM para no gastar la llamada en algo que ya
// se genero. El unique constraint de la tabla es el respaldo si dos corridas
// se solapan.
export const maxDuration = 300

interface ErrorCandidata {
  eventId: string
  titulo: string | null
  error: string
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY no configurada en el servidor' }, { status: 503 })
  }

  const supabase = createServiceClient()

  // A las 00:00 UTC (disparo del cron), new Date() ya tiene fecha UTC del dia
  // SIGUIENTE al que hay que procesar en Bogota (UTC-5): a esa hora en
  // Bogota son las 19:00 del dia anterior. Restar 24h antes de pasarlo a
  // listarReunionesDelDia, que interpreta los componentes UTC Y/M/D como el
  // dia calendario de Bogota. Verificado con un caso concreto: disparo
  // 2026-08-25T00:00:00Z (getUTCDate=25) -> menos 24h -> 2026-08-24T00:00:00Z
  // (getUTCDate=24), que es el dia Bogota que el cron de esa noche debe
  // procesar.
  const fecha = new Date(Date.now() - 24 * 3600 * 1000)

  let seleccion: Awaited<ReturnType<typeof seleccionarDelDia>>
  try {
    seleccion = await seleccionarDelDia(fecha)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[actas-diarias] seleccionarDelDia fallo:', msg)
    return NextResponse.json({ error: `No se pudo leer el calendario: ${msg}` }, { status: 502 })
  }

  let generadas = 0
  let saltadasPorIdempotencia = 0
  const errores: ErrorCandidata[] = []

  for (const candidata of seleccion.candidatas) {
    const fileId = candidata.reunion.transcriptFileId
    if (!fileId) {
      // No debería pasar (seleccionarDelDia ya exige transcriptFileId para
      // llegar a candidata), pero sin el la idempotencia no tiene clave.
      errores.push({
        eventId: candidata.reunion.eventId,
        titulo: candidata.reunion.titulo,
        error: 'Candidata sin transcriptFileId, no se puede procesar',
      })
      continue
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existente, error: buscarErr } = await (supabase as any)
        .from('actas_generadas')
        .select('id')
        .eq('transcript_file_id', fileId)
        .maybeSingle()
      if (buscarErr) throw new Error(`No se pudo chequear idempotencia: ${buscarErr.message}`)
      if (existente) {
        saltadasPorIdempotencia++
        continue
      }

      const acta = await generarActa(candidata, apiKey)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fila, error: insErr } = await (supabase as any)
        .from('actas_generadas')
        .insert({
          workspace_id: null,
          transcript_file_id: fileId,
          event_id: candidata.reunion.eventId,
          titulo: candidata.reunion.titulo ?? candidata.transcripcion.titulo,
          fecha_reunion: fechaReunionISO(candidata.reunion.inicio),
          duracion_segundos: candidata.duracionRealSegundos,
          tipo: candidata.tipo,
          resumen: acta.resumen,
          decisiones: acta.decisiones,
          compromisos: acta.compromisos,
          participantes: candidata.reunion.participantes.map((p) => p.email),
          modo_envio: MODO_ENVIO_DEFAULT,
          estado: 'borrador',
        })
        .select('id')
        .single()
      if (insErr || !fila) {
        throw new Error(`No se pudo insertar el acta: ${insErr?.message ?? 'sin fila devuelta'}`)
      }

      const envio = await enviarActa(supabase, fila.id, candidata, acta, MODO_ENVIO_DEFAULT)
      if (!envio.success) {
        // El acta queda en 'borrador' en la base — no se pierde el trabajo
        // del LLM, solo falto el envio. Sin retry automatico en esta iteracion.
        throw new Error(`Acta generada pero no se pudo enviar: ${envio.error}`)
      }

      generadas++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[actas-diarias] fallo con la reunion ${candidata.reunion.eventId}:`, msg)
      errores.push({ eventId: candidata.reunion.eventId, titulo: candidata.reunion.titulo, error: msg })
    }
  }

  const descartesPorMotivo = seleccion.descartadas.reduce<Record<string, number>>((acc, d) => {
    acc[d.motivo] = (acc[d.motivo] ?? 0) + 1
    return acc
  }, {})
  for (const d of seleccion.descartadas) {
    console.log(`[actas-diarias] descartada "${d.titulo ?? d.eventId}": ${d.motivo}${d.detalle ? ` (${d.detalle})` : ''}`)
  }

  // OJO: NO reusar fechaReunionISO() aqui. Esa funcion toma un instante real
  // (un `inicio` de evento con su propio offset) y lo DESPLAZA -5h para
  // llegar al dia Bogota. `fecha`, en cambio, ya es el marcador que
  // `listarReunionesDelDia` interpreta leyendo directo sus componentes UTC
  // (ver calendario.ts) — desplazarlo de nuevo aqui restaria 5 horas de mas y
  // reportaria el dia anterior al que en realidad se proceso.
  const fechaBogota = `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}-${String(fecha.getUTCDate()).padStart(2, '0')}`

  return NextResponse.json({
    fechaBogota,
    revisadas: seleccion.revisadas,
    candidatas: seleccion.candidatas.length,
    generadas,
    saltadasPorIdempotencia,
    descartadas: seleccion.descartadas.length,
    descartesPorMotivo,
    descartesDetalle: seleccion.descartadas as ReunionDescartada[],
    errores,
  })
}
