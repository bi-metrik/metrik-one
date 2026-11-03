'use client'

import Link from 'next/link'
import { MapPin, Plus } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CampanaResumen, Experiencia, Ocupacion } from '@/lib/funciones/datos'
import { ETIQUETA_ESTADO_CAMPANA, fechaBogota, horaBogota, pesos } from '@/lib/funciones/reglas'
import { Insignia } from './panel-ui'

const corto = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

/** El inicio del panel (§4.1, §4.2, §4.6): pestañas, aviso de llenas para el asistente y el [+] de nueva campaña. */
export function InicioCliente(p: {
  campanas: CampanaResumen[]
  experiencias: Experiencia[]
  hoy: Array<Ocupacion & { reservas: number }>
  fechaHoy: string
  pestana: 'campanas' | 'hoy' | 'experiencias'
  puedeEditar: boolean
}) {
  const llenasSemana = p.campanas.reduce((s, c) => s + Number(c.llenas_asistente_semana), 0)
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1A1A1A]">Funciones</h1>
        <div className="flex items-center gap-2">
          <Link href="/funciones/lugar" className="inline-flex h-10 items-center gap-1 rounded-md border border-[#E5E7EB] px-3 text-sm text-[#1A1A1A] hover:bg-gray-50">
            <MapPin className="size-4" /> Datos del lugar
          </Link>
          {p.puedeEditar && (
            <Link href="/funciones/campanas/nueva" className="inline-flex h-10 items-center gap-1 rounded-md bg-[#10B981] px-3 text-sm font-medium text-white hover:bg-[#059669]">
              <Plus className="size-4" /> Nueva campaña
            </Link>
          )}
        </div>
      </div>

      {llenasSemana > 0 && (
        <Link href="/funciones?pestana=campanas" className="block rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {llenasSemana} {llenasSemana === 1 ? 'función llena' : 'funciones llenas'} para el asistente esta semana. Quedan puestos para el equipo.
        </Link>
      )}

      <Tabs defaultValue={p.pestana}>
        <TabsList className="w-full">
          <TabsTrigger value="campanas">Campañas</TabsTrigger>
          <TabsTrigger value="hoy">Hoy</TabsTrigger>
          <TabsTrigger value="experiencias">Experiencias</TabsTrigger>
        </TabsList>

        <TabsContent value="campanas" className="space-y-2">
          {p.campanas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#E5E7EB] p-6 text-sm text-[#6B7280]">
              Todavía no hay campañas.{p.puedeEditar ? ' Crea la primera con «Nueva campaña».' : ''}
            </p>
          ) : (
            p.campanas.map((c) => (
              <Link key={c.campana_id} href={`/funciones/campanas/${c.campana_id}`} className="block rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-[#1A1A1A]">{c.nombre}</span>
                  <Insignia texto={ETIQUETA_ESTADO_CAMPANA[c.estado] ?? c.estado} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[#6B7280]">
                  <span>{c.funciones} {Number(c.funciones) === 1 ? 'función' : 'funciones'} · {c.llenas} llenas</span>
                  {Number(c.llenas_asistente) > 0 && <span className="text-sky-700">{c.llenas_asistente} llenas para el asistente</span>}
                  {c.proxima && <span>Próxima: {corto.format(new Date(c.proxima))}</span>}
                  <span>{pesos(c.precio_persona)}</span>
                </div>
              </Link>
            ))
          )}
        </TabsContent>

        <TabsContent value="hoy" className="space-y-2">
          <p className="text-sm text-[#6B7280] first-letter:uppercase">{fechaBogota(`${p.fechaHoy}T12:00:00-05:00`)}</p>
          {p.hoy.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#E5E7EB] p-6 text-sm text-[#6B7280]">No hay funciones hoy.</p>
          ) : (
            p.hoy.map((o) => (
              <Link key={o.funcion_id} href={`/funciones/${o.funcion_id}`} className="flex items-center justify-between rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 hover:bg-gray-50">
                <span>
                  <span className="font-medium text-[#1A1A1A]">{horaBogota(o.inicia_at)}</span>
                  <span className="ml-2 text-sm text-[#6B7280]">{o.experiencia}</span>
                </span>
                <span className="text-xs text-[#6B7280]">
                  {o.ocupadas}/{o.cupo_total} · {o.reservas} reservas
                </span>
              </Link>
            ))
          )}
          <Link href={`/funciones/dia?fecha=${p.fechaHoy}`} className="block text-center text-sm text-[#059669] hover:underline">
            Lista del día para cocina y servicio
          </Link>
        </TabsContent>

        <TabsContent value="experiencias" className="space-y-2">
          {p.experiencias.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#E5E7EB] p-6 text-sm text-[#6B7280]">Las experiencias se crean en el paso 1 de una campaña nueva.</p>
          ) : (
            p.experiencias.map((e) => (
              <Link key={e.id} href={`/funciones/experiencias/${e.id}`} className="flex items-center justify-between rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 hover:bg-gray-50">
                <span className="font-medium text-[#1A1A1A]">{e.nombre}</span>
                <span className="text-xs text-[#6B7280]">{p.campanas.filter((c) => c.experiencia_id === e.id).length} campañas</span>
              </Link>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
