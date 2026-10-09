import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { llamarValida } from '@/lib/valida-api/cliente'
import { tamanoPrueba } from './llave'

/**
 * Pide la prueba gratis a Valida (`POST /api/one/v1/pruebas`, firmada como ONE) y la deja lista en el
 * espacio: la llave en Vault, los datos de la prueba en `config_extra.valida_prueba` (los lee el
 * contador de `/valida` y el corte de la bolsa, `src/lib/valida/corte-bolsa.ts`) y la bitácora en
 * `valida_registros`.
 *
 * ⚠️ LA LLAVE EN CLARO llega UNA vez en la respuesta de Valida. Va directo a Vault
 * (`guardar_secreto_workspace`), nunca a `config_extra` (la lee cualquier miembro del espacio por
 * REST), nunca a un log.
 *
 * Idempotencia: Valida emite UNA prueba por espacio y por NIT (409 `prueba_ya_emitida`). Si la
 * primera llamada se cortó después de que Valida la emitió, el reintento recibe 409 y la llave se
 * perdió: el espacio queda sin llave y lo resuelve MeTRIK a mano (emitir una de producción). Es el
 * único caso que no se recupera solo, y queda a la vista en `valida_registros` (`motivo`).
 */

export type ResultadoPrueba =
  | { tipo: 'ok'; venceEn: string; consultas: number }
  | { tipo: 'ya_emitida' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' }

export async function emitirPruebaDelEspacio(datos: {
  workspaceId: string
  registroId: string
  usuarioId: string
  correo: string
  razonSocial: string
  nit: string
  dv: string
}): Promise<ResultadoPrueba> {
  const { consultas, dias } = tamanoPrueba()
  const actor = { usuario_id: datos.usuarioId, correo: datos.correo.toLowerCase() }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any

  const r = await llamarValida<{ cliente_id: string; llave: string; consultas: number; vence_en: string }>({
    metodo: 'POST',
    ruta: '/pruebas',
    actor,
    cuerpo: {
      actor,
      workspace_one_id: datos.workspaceId,
      razon_social: datos.razonSocial,
      nit: `${datos.nit}-${datos.dv}`,
      email_contacto: datos.correo,
      consultas,
      dias,
    },
  })

  if (r.tipo !== 'ok') {
    const motivo = r.tipo === 'rechazada' ? `prueba_${r.codigo}` : `prueba_no_disponible_${r.motivo}`
    await svc.from('valida_registros').update({ motivo, updated_at: new Date().toISOString() }).eq('id', datos.registroId)
    if (r.tipo === 'rechazada' && r.codigo === 'prueba_ya_emitida') return { tipo: 'ya_emitida' }
    return r.tipo === 'no_disponible' ? { tipo: 'no_disponible' } : { tipo: 'error' }
  }

  const { cliente_id, llave, vence_en } = r.datos
  const { error: eVault } = await svc.rpc('guardar_secreto_workspace', {
    p_workspace_id: datos.workspaceId,
    p_clave: 'valida_api_key',
    p_valor: llave,
  })
  if (eVault) {
    // La llave se pierde aquí (no se guarda en ningún otro lado, a propósito). Se deja la marca.
    console.error('[valida-registro] Vault:', eVault.message)
    await svc.from('valida_registros').update({ motivo: 'llave_no_guardada', valida_cliente_id: cliente_id }).eq('id', datos.registroId)
    return { tipo: 'error' }
  }

  const { data: ws } = await svc.from('workspaces').select('config_extra').eq('id', datos.workspaceId).single()
  const config = {
    ...((ws?.config_extra as Record<string, unknown> | null) ?? {}),
    valida_cliente_id: cliente_id,
    valida_prueba: { cliente_id, consultas: r.datos.consultas, vence_en },
  }
  const { error: eWs } = await svc.from('workspaces').update({ config_extra: config }).eq('id', datos.workspaceId)
  if (eWs) console.error('[valida-registro] config_extra:', eWs.message)

  await svc
    .from('valida_registros')
    .update({
      valida_cliente_id: cliente_id,
      prueba_consultas: r.datos.consultas,
      prueba_vence_en: vence_en,
      motivo: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', datos.registroId)

  return { tipo: 'ok', venceEn: vence_en, consultas: r.datos.consultas }
}
