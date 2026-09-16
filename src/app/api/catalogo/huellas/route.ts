import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { CABECERA_FIRMA, verificarFirma } from '@/lib/catalogo/firma'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/catalogo/huellas` — qué versiones del catálogo tiene ONE y con qué huella.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §3.2 (entrega A2).
 *
 * La usa la revisión de deriva: la misma Action corre de noche, calcula el sha256 de cada
 * archivo de `cerebro/catalogo/servicios/**` y lo compara contra esto. Si difieren, avisa.
 *
 * **Por qué hace falta y no alcanza con el push:** un archivo se puede editar y no empujar, un
 * push puede fallar a mitad, y una versión puede quedar publicada en ONE mientras el cerebro la
 * revirtió. La única forma de saber que las dos puntas dicen lo mismo es compararlas; el push
 * solo dice que algo salió.
 *
 * Misma firma que el POST, con el método y la ruta dentro del mensaje: una firma de lectura no
 * sirve para escribir, ni al revés. No devuelve `definicion`: para comparar huellas no hace
 * falta, y una lista de precios completa no tiene por qué viajar en cada revisión nocturna.
 */
export async function GET(request: NextRequest) {
  const firma = verificarFirma({
    metodo: 'GET',
    ruta: '/api/catalogo/huellas',
    cuerpo: '',
    cabecera: request.headers.get(CABECERA_FIRMA),
    secreto: process.env.CATALOGO_SYNC_SECRET,
    ahoraSegundos: Math.floor(Date.now() / 1000),
  })
  if (!firma.ok) {
    if (firma.motivo === 'sin_secreto') {
      return NextResponse.json({ error: 'sincronizacion_no_configurada' }, { status: 503 })
    }
    return NextResponse.json({ error: 'firma_invalida', motivo: firma.motivo }, { status: 401 })
  }

  const supabase = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('catalogo_servicios_versiones')
    .select('slug, version, fuente_ruta, fuente_sha256, recibida_at')
    .order('slug')
    .order('version')

  if (error) {
    return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 })
  }

  // `version_vigente` va aparte: la deriva compara huellas, pero quien lea el informe necesita
  // saber cuál es la que un contrato nuevo tomaría.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: servicios, error: e2 } = await (supabase as any)
    .from('catalogo_servicios')
    .select('slug, version_vigente, activo')
    .order('slug')

  if (e2) {
    return NextResponse.json({ error: 'db_error', message: e2.message }, { status: 500 })
  }

  return NextResponse.json({
    versiones: data ?? [],
    servicios: servicios ?? [],
  })
}
