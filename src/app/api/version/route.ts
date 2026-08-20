import { NextResponse } from 'next/server'
import { versionDelBuild } from '@/lib/version/build'

// Version del deployment vivo. La consulta el vigilante de la pestaña
// (`VersionWatcher`) para saber si el bundle que tiene cargado quedo atras.
//
// Publica a proposito: no expone nada del workspace ni del usuario, solo el id
// del deployment, y necesita responder aunque la sesion haya expirado — que es
// justo uno de los estados en los que la pestaña vieja hay que recargarla.
//
// `force-dynamic` + `no-store`: si esta respuesta se cachea, el vigilante ve
// para siempre la version con la que se cacheo y deja de detectar deploys.

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { version: versionDelBuild() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
