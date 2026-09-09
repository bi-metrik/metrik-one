/**
 * Repone en `avisos_cliente` los acuses de los correos que salieron ANTES de que
 * existiera el webhook `resend-webhook`.
 *
 * Por que existe: `notificar-etapa` marca `estado = 'enviado'` en cuanto Resend
 * acepta el POST, y hasta hoy no habia por donde enterarse de lo que pasa
 * despues. Medido contra produccion el 2026-09-09: los 51 avisos por correo con
 * `proveedor_id` de SOENA dicen `enviado`, y tres de ellos rebotaron. La tabla
 * responde "si le avisamos" sobre clientes a los que nadie les aviso. El webhook
 * cierra el problema hacia adelante; esto recupera lo que ya paso.
 *
 * Por que NO es una migracion: el dato no esta en la base. Hay que ir a
 * preguntarle a Resend correo por correo (`GET /emails/{id}`), y una migracion
 * que hace peticiones HTTP no se puede reproducir ni revertir.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ TRES COSAS QUE ESTE SCRIPT NO PUEDE SABER, Y QUE POR ESO DECLARA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. LA FECHA DEL ACUSE NO EXISTE en `GET /emails/{id}`: la respuesta trae
 *      `last_event` y nada mas. Lo que se escribe en `entregado_at` / `queja_at`
 *      es la fecha del ENVIO (el `created_at` de la propia fila), que es una
 *      cota inferior — la entrega ocurrio en ese instante o despues. En la
 *      practica son segundos, pero es una aproximacion y el informe lo repite en
 *      cada corrida para que nadie lea esa columna como si fuera exacta. Las
 *      filas que escriba el webhook SI llevan la fecha real del evento.
 *
 *   2. `last_event` ES EL ULTIMO EVENTO, NO LA HISTORIA. Un correo entregado y
 *      despues marcado como spam solo dice `complained`: se repone la queja y su
 *      `entregado_at` queda en null para siempre. No hay endpoint que devuelva
 *      la secuencia completa (verificado en el indice de la API el 2026-09-09).
 *
 *   3. UN REBOTE RECONSTRUIDO NO TRAE DIAGNOSTICO. La respuesta no incluye el
 *      objeto `bounce`, asi que no hay `type` (permanente vs. transitorio) ni la
 *      respuesta SMTP. El motivo queda como `rebote: reconstruido de Resend...`,
 *      distinguible a simple vista del que deja el webhook, que empieza por
 *      `rebote_permanente:` o `rebote_transitorio:`. Para ver el detalle de esos
 *      tres hay que abrir el panel de Resend.
 *
 * ⚠️ `suppressed` NO SE APLICA y se cuenta aparte. Significa que Resend acepto el
 *    POST y despues no envio nada porque la direccion estaba en su lista de
 *    supresion: la fila dice `enviado` sobre un correo que no salio. El
 *    vocabulario de `estado` no tiene un lugar para eso y elegirle uno a ojo
 *    seria inventar, asi que el script lo reporta con su conteo y la decision la
 *    toma una persona.
 *
 * El criterio NO se reimplementa: `acuseDesdeLastEvent` + `actualizacionDeAcuse`
 * son las MISMAS funciones que corren dentro del webhook. Una copia aqui dejaria
 * el historico y lo que llegue en vivo con dos criterios distintos, que es justo
 * lo que este frente viene a cerrar. Por eso tambien es idempotente sin hacer
 * nada especial: las guardas de `actualizacionDeAcuse` viven en el WHERE, asi
 * que una segunda corrida (o una corrida despues de que el webhook ya lo aplico)
 * no encuentra filas y no escribe.
 *
 * Uso:
 *   cd metrik-one
 *   npx tsx scripts/backfill-acuses-resend.ts --ws soena              # informe, NO escribe
 *   npx tsx scripts/backfill-acuses-resend.ts --ws soena --dry-run    # identico, explicito
 *   npx tsx scripts/backfill-acuses-resend.ts --ws soena --commit     # aplica
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
 * `RESEND_API_KEY` NO esta en el `.env.local` del repo: vive en los secretos de
 * la edge function y en Vercel. Hay que pasarla por entorno al correr esto.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  acuseDesdeLastEvent,
  actualizacionDeAcuse,
} from '../supabase/functions/_shared/resend-acuses.ts'

const args = process.argv.slice(2)
// Dry-run por defecto: solo `--commit` escribe. `--dry-run` se acepta para poder
// decirlo con todas las letras, pero no cambia nada — el default ya es ese.
const COMMIT = args.includes('--commit')
const WS_SLUG = args[args.indexOf('--ws') + 1]
// Pausa entre peticiones. Resend limita a 2 req/s por defecto en su API; ir
// despacio es gratis, que la mitad falle por limite no.
const PAUSA_MS = Number(args[args.indexOf('--pausa') + 1]) || 600

if (!WS_SLUG || WS_SLUG.startsWith('--')) {
  console.error('Uso: npx tsx scripts/backfill-acuses-resend.ts --ws <slug> [--commit] [--pausa <ms>]')
  process.exit(1)
}

const env: Record<string, string> = { ...(process.env as Record<string, string>) }
try {
  for (const linea of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
    // El entorno gana sobre el archivo: asi se puede pasar RESEND_API_KEY por
    // delante sin escribirla en disco.
    if (m && !env[m[1]]) env[m[1]] = m[2].trim()
  }
} catch {
  // Sin .env.local se sigue: puede venir todo por entorno.
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const resendKey = env.RESEND_API_KEY
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!resendKey) {
  console.error('Falta RESEND_API_KEY (vive en los secretos de la edge function, no en .env.local)')
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(url, key) as any

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Fila {
  id: string
  negocio_id: string
  proveedor_id: string
  estado: string
  destino: string | null
  created_at: string
}

async function main() {
  // ⚠️ La columna es `name`, no `nombre`: `workspaces` es de las tablas viejas y
  // esta en ingles. Pedir `nombre` devuelve un error de PostgREST, no un null.
  const { data: ws, error: eWs } = await db
    .from('workspaces').select('id, name').eq('slug', WS_SLUG).maybeSingle()
  if (eWs) throw new Error(`No se pudo leer el workspace: ${eWs.message}`)
  if (!ws) throw new Error(`No existe el workspace ${WS_SLUG}`)

  // El filtro es "lo que todavia no se reconcilio". Deliberadamente NO se filtra
  // por estado: un `enviado` puede ser un rebote sin descubrir, que es el caso
  // que abrio este frente.
  const { data: filas, error } = await db
    .from('avisos_cliente')
    .select('id, negocio_id, proveedor_id, estado, destino, created_at')
    .eq('workspace_id', ws.id)
    .eq('canal', 'email')
    .not('proveedor_id', 'is', null)
    .is('entregado_at', null)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`No se pudieron leer los avisos: ${error.message}`)

  const pendientes = (filas ?? []) as Fila[]
  console.log(`\n${ws.name} (${WS_SLUG}) — ${pendientes.length} avisos por correo sin reconciliar`)
  console.log(COMMIT ? 'MODO: --commit (ESCRIBE)\n' : 'MODO: dry-run (no escribe una sola fila)\n')

  const conteo: Record<string, number> = {}
  let aplicadas = 0
  let sinCambio = 0
  const errores: string[] = []

  for (const fila of pendientes) {
    let respuesta: Response
    try {
      respuesta = await fetch(`https://api.resend.com/emails/${fila.proveedor_id}`, {
        headers: { Authorization: `Bearer ${resendKey}` },
      })
    } catch (e) {
      errores.push(`${fila.proveedor_id}: red — ${e instanceof Error ? e.message : e}`)
      await dormir(PAUSA_MS)
      continue
    }
    if (!respuesta.ok) {
      // 404: Resend ya no lo guarda (retiene los correos un tiempo). No es un
      // error de este script y no hay nada que reponer.
      errores.push(`${fila.proveedor_id}: HTTP ${respuesta.status}`)
      await dormir(PAUSA_MS)
      continue
    }
    const correo = await respuesta.json() as { last_event?: string }
    const evento = correo.last_event ?? 'sin_last_event'
    conteo[evento] = (conteo[evento] ?? 0) + 1

    // La fecha del envio como cota inferior de la del acuse. Ver el limite 1 del
    // encabezado: no hay otra, y fingir precision seria peor que la aproximacion.
    const acuse = acuseDesdeLastEvent(evento, fila.proveedor_id, fila.created_at)
    if (!acuse) {
      await dormir(PAUSA_MS)
      continue
    }

    const { set, guarda } = actualizacionDeAcuse(acuse)
    const marca = COMMIT ? 'APLICA' : 'aplicaria'
    console.log(
      `  ${marca}  ${fila.negocio_id.slice(0, 8)}  last_event=${evento}  →  ${acuse.clase}` +
      `  ${JSON.stringify(set)}`,
    )

    if (!COMMIT) { aplicadas++; await dormir(PAUSA_MS); continue }

    let consulta = db.from('avisos_cliente').update(set).eq('id', fila.id)
    consulta = guarda.modo === 'es_nulo'
      ? consulta.is(guarda.columna, null)
      : consulta.eq(guarda.columna, guarda.valor)
    const { data: tocadas, error: eUpd } = await consulta.select('id')
    if (eUpd) errores.push(`${fila.proveedor_id}: update — ${eUpd.message}`)
    else if ((tocadas?.length ?? 0) === 0) sinCambio++
    else aplicadas++

    await dormir(PAUSA_MS)
  }

  console.log('\n── last_event que devolvio Resend ──')
  for (const [evento, n] of Object.entries(conteo).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${evento.padEnd(18)} ${n}`)
  }

  console.log('\n── Resultado ──')
  console.log(`  ${COMMIT ? 'Aplicadas' : 'Se aplicarian'}: ${aplicadas}`)
  if (COMMIT && sinCambio) {
    console.log(`  Sin cambio (la guarda ya no las alcanzo — el webhook llego primero): ${sinCambio}`)
  }
  if (conteo.suppressed) {
    console.log(
      `\n  ⚠️ ${conteo.suppressed} correo(s) con last_event=suppressed: Resend acepto el POST y NO los envio\n` +
      '     (la direccion estaba en su lista de supresion). Esas filas dicen `enviado` sobre algo que no\n' +
      '     salio, y NO se tocaron: el vocabulario de `estado` no tiene un valor para ese caso y elegirle\n' +
      '     uno a ojo seria inventar. Queda para decidir.',
    )
  }
  if (errores.length) {
    console.log(`\n  ${errores.length} correo(s) que no se pudieron consultar:`)
    for (const e of errores.slice(0, 20)) console.log(`    ${e}`)
    if (errores.length > 20) console.log(`    ... y ${errores.length - 20} mas`)
  }
  console.log(
    '\n  ⚠️ La fecha escrita en entregado_at / queja_at es la del ENVIO, no la del acuse:\n' +
    '     GET /emails/{id} no expone la fecha del evento. Es una cota inferior (la entrega\n' +
    '     ocurrio en ese instante o despues). Las filas que escriba el webhook si llevan la real.',
  )
  if (!COMMIT) console.log('\n  Nada de esto se escribio. Para aplicar: --commit\n')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
