import { NextResponse } from 'next/server'
import { crearEspacioSecop } from '@/lib/secop-registro/registro-servidor'
import { ipDelCliente } from '@/lib/http/ip-cliente'

/**
 * La ruta que crea el espacio ONE SECOP. Es de servidor por exigencia de la spec (§3.1: «la creación
 * del espacio **no la hace el navegador**»), no por comodidad.
 *
 * Es una ruta de API y no un server action por una sola razón: **la IP**. El tope por IP necesita lo
 * que vio el borde, y aquí las cabeceras se leen del `Request` sin depender de nada más.
 *
 * Del cuerpo solo se aceptan tres textos. No hay `workspace_id`, ni `correo`, ni `role`: quién es la
 * persona lo dice la sesión y a qué espacio pertenece cada fila lo decide `crearEspacioSecop`.
 */

export const dynamic = 'force-dynamic'

// La IP del cliente (`ipDelCliente`) es una señal de fricción, no una identidad: quien quiera
// rotarla puede. Detrás de Cloudflare sale de `cf-connecting-ip`, no la del PoP (si no, el tope se
// dispararía para todo el mundo a la vez).

export async function POST(req: Request) {
  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ ok: false, texto: 'No se pudo leer la solicitud.' }, { status: 400 })
  }

  const c = (cuerpo ?? {}) as Record<string, unknown>
  const texto = (v: unknown) => (typeof v === 'string' ? v : '')

  const r = await crearEspacioSecop({
    nombre: texto(c.nombre),
    slugPedido: texto(c.slug),
    identificacion: texto(c.identificacion),
    ip: ipDelCliente(req.headers),
  })

  switch (r.tipo) {
    case 'ok':
      return NextResponse.json({ ok: true, slug: r.slug })
    case 'sin_sesion':
      // La pantalla vuelve al paso del correo, que es la única salida real.
      return NextResponse.json(
        { ok: false, texto: 'Entra con tu correo antes de abrir el espacio.' },
        { status: 401 },
      )
    case 'ya_tiene_espacio':
      return NextResponse.json({ ok: false, yaTiene: true, slug: r.slug }, { status: 409 })
    case 'rechazado':
      return NextResponse.json({ ok: false, texto: r.texto }, { status: 403 })
    case 'dato':
      return NextResponse.json({ ok: false, campo: r.campo, texto: r.texto }, { status: 422 })
    case 'error':
      return NextResponse.json(
        { ok: false, texto: 'No pudimos abrir el espacio. Inténtalo de nuevo.' },
        { status: 500 },
      )
  }
}
