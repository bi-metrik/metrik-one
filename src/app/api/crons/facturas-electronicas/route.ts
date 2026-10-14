import { NextRequest, NextResponse } from 'next/server'
import { candadoDeCron } from '@/lib/idempotencia/candado-cron'
import { procesarFacturasPendientes } from '@/lib/facturacion-electronica/emision-servidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Facturas electrónicas de los cobros (Aliaddo). Cada 30 minutos (vercel.json): reintenta lo que no
// salió, consulta lo que espera a la DIAN, trae los archivos de lo emitido y encola lo pagado que se
// quedó sin factura. APAGADO sin FACTURACION_ELECTRONICA_HABILITADA=1: responde sin tocar nada.
// Detalle: src/lib/facturacion-electronica/emision-servidor.ts

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const otraCorrida = await candadoDeCron('facturas-electronicas', req)
  if (otraCorrida) return otraCorrida

  const r = await procesarFacturasPendientes()
  if (r.estado === 'sin_configurar') console.error(`[cron facturas-electronicas] ${r.detalle}`)
  if (r.errores.length > 0) console.error('[cron facturas-electronicas] errores:', r.errores.slice(0, 10))
  return NextResponse.json({
    ok: true,
    estado: r.estado,
    encoladas: r.encoladas,
    no_aplica: r.noAplica,
    procesadas: r.resultados.map((x) => ({ id: x.id, estado: x.estado })),
    errores: r.errores.length,
  })
}
