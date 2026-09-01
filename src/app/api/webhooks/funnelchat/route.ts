import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { candidatosDeToken, huella, motivoSinToken } from '@/lib/funnelchat/token'
import {
  extraerTelefono,
  resolver,
  contactoDeLaResolucion,
  type Candidato,
} from '@/lib/funnelchat/evento'
import { decidirSegmento, extraerEtiqueta, type DecisionSegmento } from '@/lib/funnelchat/segmento'
import { registrarActividad } from '@/lib/activity/registrar-actividad'

export const dynamic = 'force-dynamic'

// Receptor de lo que FunnelChat manda hacia ONE.
//
// Estado: bitacora + resolucion + sincronizacion del segmento. Registra lo que
// llega, decide A QUIEN pertenece la conversacion (telefono -> contacto) y, si la
// resolucion es unica, refleja la etiqueta de FunnelChat en el segmento del
// contacto. Sigue sin tocar negocios ni etapas: eso va aparte.
//
// Por que ONE refleja y no manda (decision de Mauricio, 2026-08-22): el comercial
// etiqueta en el chat, que es donde de verdad trabaja. Antes de esto el campo
// existia y nadie lo movia — los 62 contactos etiquetados en FunnelChat estaban
// los 62 en `sin_contactar`.
//
// ✅ VEREDICTO (2026-08-22): FunnelChat SI puede enviar datos salientes desde las
// automatizaciones de un flujo. Su soporte dijo lo contrario el 2026-08-14 (nota
// del 2026-05-04) y su documentacion decia que si; gano la documentacion. La
// prueba son 43 envios reales entre el 2026-08-18 y el 2026-08-22, todos POST con
// `user-agent: GuzzleHttp/7` desde 34.203.154.84. El frente nunca estuvo bloqueado
// por FunnelChat.
//
// ⚠️ Se registra ANTES de validar el token. Un 401 que no deja rastro vuelve
// indistinguibles "no llego nada" y "llego y lo rechace", y esa ambiguedad es
// justo lo que hace inutil la prueba. El veredicto viaja en `autenticado`.
//
// ⚠️ Responde 200 aunque el token no sirva, para que la rama de exito del flujo
// se encienda y quien lo configura vea que el envio salio. El cuerpo dice la
// verdad (`autenticado: false`), y una fila sin autenticar no habilita nada.
//
// El token vive en `workspaces.config_extra.funnelchat.webhook_token` (server-only,
// mismo trato que las credenciales de Siigo) y ademas identifica al workspace: es
// lo unico que trae la peticion para saber de quien es. Puede llegar por cabecera
// `x-metrik-token` o por query `?token=`; ver `candidatosDeToken` para por que se
// prueban todas las vias en vez de quedarse con la primera.

const MAX_BYTES = 64 * 1024

/** Cabeceras que nunca se guardan: llevan la credencial. */
const HEADERS_SENSIBLES = new Set([
  'authorization',
  'x-metrik-token',
  'x-api-key',
  'cookie',
])

function headersSeguros(request: NextRequest): Record<string, string> {
  const out: Record<string, string> = {}
  request.headers.forEach((valor, nombre) => {
    const k = nombre.toLowerCase()
    out[k] = HEADERS_SENSIBLES.has(k) ? '[redactado]' : valor
  })
  return out
}

