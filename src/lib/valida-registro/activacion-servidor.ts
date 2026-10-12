import 'server-only'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { parseRut } from '@/lib/rut/parse-rut'
import { getServerKey } from '@/lib/server-keys'
import { BUCKET_ACEPTACIONES } from '@/lib/retencion-bot/plazos'
import { enrolarContratosPorCiclo } from '@/lib/cobros/enrolar-ciclo-servidor'
import { cobrarCuotasConTarjeta, pasarElPlanATarjeta } from './cobro-token-servidor'
import { COBRADOR_VALIDA, FICHA_PLAN_VALIDA, activacionAbierta, plazoTerminos, type ErrorActivacion } from './activacion'
import { parametrosDelPlan, esEspacioAutogestion } from './plan'
import { pdfTerminos } from './pdf-terminos'
import { compararRut, type VeredictoRut } from './rut'
import { TERMINOS_PLAN, camposDeLaOrden, llenarPlantilla } from './terminos-plan'

/**
 * «Activar plan» desde la prueba (`18-recorrido-baja-friccion.md` §2.2, PR 6 y la mitad ONE del PR 8).
 *
 * La persona dueña de un espacio nacido en `/valida/empezar` oprime el botón y, en el servidor:
 *   1. si subió el RUT, se lee (`parseRut`) y se compara con lo declarado. NO frena nada (§5): solo
 *      decide si la empresa queda verificada; lo que no coincide lo revisa una persona;
 *   2. se arman los Términos del plan de SU empresa desde la plantilla aprobada, su PDF y sus huellas;
 *   3. `valida_activar_autogestion` crea, en UNA transacción, empresa, negocio, términos, contrato con
 *      ella como persona designada, y el módulo apuntando al contrato.
 * Después la persona acepta los Términos en `/valida` (la entrada de siempre, con su constancia), el
 * enrolamiento le crea el plan de cobro al aceptar (`asegurarCobroDelEspacio`) y paga desde
 * `/suscripcion`. El pago abre su mes en Valida (`ciclo-servidor.ts`).
 *
 * Nada del navegador decide el espacio, la empresa, el NIT ni el precio: salen de la sesión, de
 * `valida_registros` y de `parametrosDelPlan`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type ResultadoActivacion = { ok: true; destino: string } | { ok: false; error: ErrorActivacion }

const TIPOS_RUT = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const TOPE_RUT_BYTES = 8 * 1024 * 1024

interface FilaRegistro {
  razon_social: string
  identificacion: string
  dv: string | null
  correo: string
}

/** El RUT, leído y comparado. Cualquier falla de lectura es `ilegible`: nunca frena la activación. */
async function leerRut(
  svc: Db,
  archivo: File,
  workspaceId: string,
  declarado: { nit: string; dv: string | null; razonSocial: string },
): Promise<{ veredicto: VeredictoRut; documento_path: string | null; confianza: number | null }> {
  if (!TIPOS_RUT.has(archivo.type.toLowerCase()) || archivo.size === 0 || archivo.size > TOPE_RUT_BYTES) {
    return { veredicto: 'ilegible', documento_path: null, confianza: null }
  }
  const ext = archivo.type === 'application/pdf' ? 'pdf' : archivo.type.split('/')[1] || 'bin'
  const ruta = `${COBRADOR_VALIDA.workspaceId}/valida-autogestion/${workspaceId}/rut_${Date.now()}.${ext}`
  const buffer = await archivo.arrayBuffer()
  const sub = await svc.storage.from('rut-documents').upload(ruta, buffer, { contentType: archivo.type, upsert: false })
  const documentoPath = sub.error ? null : ruta
  if (sub.error) console.error('[valida-activacion] RUT al bucket:', sub.error.message)

  let llave = ''
  try {
    llave = getServerKey('gemini')
  } catch {
    llave = ''
  }
  const { data } = await parseRut(buffer, archivo.type, llave)
  if (!data) return { veredicto: 'ilegible', documento_path: documentoPath, confianza: null }
  const veredicto = compararRut(declarado, {
    nit: data.nit?.value ?? null,
    dv: data.digito_verificacion?.value ?? null,
    razonSocial: data.razon_social?.value ?? null,
    confianza: data.overall_confidence ?? 0,
  })
  return { veredicto, documento_path: documentoPath, confianza: data.overall_confidence ?? null }
}

