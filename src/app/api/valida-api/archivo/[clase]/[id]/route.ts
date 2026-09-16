import { NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { contextoValidaApi } from '@/lib/valida-api/contexto'
import { entradaAprobada } from '@/lib/valida-api/entrada-servidor'
import { esUuid, puedeVerPagos } from '@/lib/valida-api/reglas'
import { nombreDescargaRecibo } from '@/lib/valida-api/recibo-manual'

export const dynamic = 'force-dynamic'

/**
 * Descarga de un recibo de la pestaña Pagos del módulo Valida API.
 *
 *   GET /api/valida-api/archivo/recibo/<cobro_id>
 *
 * Hasta el 2026-09-16 también servía el PDF de los términos (`/documento/<id>`) a la pestaña
 * Documentos. Esa pestaña se quitó y los términos aprobados se releen como texto en la pestaña
 * Términos, sin PDF, así que la clase `documento` ya no existe y responde 404.
 *
 * ## Quién puede, y por qué con la MISMA función que lo listó
 *
 * La autorización no se reescribe aquí: se pregunta a la RPC cerrada que alimenta la pestaña
 * (`mis_cobros_de_servicio`), con el cliente de SESIÓN. Si el recibo no aparece en lo que el
 * usuario puede ver, no se descarga. Dos reglas, una para listar y otra para bajar, terminan
 * diciendo cosas distintas, y el síntoma sería un PDF ajeno descargable por URL.
 *
 * Un id que no existe y uno de otro cliente responden el MISMO 404: no se confirma nada.
 *
 * ## Sin la entrada aprobada, nada
 *
 * Mientras la persona no haya hecho la aprobación única de la entrada (`entrada.ts`), esta ruta
 * responde 403, igual que las acciones del servidor: la pantalla no muestra las pestañas, y una URL
 * escrita a mano tampoco entrega el archivo.
 *
 * ## Qué entrega
 *
 * Un redirect a una URL firmada de **60 segundos** del bucket privado. **Nunca un enlace de
 * Drive** (§5.4). El PDF no pasa por este servidor ni queda cacheado.
 */

const NO_ENCONTRADO = () => NextResponse.json({ error: 'no_encontrado' }, { status: 404 })

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clase: string; id: string }> },
) {
  const { clase, id } = await params
  if (!esUuid(id) || clase !== 'recibo') return NO_ENCONTRADO()

  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return NextResponse.json({ error: 'sin_acceso' }, { status: 403 })
  if (!(await entradaAprobada())) return NextResponse.json({ error: 'entrada_pendiente' }, { status: 403 })
  if (!puedeVerPagos(ctx.role)) return NextResponse.json({ error: 'sin_acceso' }, { status: 403 })

  const { supabase } = await getWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (nombre: string, args?: Record<string, unknown>) => (supabase as any).rpc(nombre, args)

  let ruta: string | null = null
  let nombreArchivo = 'recibo.pdf'
  const servicios = await rpc('mis_servicios')
  if (servicios.error) return NextResponse.json({ error: 'no_disponible' }, { status: 503 })
  const pagados = ((servicios.data ?? []) as { servicio_contratado_id: string; es_pagador: boolean | null }[])
    .filter((s) => s.es_pagador === true)
  for (const s of pagados) {
    const cobros = await rpc('mis_cobros_de_servicio', { p_servicio_contratado_id: s.servicio_contratado_id })
    if (cobros.error) return NextResponse.json({ error: 'no_disponible' }, { status: 503 })
    const fila = ((cobros.data ?? []) as { cobro_id: string; recibo_path: string | null; recibo_numero: string | null }[])
      .find((c) => c.cobro_id === id && c.recibo_path)
    if (fila?.recibo_path) {
      ruta = fila.recibo_path
      nombreArchivo = nombreDescargaRecibo(fila.recibo_numero)
      break
    }
  }

  if (!ruta) return NO_ENCONTRADO()

  const { data, error } = await createServiceClient()
    .storage.from('documentos-servicio')
    .createSignedUrl(ruta, 60, { download: nombreArchivo })
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'no_disponible' }, { status: 503 })

  const respuesta = NextResponse.redirect(data.signedUrl, 302)
  respuesta.headers.set('cache-control', 'no-store')
  return respuesta
}
