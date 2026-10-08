import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { abrirAutorizacion } from '@/lib/autorizacion-datos/servidor'
import { MENSAJE_RESPUESTA } from '@/lib/autorizacion-datos/servidor'
import AutorizacionClient from './autorizacion-client'

export const metadata: Metadata = {
  title: 'Autorización de datos',
  // La URL es la credencial: no se indexa ni se guarda copia.
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El link de autorización de datos del cliente final. Lo abre el titular sin sesión; la página
 * solo muestra un enlace del workspace del subdominio (un token de otro cliente responde «no
 * existe»). Ver `lib/autorizacion-datos/servidor.ts`.
 */
export default async function AutorizacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ m?: string }>
}) {
  const { token } = await params
  const { m } = await searchParams
  const slug = (await headers()).get('x-tenant-slug')
  const r = await abrirAutorizacion(token, slug)

  if (!r.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md text-center">
          {r.marca?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.marca.logoUrl} alt={r.marca.nombreComercial ?? r.marca.nombre} className="mx-auto mb-4 h-10 w-auto" />
          )}
          <h1 className="text-lg font-bold text-tinta">Enlace no disponible</h1>
          <p className="mt-2 text-sm text-tinta-suave">{MENSAJE_RESPUESTA[r.motivo]}</p>
        </div>
      </main>
    )
  }

  const v = r.vista
  return (
    <AutorizacionClient
      token={token}
      medio={m ?? null}
      marca={{ nombre: v.marca.nombreComercial ?? v.marca.nombre, logoUrl: v.marca.logoUrl, color: v.marca.colorPrimario }}
      nombreCliente={v.nombreCliente}
      textoId={v.texto.id}
      version={v.texto.version}
      esMarcador={v.texto.esMarcador}
      titulo={v.titulo}
      cuerpo={v.cuerpo}
      casillas={v.casillasLlenas.map(c => ({ clave: c.clave, texto: c.textoLleno }))}
      autorizable={v.autorizable.ok ? null : { motivo: v.autorizable.motivo, faltan: v.autorizable.faltan }}
      aceptado={v.aceptado}
      reaceptar={v.reaceptar}
      rechazadoAt={v.rechazadoAt}
      canalDatos={v.canalDatos}
      tieneDetalle={v.tieneDetalle}
    />
  )
}
