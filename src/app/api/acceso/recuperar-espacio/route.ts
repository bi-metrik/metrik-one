import { NextResponse } from 'next/server'
import { LimiteEnMemoria } from '@/lib/acceso-espacio/limite'
import {
  correoSolicitado,
  depsRecuperarReales,
  enSegundoPlano,
  enviarDireccionesDeEspacio,
} from '@/lib/acceso-espacio/servidor'

/**
 * «¿No sabes la dirección de tu espacio?» en `metrikone.co/login`: la persona escribe su correo y,
 * si tiene cuenta, le llega un correo con el enlace a cada uno de sus espacios.
 *
 * La respuesta es SIEMPRE `{ ok: true }`, con o sin cuenta, y también cuando se pasa el tope: la
 * pantalla muestra el mismo mensaje neutro y no se puede usar para averiguar qué correos tienen
 * cuenta. Por la misma razón la búsqueda y el envío corren DESPUÉS de responder (`after()`): el
 * tiempo de respuesta no delata si hubo correo que mandar.
 *
 * Solo un formato de correo inválido responde 422: eso lo decide el texto, no la base.
 */

export const dynamic = 'force-dynamic'

// Topes por instancia (ver `limite.ts`): por IP, contra quien prueba correos en serie; por correo,
// contra quien llena el buzón de otro. El correo además tiene la llave de idempotencia de Resend.
const POR_IP = new LimiteEnMemoria(10, 15 * 60_000)
const POR_CORREO = new LimiteEnMemoria(3, 60 * 60_000)

function ipDelCliente(req: Request): string | null {
  // El PRIMERO de `x-forwarded-for` es el cliente; el último es Vercel.
  const primera = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return primera || req.headers.get('x-real-ip') || null
}

export async function POST(req: Request) {
  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const correo = correoSolicitado((cuerpo as Record<string, unknown> | null)?.correo)
  if (!correo) return NextResponse.json({ ok: false, invalido: true }, { status: 422 })

  const ahora = Date.now()
  // La IP primero: una IP que ya pasó su tope no sigue gastando el cupo del correo.
  if (!POR_IP.permitir(ipDelCliente(req) ?? 'sin-ip', ahora) || !POR_CORREO.permitir(correo, ahora)) {
    console.warn('[acceso-espacio] tope de solicitudes alcanzado')
    return NextResponse.json({ ok: true })
  }

  await enSegundoPlano('recuperar dirección', async () => {
    const r = await enviarDireccionesDeEspacio(correo, depsRecuperarReales(ahora))
    console.log('[acceso-espacio] recuperar dirección:', r)
  })
  return NextResponse.json({ ok: true })
}
