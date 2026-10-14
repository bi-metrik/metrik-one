import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { enlaceActivarPlan } from '@/lib/valida/corte-bolsa'
import { activacionAbierta } from '@/lib/valida-registro/activacion'
import { esEspacioAutogestion, parametrosDelPlan } from '@/lib/valida-registro/plan'
import { nitLegible } from '@/lib/valida-registro/terminos-plan'
import ActivarClient from './activar-client'

/**
 * «Activa tu plan» de una cuenta que nació en la prueba gratis (`18-recorrido-baja-friccion.md` §2.2,
 * pantallas 7 a 9). Solo para espacios del registro autogestionado; cualquier otro (los CDA de hoy)
 * va a su suscripción. Un espacio que ya activó, también.
 */

export const dynamic = 'force-dynamic'

const PESOS = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

export default async function ActivarPlanPage() {
  const { workspaceId } = await getWorkspace()
  if (!workspaceId) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const [ws, reg, contrato] = await Promise.all([
    svc.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle(),
    svc.from('valida_registros').select('razon_social, identificacion, dv').eq('workspace_id', workspaceId).eq('estado', 'creado').maybeSingle(),
    svc.from('servicios_contratados').select('id').eq('workspace_pagador_id', workspaceId).in('estado', ['activo', 'pausado']).limit(1),
  ])
  if (!esEspacioAutogestion(ws.data?.config_extra ?? null) || !reg.data) redirect('/suscripcion')
  if ((contrato.data ?? []).length > 0) redirect('/valida?terminos=1')

  const plan = parametrosDelPlan()
  const empresa = reg.data as { razon_social: string; identificacion: string; dv: string | null }

  return (
    <main className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-tinta">Activa tu plan de Valida</h1>
        <p className="text-sm text-tinta-suave">
          {empresa.razon_social} · NIT {nitLegible(empresa.identificacion, empresa.dv)}
        </p>
      </header>

      <section className="space-y-2 rounded-lg border border-border bg-white p-4 text-sm text-tinta">
        <p className="text-base font-semibold">${PESOS.format(plan.precio_mensual)} al mes</p>
        <ul className="list-disc space-y-1 pl-5 text-tinta-suave">
          <li>Hasta {PESOS.format(plan.limite_consultas_mes)} consultas al mes, individuales o por cargue masivo.</li>
          <li>{plan.licencias} usuarios incluidos.</li>
          <li>Sin permanencia: se renueva cada mes y te puedes retirar cuando quieras.</li>
          <li>El reporte deja de llevar la marca de prueba desde tu primer pago.</li>
        </ul>
      </section>

      <section className="space-y-2 text-sm text-tinta-suave">
        <p>Así sigue: 1. activas el plan; 2. lees y aceptas los Términos de tu empresa; 3. pagas el primer mes en línea.</p>
      </section>

      <ActivarClient abierta={activacionAbierta()} whatsapp={enlaceActivarPlan(empresa.razon_social)} />
    </main>
  )
}
