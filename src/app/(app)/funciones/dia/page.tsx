import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerDia } from '@/lib/funciones/datos'
import { ETIQUETA_ESTADO_FUNCION, ETIQUETA_ESTADO_RESERVA, ETIQUETA_PAGO, fechaBogota, horaBogota, puedeEditarFunciones, rangoDiaBogota, textoSaldo } from '@/lib/funciones/reglas'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { AccionesReserva } from '../acciones-reserva'

export const dynamic = 'force-dynamic'

/**
 * `/funciones/dia?fecha=AAAA-MM-DD`: la lista del día para la cocina y el servicio (Anexo 2.2, punto 8), agrupada
 * por función, legible impresa. Las restricciones alimentarias salen SOLO si están autorizadas: la base no deja
 * guardarlas de otra forma, y si no hay autorización la fila dice «sin autorización». El saldo de cada reserva
 * confirmada (P14) sale de la base; el equipo lo cobra con el QR de Bold ([Saldo cobrado]) o manda un link nuevo.
 */
export default async function DiaPage({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')

  const { fecha: pedida } = await searchParams
  const fecha = pedida && rangoDiaBogota(pedida) ? pedida : todayBogotaISO()
  const funciones = await leerDia(supabase as unknown as SupabaseClient, workspaceId, fecha)
  const editar = puedeEditarFunciones(role)
  const titulo = fechaBogota(`${fecha}T12:00:00-05:00`)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6 print:p-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#1A1A1A] first-letter:uppercase">{titulo}</h1>
          <p className="text-sm text-[#6B7280]">Lista del día por función</p>
        </div>
        <form className="flex items-center gap-2 text-sm print:hidden">
          <input type="date" name="fecha" defaultValue={fecha} className="rounded-md border border-[#E5E7EB] px-2 py-1" />
          <button className="rounded-md border border-[#E5E7EB] px-3 py-1 hover:bg-gray-50">Ver</button>
        </form>
      </div>

      {funciones.length === 0 && <p className="text-sm text-[#6B7280]">No hay funciones este día.</p>}

      {funciones.map(({ ocupacion: o, reservas }) => (
        <section key={o.funcion_id} className="break-inside-avoid rounded-lg border border-[#E5E7EB] bg-white">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] px-4 py-3">
            <div>
              <h2 className="font-semibold text-[#1A1A1A]">
                {horaBogota(o.inicia_at)} · {o.experiencia}
              </h2>
              <p className="text-xs text-[#6B7280]">
                Cupo {o.cupo_total} · ocupadas {o.ocupadas} · libres {o.libres} · {ETIQUETA_ESTADO_FUNCION[o.estado]}
              </p>
            </div>
            <Link href={`/funciones/${o.funcion_id}`} className="text-sm text-[#059669] hover:underline print:hidden">
              Ver función
            </Link>
          </header>
          {reservas.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[#6B7280]">Sin reservas activas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-[#6B7280]">
                  <tr>
                    <th className="px-4 py-2">Nombre</th>
                    <th className="px-2 py-2">Pers.</th>
                    <th className="px-2 py-2">Lo que pidió</th>
                    <th className="px-2 py-2">Restricciones</th>
                    <th className="px-2 py-2">Estado</th>
                    <th className="px-2 py-2">Canal</th>
                    {editar && <th className="px-2 py-2 print:hidden" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {reservas.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-2 font-medium text-[#1A1A1A]">{r.nombre ?? '(sin nombre)'}</td>
                      <td className="px-2 py-2">{r.personas}</td>
                      <td className="px-2 py-2 text-[#6B7280]">{r.solicitud_cliente ?? ''}</td>
                      <td className="px-2 py-2">{r.autorizada ? r.restricciones ?? '' : <span className="text-[#6B7280]">sin autorización</span>}</td>
                      <td className="px-2 py-2 text-xs">
                        {ETIQUETA_ESTADO_RESERVA[r.estado]}
                        <br />
                        <span className="text-[#6B7280]">{ETIQUETA_PAGO[r.pago_estado]}</span>
                        {textoSaldo(r.saldo, r.estado) && (
                          <>
                            <br />
                            <span className="font-medium text-[#1A1A1A]">{textoSaldo(r.saldo, r.estado)!.texto}</span>
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs text-[#6B7280]">{r.canal}</td>
                      {editar && (
                        <td className="px-2 py-2 print:hidden">
                          <AccionesReserva funcionId={o.funcion_id} reserva={r} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
