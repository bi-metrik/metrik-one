import { NextResponse } from 'next/server'
import { crearEspacioValida } from '@/lib/valida-registro/registro-servidor'

/**
 * Alta autogestionada de Valida (`/valida/empezar`). Ruta de API y no server action por la IP, igual
 * que `/api/secop/registro`: el tope por IP necesita lo que vio el borde.
 *
 * Del cuerpo solo se aceptan los datos de la pantalla «Tu empresa» y las señales de origen. Ni
 * `workspace_id`, ni `correo`, ni `role`: quién es lo dice la sesión.
 */

export const dynamic = 'force-dynamic'

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
    return NextResponse.json({ ok: false, texto: 'No se pudo leer la solicitud.' }, { status: 400 })
  }
  const c = (cuerpo ?? {}) as Record<string, unknown>
  const texto = (v: unknown) => (typeof v === 'string' ? v : '')

  const r = await crearEspacioValida({
    razonSocial: texto(c.razon_social),
    nit: texto(c.nit),
    dv: texto(c.dv),
    tipoEntidad: texto(c.tipo_entidad),
    acepta: c.acepta === true,
    condicionesVersion: texto(c.condiciones_version),
    recomendadoAfi: typeof c.recomendado_afi === 'boolean' ? c.recomendado_afi : null,
    codigoAfi: texto(c.codigo_afi) || null,
    ref: texto(c.ref) || null,
    utm: c.utm,
    ip: ipDelCliente(req),
  })

  switch (r.tipo) {
    case 'ok':
      return NextResponse.json({ ok: true, slug: r.slug })
    case 'prueba_pendiente':
      // El espacio existe; la prueba se vuelve a pedir en el siguiente envío. La pantalla lo dice.
      return NextResponse.json({ ok: false, pruebaPendiente: true, slug: r.slug }, { status: 202 })
    case 'cerrado':
      return NextResponse.json({ ok: false, cerrado: true, texto: 'La prueba gratis todavía no está abierta.' }, { status: 404 })
    case 'sin_sesion':
      return NextResponse.json({ ok: false, texto: 'Entra con tu correo antes de empezar la prueba.' }, { status: 401 })
    case 'ya_tiene_espacio':
      return NextResponse.json({ ok: false, yaTiene: true, slug: r.slug }, { status: 409 })
    case 'rechazado':
      return NextResponse.json({ ok: false, texto: r.texto }, { status: 403 })
    case 'dato':
      return NextResponse.json({ ok: false, campo: r.campo, texto: r.texto }, { status: 422 })
    case 'error':
      return NextResponse.json({ ok: false, texto: 'No pudimos abrir tu prueba. Inténtalo de nuevo.' }, { status: 500 })
  }
}