export async function activarPlanValida(input: { rut: File | null }): Promise<ResultadoActivacion> {
  if (!activacionAbierta()) return { ok: false, error: 'cerrada' }

  const { user } = await getCachedUser()
  if (!user?.id) return { ok: false, error: 'sin_sesion' }

  const svc = createServiceClient() as Db
  const perfil = await svc.from('profiles').select('workspace_id, role').eq('id', user.id).maybeSingle()
  const workspaceId = (perfil.data?.workspace_id as string | null) ?? null
  if (perfil.error || !workspaceId) return { ok: false, error: 'sin_sesion' }
  if (perfil.data?.role !== 'owner') return { ok: false, error: 'no_es_duena' }

  const ws = await svc.from('workspaces').select('slug, config_extra').eq('id', workspaceId).maybeSingle()
  const config = (ws.data?.config_extra ?? null) as Record<string, unknown> | null
  if (ws.error || !ws.data || !esEspacioAutogestion(config)) return { ok: false, error: 'no_es_autogestion' }
  const slug = ws.data.slug as string

  const reg = await svc
    .from('valida_registros')
    .select('razon_social, identificacion, dv, correo')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'creado')
    .maybeSingle()
  const registro = reg.data as FilaRegistro | null
  if (reg.error || !registro) return { ok: false, error: 'sin_registro' }

  const parametros = parametrosDelPlan()
  const ahora = new Date()

  // 2. Los Términos de ESTA empresa: si falta un solo campo de la plantilla, no se activa.
  const llenado = llenarPlantilla(
    TERMINOS_PLAN.plantilla,
    camposDeLaOrden({
      razonSocial: registro.razon_social,
      nit: registro.identificacion,
      dv: registro.dv,
      correo: registro.correo,
      precioMensual: parametros.precio_mensual,
      licencias: parametros.licencias,
      limiteMes: parametros.limite_consultas_mes,
      ahora,
    }),
  )
  if (!llenado.ok) {
    console.error('[valida-activacion] la plantilla de los Términos pide campos que el sistema no llena:', llenado.faltan.join(', '))
    return { ok: false, error: 'terminos_incompletos' }
  }
  const textoMd = llenado.texto
  const textoSha = createHash('sha256').update(textoMd, 'utf8').digest('hex')

  let pdf: Buffer
  try {
    pdf = await pdfTerminos(textoMd, `${TERMINOS_PLAN.titulo} ${TERMINOS_PLAN.version} · ${registro.razon_social}`)
  } catch (e) {
    console.error('[valida-activacion] PDF de los Términos:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'pdf' }
  }
  const pdfSha = createHash('sha256').update(pdf).digest('hex')
  // La huella en el nombre: un reintento con otro PDF no pisa el anterior (la evidencia no se reescribe).
  const pdfPath = `${slug}/${TERMINOS_PLAN.slug}-${TERMINOS_PLAN.version}-${pdfSha.slice(0, 12)}.pdf`
  const subida = await svc.storage.from(BUCKET_ACEPTACIONES).upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: false })
  if (subida.error && !/exist/i.test(subida.error.message)) {
    console.error('[valida-activacion] PDF al bucket:', subida.error.message)
    return { ok: false, error: 'pdf' }
  }

  // 1. El RUT (opcional). Después del PDF a propósito: si los términos fallan, no se sube un RUT para nada.
  const rut = input.rut
    ? await leerRut(svc, input.rut, workspaceId, { nit: registro.identificacion, dv: registro.dv, razonSocial: registro.razon_social })
    : null

  const prueba = (config?.valida_prueba ?? null) as { vence_en?: string } | null
  const { data, error } = await svc.rpc('valida_activar_autogestion', {
    p_workspace_cliente: workspaceId,
    p_usuario: user.id,
    p_cobrador: COBRADOR_VALIDA.workspaceId,
    p_linea: COBRADOR_VALIDA.lineaValida,
    p_etapa: COBRADOR_VALIDA.etapaCobro,
    p_servicio_slug: FICHA_PLAN_VALIDA,
    p_parametros: parametros,
    p_terminos_plazo_hasta: plazoTerminos(prueba?.vence_en ?? null, todayBogotaISO()),
    p_documento: {
      slug: TERMINOS_PLAN.slug,
      titulo: TERMINOS_PLAN.titulo,
      version: TERMINOS_PLAN.version,
      texto_md: textoMd,
      texto_sha256: textoSha,
      pdf_path: pdfPath,
      pdf_sha256: pdfSha,
    },
    p_rut: rut,
  })
  if (error) {
    console.error('[valida-activacion] valida_activar_autogestion:', error.message)
    return { ok: false, error: 'error' }
  }
  const r = (data ?? {}) as { ok?: boolean; error?: ErrorActivacion; resultado?: string }
  if (!r.ok) return { ok: false, error: r.error ?? 'error' }
  // Lo que sigue es aceptar los Términos: la entrada de `/valida` los abre con `?terminos=1`.
  return { ok: true, destino: '/valida?terminos=1' }
}

/**
 * Después de que la persona acepta los Términos del plan: su plan de cobro nace YA (y no con el cron de
 * mañana), para que pueda pagar de una vez desde `/suscripcion`. Es el mismo enrolamiento del paso 6a,
 * angostado a su contrato: la cuota 1 vence el día de la aceptación (`dias_trial: 0`).
 *
 * Solo espacios del registro autogestionado: a un CDA de hoy no le hace nada (ni se llega a mirar su
 * contrato). Nunca lanza: si falla, el cron de mañana lo enrola igual.
 */
export async function asegurarCobroDelEspacio(workspaceId: string): Promise<void> {
  try {
    const svc = createServiceClient() as Db
    const ws = await svc.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle()
    if (ws.error || !esEspacioAutogestion(ws.data?.config_extra ?? null)) return
    const sc = await svc
      .from('servicios_contratados')
      .select('id, workspace_id, negocio_id')
      .eq('workspace_pagador_id', workspaceId)
      .eq('estado', 'activo')
    const contratos = (sc.data ?? []) as { id: string; workspace_id: string; negocio_id: string }[]
    if (sc.error || contratos.length !== 1) return
    const contrato = contratos[0]
    const r = await enrolarContratosPorCiclo({ db: svc, contratoId: contrato.id })
    if (r.errores.length > 0) console.error('[valida-activacion] enrolamiento al aceptar:', r.errores.map((e) => e.error).join('; '))
    // Con tarjeta registrada (ePayco, cláusula de cobro): el plan cobra por token y la cuota 1, que
    // vence hoy, se cobra ya. Sin tarjeta, nada cambia: paga con el enlace desde /suscripcion.
    for (const creado of r.creados) {
      if (await pasarElPlanATarjeta({ db: svc }, { cobradorId: contrato.workspace_id, planCobroId: creado.planCobroId, negocioId: contrato.negocio_id })) {
        await cobrarCuotasConTarjeta({ db: svc, hoy: todayBogotaISO(), soloPlan: creado.planCobroId })
      }
    }
  } catch (e) {
    console.error('[valida-activacion] enrolamiento al aceptar:', e instanceof Error ? e.message : e)
  }
}