async function registrar(request: NextRequest, crudo: string) {
  // funnelchat_eventos aun no esta en los tipos generados (database.ts). Cast puntual,
  // mismo patron que el receptor de kyc. Pendiente: regenerar tipos + re-agregar aliases.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any

  let payload: Record<string, unknown>
  try {
    const parsed = crudo ? JSON.parse(crudo) : {}
    payload =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { _valor: parsed }
  } catch {
    // Un cuerpo que no es JSON tambien se guarda: saber QUE mando es parte de la
    // prueba, y descartarlo dejaria la fila diciendo que no llego nada.
    payload = { _raw: crudo.slice(0, MAX_BYTES) }
  }

  const candidatosToken = candidatosDeToken(request.headers, request.nextUrl.searchParams)
  let workspaceId: string | null = null
  let motivo: string | null = null

  if (candidatosToken.length === 0) {
    motivo = motivoSinToken(request.nextUrl.searchParams)
  } else {
    const fallidos: string[] = []
    for (const c of candidatosToken) {
      const { data, error } = await supabase
        .from('workspaces')
        .select('id')
        .eq('config_extra->funnelchat->>webhook_token', c.valor)
        .maybeSingle()
      if (error) {
        // El error de la consulta NO se descarta: sin esto, un fallo de base se
        // leeria como "token invalido" y mandaria a revisar la configuracion de
        // FunnelChat, que estaria bien. Y se corta aqui: seguir probando los
        // demas candidatos contra una base que falla solo inventa un veredicto.
        motivo = `no se pudo resolver el token (${c.origen}): ${error.message}`
        break
      }
      if (data) {
        workspaceId = (data as { id: string }).id
        break
      }
      fallidos.push(`${c.origen}(${await huella(c.valor)})`)
    }
    if (!workspaceId && !motivo) {
      motivo = `token no reconocido — probados: ${fallidos.join(', ')}`
    }
  }

  // A quien pertenece la conversacion. Solo tiene sentido con workspace resuelto:
  // buscar el telefono sin saber de quien es la peticion cruzaria inquilinos.
  const telefono = workspaceId ? extraerTelefono(payload) : null
  let candidatos: Candidato[] = []
  if (workspaceId && telefono) {
    const { data, error } = await supabase.rpc('funnelchat_contactos_por_telefono', {
      p_workspace_id: workspaceId,
      p_nacional: telefono.nacional,
    })
    // Un fallo de la consulta NO se puede leer como "no hay contacto": eso es la
    // misma confusion entre ausencia y negacion que este frente viene arrastrando.
    if (error) {
      motivo = `${motivo ? motivo + ' · ' : ''}no se pudo buscar el contacto: ${error.message}`
    } else {
      candidatos = (data ?? []) as Candidato[]
    }
  }
  const resolucion = workspaceId
    ? resolver(telefono, candidatos, Object.keys(payload))
    : null

  // ── Sincronizacion del segmento ───────────────────────────────────────────
  //
  // Solo con resolucion `unico`. Con `ambiguo` no se escribe: el numero apunta a
  // dos personas distintas y elegir una seria inventar. Medido sobre SOENA, 33
  // numeros se repiten entre 73 contactos, uno de ellos con cinco nombres
  // distintos.
  let sincronizacion: DecisionSegmento | { estado: 'fallo'; etiqueta: string; error: string } | null =
    null
  if (workspaceId && resolucion?.estado === 'unico') {
    const decision = decidirSegmento(extraerEtiqueta(payload), resolucion.contacto.segmento)
    sincronizacion = decision

    if (decision.estado === 'aplica') {
      const { error } = await supabase
        .from('contactos')
        .update({ segmento: decision.nuevo, updated_at: new Date().toISOString() })
        .eq('id', resolucion.contacto.id)
        // El workspace se repite aunque el id ya sea unico: es la barrera de
        // inquilino, y aqui escribimos con la llave de servicio (sin RLS).
        .eq('workspace_id', workspaceId)

      if (error) {
        sincronizacion = { estado: 'fallo', etiqueta: decision.etiqueta, error: error.message }
      } else {
        // Mismo rastro que deja un humano moviendo el chip en el directorio, para
        // que el historial del contacto no tenga cambios sin autor ni origen.
        const rastro = await registrarActividad(supabase, {
          workspace_id: workspaceId,
          entidad_tipo: 'contacto',
          entidad_id: resolucion.contacto.id,
          tipo: 'cambio',
          autor_id: null,
          campo_modificado: 'segmento',
          valor_anterior: decision.anterior,
          valor_nuevo: decision.nuevo,
          contenido: `FunnelChat — etiqueta: ${decision.etiqueta}`,
        }, 'funnelchat/registrar')
        if (!rastro.ok) {
          // El segmento YA quedo escrito. Decir que fallo seria mentir al reves,
          // asi que se reporta que el rastro es lo que falta. Este sitio es el unico
          // que NO se conforma con el console.error del helper: el motivo viaja en la
          // respuesta del webhook, que es donde el proveedor lo ve.
          sincronizacion = { ...decision, sin_rastro: rastro.motivo } as typeof sincronizacion
        }
      }
    }
  }

  const { data: fila } = await supabase
    .from('funnelchat_eventos')
    .insert({
      workspace_id: workspaceId,
      metodo: request.method,
      content_type: request.headers.get('content-type'),
      headers: headersSeguros(request),
      payload,
      bytes: crudo.length,
      autenticado: workspaceId !== null,
      motivo,
      contacto_id: resolucion ? contactoDeLaResolucion(resolucion) : null,
      resolucion,
      sincronizacion,
    })
    .select('id')
    .single()

  // La respuesta dice lo que el receptor ENTENDIO, no solo que recibio. Quien
  // configura el flujo del otro lado ve en su propia pantalla si el telefono
  // viajo y si engancho, en vez de tener que pedirnos que miremos la base.
  return {
    ok: true,
    autenticado: workspaceId !== null,
    motivo,
    resolucion,
    sincronizacion,
    evento_id: (fila as { id: string } | null)?.id ?? null,
  }
}

export async function POST(request: NextRequest) {
  const crudo = await request.text()
  if (crudo.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'cuerpo_demasiado_grande' }, { status: 413 })
  }
  return NextResponse.json(await registrar(request, crudo))
}

// FunnelChat tambien ofrece GET en su paso de peticion HTTP. Se acepta para que la
// prueba no dependa de acertar el metodo a la primera.
export async function GET(request: NextRequest) {
  return NextResponse.json(await registrar(request, ''))
}
