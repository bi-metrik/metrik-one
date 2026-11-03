/**
 * La alarma de volumen de Resend, en seco o de verdad, sin esperar a cruzar un umbral.
 *
 *   npx tsx scripts/alarma-volumen-resend.ts                       # en seco: imprime asunto y texto, guarda el HTML
 *   npx tsx scripts/alarma-volumen-resend.ts --enviados 40213 --umbral 40000 --periodo 2026-10-01
 *   npx tsx scripts/alarma-volumen-resend.ts --enviar              # manda el correo a Mauricio (RESEND_API_KEY)
 *
 * Arma EXACTAMENTE el correo que manda `resend-webhook` (`_shared/alarma-volumen-resend.ts`). No toca la base:
 * ni cuenta, ni marca umbrales, ni deja traza. Con `--enviar` el asunto lleva «[PRUEBA]» delante y la llave de
 * idempotencia es propia, para no chocar con la del aviso real del mismo umbral.
 */
import { writeFileSync } from 'node:fs'
import { correoAlarmaVolumen, whatsappAlarmaVolumen } from '../supabase/functions/_shared/alarma-volumen-resend'

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

function mesSiguiente(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(a, m, d))
  return t.toISOString().slice(0, 10)
}

async function main() {
  const hoy = arg('hoy') ?? hoyBogota()
  const periodo = arg('periodo') ?? `${hoy.slice(0, 7)}-01`
  const datos = {
    enviados: Number(arg('enviados') ?? 40000),
    umbral: Number(arg('umbral') ?? 40000),
    incluidos: Number(arg('incluidos') ?? 50000),
    periodo,
    periodoFin: arg('periodo-fin') ?? mesSiguiente(periodo),
    hoy,
  }
  const correo = correoAlarmaVolumen(datos)
  const rutaHtml = '/tmp/alarma-volumen-resend.html'
  writeFileSync(rutaHtml, correo.html)

  console.log(`De:      ${correo.from}`)
  console.log(`Para:    ${correo.to}`)
  console.log(`Asunto:  ${correo.subject}`)
  console.log(`Llave:   ${correo.idempotencyKey}`)
  console.log(`HTML:    ${rutaHtml}\n`)
  console.log(correo.text)
  console.log(`\nWhatsApp: ${whatsappAlarmaVolumen(datos)}`)

  if (!process.argv.includes('--enviar')) {
    console.log('\n(en seco: no se mandó nada; --enviar para mandarlo)')
    return
  }
  const llave = process.env.RESEND_API_KEY
  if (!llave) throw new Error('falta RESEND_API_KEY')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llave}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `${correo.idempotencyKey}:prueba:${Date.now()}`,
    },
    body: JSON.stringify({ from: correo.from, to: [correo.to], subject: `[PRUEBA] ${correo.subject}`, html: correo.html, text: correo.text }),
  })
  console.log(`\nResend respondió ${res.status}: ${await res.text()}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
