import 'server-only'

/**
 * La marca y los datos de empresa de un workspace, para las páginas PÚBLICAS que abre alguien
 * sin sesión (vinculación de contrapartes, autorización de datos del cliente final).
 *
 * Sin la marca, la persona recibe un enlace de una plataforma que no conoce pidiéndole datos
 * personales, que es exactamente la forma de un fraude. La marca no es decoración, es lo que
 * hace creíble el enlace.
 *
 * Los datos de empresa pueden estar vacíos: el perfil fiscal del workspace es opcional. Lo que
 * falta se devuelve como null y la pantalla no lo pinta. Un rótulo "NIT:" sin número al lado se
 * lee como plataforma rota.
 *
 * ⚠️ Quien llama decide de QUÉ workspace es la marca, y tiene que salir del registro que abre el
 * token (el expediente, el enlace), nunca solo del subdominio: si saliera del subdominio, un
 * token válido se podría abrir bajo la marca de otro cliente.
 */

import { createServiceClient } from '@/lib/supabase/server'

export type MarcaWorkspace = {
  /** Razón social si la hay; si no, el nombre del workspace. */
  nombre: string
  /** El nombre comercial del workspace («Trappvel»), sin la razón social. */
  nombreComercial: string | null
  logoUrl: string | null
  colorPrimario: string | null
  razonSocial: string | null
  nit: string | null
  direccion: string | null
  ciudad: string | null
  telefono: string | null
  correo: string | null
}

export function marcaVacia(nombre: string): MarcaWorkspace {
  return {
    nombre,
    nombreComercial: null,
    logoUrl: null,
    colorPrimario: null,
    razonSocial: null,
    nit: null,
    direccion: null,
    ciudad: null,
    telefono: null,
    correo: null,
  }
}

const limpio = (v: string | null | undefined) => {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : null
}

export async function marcaDelWorkspace(workspaceId: string | null, nombreSiFalta: string): Promise<MarcaWorkspace> {
  const vacia = marcaVacia(nombreSiFalta)
  if (!workspaceId) return vacia

  const svc = createServiceClient()
  const [ws, fiscal] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc.from('workspaces') as any)
      .select('name, logo_url, color_primario')
      .eq('id', workspaceId)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc.from('fiscal_profiles') as any)
      .select('nit, razon_social, direccion_fiscal, municipio, telefono, email_fiscal')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ])

  const w = ws.data as Record<string, string | null> | null
  const f = fiscal.data as Record<string, string | null> | null

  return {
    nombre: limpio(f?.razon_social) ?? limpio(w?.name) ?? vacia.nombre,
    nombreComercial: limpio(w?.name),
    logoUrl: limpio(w?.logo_url),
    colorPrimario: limpio(w?.color_primario),
    razonSocial: limpio(f?.razon_social),
    nit: limpio(f?.nit),
    direccion: limpio(f?.direccion_fiscal),
    ciudad: limpio(f?.municipio),
    telefono: limpio(f?.telefono),
    correo: limpio(f?.email_fiscal),
  }
}
