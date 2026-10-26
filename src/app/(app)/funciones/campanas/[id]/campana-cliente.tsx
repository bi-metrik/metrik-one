'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import type { CampanaPanel, FuncionAgenda, Negocio } from '@/lib/funciones/datos'
import { DIAS_SALDO, diaBogota, diasSaldoValido, ETIQUETA_ESTADO_CAMPANA, insigniaFuncion, pesos, preventaPasaLaFuncion } from '@/lib/funciones/reglas'
import { fechaCortaTexto } from '../../../../../../supabase/functions/_shared/funciones/fecha-texto.ts'
import { generarBienvenida, generarMensajeDirecto, generarOferta } from '../../../../../../supabase/functions/_shared/funciones/textos.ts'
import {
  agregarFuncionesAction,
  cambiarCuposAction,
  cambiarPreventaAction,
  cambiarEstadoCampanaAction,
  cambiarEstadoFuncionAction,
  duplicarCampanaAction,
  eliminarCampanaAction,
  eliminarFuncionAction,
  guardarAnuncioAction,
  guardarCampanaAction,
  publicarCampanaAction,
  type LineaAgenda,
} from '../../actions'
import { AgendaEditor } from '../../agenda-editor'
import { conDeshacer, copiar, Hoja, Insignia } from '../../panel-ui'
import { fichaParaTextos, funcionesParaTextos, VistaTexto } from '../../textos-ui'

type HojaAbierta =
  | { tipo: 'precios' }
  | { tipo: 'menu' }
  | { tipo: 'post' }
  | { tipo: 'directo' }
  | { tipo: 'bienvenida'; f: FuncionAgenda }
  | { tipo: 'preventa'; f: FuncionAgenda }
  | { tipo: 'publicar' }
  | { tipo: 'confirmar'; titulo: string; efecto: string; texto: string; peligro?: boolean; accion: () => void }
  | { tipo: 'funcion'; f: FuncionAgenda }
  | { tipo: 'cupo'; f: FuncionAgenda }
  | null

/**
 * La campaña (§4.2, §4.5, §4.6): estado, código copiable, precios, agenda y el ⋮ de la campaña, con los tres textos de
 * la ficha (P11): el post («Publicar y copiar post» lo copia), el mensaje directo y, en cada función, la bienvenida al
 * grupo. Un texto con «[FALTA: …]» o pasado de su límite no se deja copiar; con Nequi/Daviplata solo avisa.
 */
export function CampanaCliente({ campana: c, negocio, puedeEditar, ahoraMs }: { campana: CampanaPanel; negocio: Negocio; puedeEditar: boolean; ahoraMs: number }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [hoja, setHoja] = useState<HojaAbierta>(null)
  const [agregando, setAgregando] = useState(false)
  const [lineas, setLineas] = useState<LineaAgenda[] | null>(null)
  const vivas = c.funciones.filter((f) => f.estado !== 'cancelada')
  const ultima = c.funciones[c.funciones.length - 1]
  const ficha = fichaParaTextos(c)
  const oferta = generarOferta({ ficha, negocio, campana: { dias_saldo_antes: c.dias_saldo_antes }, funciones: funcionesParaTextos(c.funciones), ahoraMs })
  const directo = generarMensajeDirecto({ ficha, negocio, campana: { nombre: c.nombre, dias_saldo_antes: c.dias_saldo_antes }, funciones: funcionesParaTextos(c.funciones), ahoraMs })
  const bienvenida = (f: FuncionAgenda) => generarBienvenida({ ficha, negocio, funcion: { inicia_at: f.inicia_at } })

  /** «Publicar y copiar post»: copia el post que ya se mostró (dentro del toque) y publica. */
  const publicarYCopiar = (conPost: boolean) =>
    empezar(async () => {
      const copiado = conPost ? copiar(oferta.texto, 'Post copiado.') : null
      const r = await publicarCampanaAction(c.campana_id)
      setHoja(null)
      await copiado
      if (!r.ok) return void toast.error(r.error)
      toast.success(`Publicada: ${r.dato?.funciones ?? ''} funciones disponibles para el asistente.`)
      router.refresh()
    })

  const correr = (f: () => Promise<{ ok: boolean; error?: string }>, ok: string, despues?: () => void) =>
    empezar(async () => {
      const r = await f()
      setHoja(null)
      if (!r.ok) return void toast.error(r.error ?? 'No se pudo.')
      toast.success(ok)
      despues?.()
      router.refresh()
    })

  const estadoCampana = (estado: 'activa' | 'pausada' | 'cerrada') => cambiarEstadoCampanaAction(c.campana_id, estado)

  const reactivar = () =>
    empezar(async () => {
      const r = await estadoCampana('activa')
      setHoja(null)
      if (!r.ok) return void toast.error(r.error)
      conDeshacer('Campaña activa: el asistente vuelve a ofrecer sus funciones.', async () => {
        const d = await estadoCampana('pausada')
        router.refresh()
        return d
      })
      router.refresh()
    })

  const reactivarFuncion = (f: FuncionAgenda) =>
    empezar(async () => {
      const r = await cambiarEstadoFuncionAction(c.campana_id, f.funcion_id, 'activa')
      setHoja(null)
      if (!r.ok) return void toast.error(r.error)
      conDeshacer('Función activa.', async () => {
        const d = await cambiarEstadoFuncionAction(c.campana_id, f.funcion_id, 'pausada')
        router.refresh()
        return d
      })
      router.refresh()
    })

  const duplicar = () =>
    empezar(async () => {
      const r = await duplicarCampanaAction(c.campana_id)
      setHoja(null)
      if (!r.ok) return void toast.error(r.error)
      conDeshacer('Campaña duplicada: agrégale la agenda.', async () => {
        const d = await eliminarCampanaAction(r.dato!)
        router.push(`/funciones/campanas/${c.campana_id}`)
        return d
      })
      router.push(`/funciones/campanas/${r.dato}`)
    })

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24 md:p-6">
      <header className="space-y-2">
        <Link href="/funciones" className="text-xs text-[#6B7280] hover:underline">← Campañas</Link>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-[#1A1A1A]">{c.nombre}</h1>
            <Link href={`/funciones/experiencias/${c.experiencia.experiencia_id}`} className="text-sm text-[#6B7280] hover:underline">{c.experiencia.nombre}</Link>
          </div>
          <div className="flex items-center gap-1">
            <Insignia texto={ETIQUETA_ESTADO_CAMPANA[c.estado] ?? c.estado} />
            {puedeEditar && (
              <button type="button" aria-label="Más acciones de la campaña" onClick={() => setHoja({ tipo: 'menu' })} className="flex size-10 items-center justify-center rounded-md hover:bg-gray-100">
                <MoreVertical className="size-5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[#6B7280]">Código</span>
          <code className="rounded bg-gray-100 px-2 py-0.5 font-mono">{c.codigo}</code>
          <button type="button" onClick={() => copiar(c.codigo, 'Código copiado.')} className="text-[#059669] underline">Copiar</button>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm">
          <span>
            {pesos(c.precio_persona)}
            {c.precio_preventa_persona ? ` · prev ${pesos(c.precio_preventa_persona)}` : ''}
            {c.abono_persona ? ` · abono ${pesos(c.abono_persona)}` : ''}
            {c.permite_pago_total ? '' : ' · sin pago total'}
            {` · saldo ${c.dias_saldo_antes === 1 ? '1 día' : `${c.dias_saldo_antes} días`} antes`}
          </span>
          {puedeEditar && <button type="button" onClick={() => setHoja({ tipo: 'precios' })} className="text-[#059669] underline">Cambiar</button>}
        </div>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-[#1A1A1A]">Agenda</h2>
        {c.funciones.length === 0 && <p className="rounded-lg border border-dashed border-[#E5E7EB] p-4 text-sm text-[#6B7280]">Sin funciones todavía. Agrégalas abajo.</p>}
        <ul className="space-y-2">
          {c.funciones.map((f) => {
            const insignia = insigniaFuncion(f)
            const paraEquipo = Math.max(f.capacidad - f.ocupadas, 0)
            return (
              <li key={f.funcion_id} className="rounded-lg border border-[#E5E7EB] bg-white">
                <div className="flex items-center gap-2 px-3 py-2">
                  <Link href={`/funciones/${f.funcion_id}`} className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[#1A1A1A] first-letter:uppercase">{f.inicia_texto}</div>
                    <div className="text-xs text-[#6B7280]">
                      {f.ocupadas}/{f.cupo_asistente} asist · {f.ocupadas}/{f.capacidad}
                      {f.es_preventa ? ` · ${etiquetaPreventa(f)}` : ''}
                    </div>
                  </Link>
                  <Insignia texto={insignia} />
                  {puedeEditar && (
                    <button type="button" aria-label="Acciones de la función" onClick={() => setHoja({ tipo: 'funcion', f })} className="flex size-10 items-center justify-center rounded-md hover:bg-gray-100">
                      <MoreVertical className="size-4" />
                    </button>
                  )}
                </div>
                {insignia === 'Llena para el asistente' && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[#E5E7EB] px-3 py-2 text-xs">
                    <span className="text-sky-700">Quedan {paraEquipo} para el equipo</span>
                    <Link href={`/funciones/${f.funcion_id}`} className="rounded border border-[#E5E7EB] px-2 py-1">Agendar a mano</Link>
                    {puedeEditar && <button type="button" onClick={() => setHoja({ tipo: 'cupo', f })} className="rounded border border-[#E5E7EB] px-2 py-1">Subir cupo del asistente</button>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {puedeEditar && c.estado !== 'cerrada' && (
          agregando ? (
            <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-white p-3">
              <AgendaEditor onCambio={setLineas} ahoraMs={ahoraMs} />
              <p className="text-xs text-[#6B7280]">Con el cupo de la última función: {ultima ? `${ultima.capacidad} · asistente ${ultima.cupo_asistente}` : 'escríbelo en el detalle de cada función después'}.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAgregando(false)} className="h-11 rounded-md border border-[#E5E7EB] px-4 text-sm">Cerrar</button>
                <button
                  type="button"
                  disabled={pendiente || !lineas || !ultima}
                  onClick={() => correr(() => agregarFuncionesAction(c.campana_id, lineas!, ultima!.capacidad, ultima!.cupo_asistente), 'Funciones agregadas.', () => setAgregando(false))}
                  className="h-11 flex-1 rounded-md bg-[#10B981] text-sm font-medium text-white disabled:opacity-50"
                >
                  Agregar {lineas?.length ?? 0} funciones
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAgregando(true)} className="h-11 w-full rounded-md border border-dashed border-[#E5E7EB] text-sm">+ Agregar funciones</button>
          )
        )}
        {puedeEditar && !ultima && agregando && <p className="text-xs text-amber-700">La primera agenda se arma desde «Nueva campaña» (pide el cupo).</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-[#1A1A1A]">Textos de la oferta</h2>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setHoja({ tipo: 'post' })} className="h-11 rounded-md border border-[#E5E7EB] text-sm">Ver post</button>
          <button type="button" disabled={!directo.copiable} onClick={() => copiar(directo.texto, 'Mensaje directo copiado.')} className="h-11 rounded-md border border-[#E5E7EB] text-sm disabled:opacity-50">
            Copiar mensaje directo
          </button>
        </div>
        {!directo.copiable && (
          <button type="button" onClick={() => setHoja({ tipo: 'directo' })} className="text-left text-xs text-red-600 underline">
            El mensaje directo no se puede copiar todavía: ver por qué
          </button>
        )}
        {puedeEditar && !c.publicada && (
          <button type="button" disabled={vivas.length === 0} onClick={() => setHoja({ tipo: 'publicar' })} className="h-11 w-full rounded-md bg-[#10B981] text-sm font-medium text-white disabled:opacity-50">
            Publicar y copiar post
          </button>
        )}
      </section>

      {/* ── Hojas ── */}
      <Hoja abierta={hoja?.tipo === 'post'} onCerrar={() => setHoja(null)} titulo="Post de Instagram">
        <VistaTexto generado={oferta} textoBoton="Copiar post" aviso="Post copiado." />
      </Hoja>

      <Hoja abierta={hoja?.tipo === 'directo'} onCerrar={() => setHoja(null)} titulo="Mensaje directo de Instagram">
        <VistaTexto generado={directo} textoBoton="Copiar mensaje directo" aviso="Mensaje directo copiado." />
      </Hoja>

      {hoja?.tipo === 'bienvenida' && (
        <Hoja abierta onCerrar={() => setHoja(null)} titulo={`Bienvenida al grupo · ${hoja.f.inicia_texto}`}>
          <VistaTexto generado={bienvenida(hoja.f)} textoBoton="Copiar bienvenida al grupo" aviso="Bienvenida copiada." />
        </Hoja>
      )}

      {hoja?.tipo === 'preventa' && (
        <HojaPreventa
          f={hoja.f}
          pendiente={pendiente}
          onCerrar={() => setHoja(null)}
          onGuardar={(on, hasta) => correr(() => cambiarPreventaAction(c.campana_id, hoja.f.funcion_id, on, hasta), on ? 'Preventa encendida.' : 'Preventa apagada.')}
        />
      )}

      <Hoja
        abierta={hoja?.tipo === 'publicar'}
        onCerrar={() => setHoja(null)}
        titulo="Publicar la campaña"
        efecto={
          oferta.copiable
            ? `Las ${vivas.length} funciones quedan disponibles para el asistente desde ya, y el post queda copiado para Instagram.`
            : `Las ${vivas.length} funciones quedan disponibles para el asistente desde ya. El post no se puede copiar todavía: ${oferta.motivo}`
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => setHoja(null)} className="h-11 rounded-md border border-[#E5E7EB] px-4 text-sm">Volver</button>
          {!oferta.copiable && (
            <button type="button" disabled={pendiente} onClick={() => publicarYCopiar(false)} className="h-11 rounded-md border border-[#E5E7EB] px-4 text-sm disabled:opacity-50">
              Publicar sin el post
            </button>
          )}
          <button type="button" disabled={pendiente || !oferta.copiable} onClick={() => publicarYCopiar(true)} className="h-11 flex-1 rounded-md bg-[#10B981] px-4 text-sm font-medium text-white disabled:opacity-50">
            Publicar y copiar post
          </button>
        </div>
      </Hoja>

      {hoja?.tipo === 'confirmar' && (
        <Hoja
          abierta
          onCerrar={() => setHoja(null)}
          titulo={hoja.titulo}
          efecto={hoja.efecto}
          confirmar={{ texto: hoja.texto, peligro: hoja.peligro, pendiente, onConfirmar: hoja.accion }}
        />
      )}

      <Hoja abierta={hoja?.tipo === 'menu'} onCerrar={() => setHoja(null)} titulo={c.nombre}>
        <MenuCampana
          c={c}
          pendiente={pendiente}
          onPausar={() =>
            setHoja({
              tipo: 'confirmar', titulo: 'Pausar la campaña', texto: 'Pausar',
              efecto: `El asistente deja de ofrecer sus ${vivas.length} funciones. Las reservas hechas siguen.`,
              accion: () => correr(() => estadoCampana('pausada'), 'Campaña pausada.'),
            })
          }
          onReactivar={reactivar}
          onCerrarCampana={() =>
            setHoja({
              tipo: 'confirmar', titulo: 'Cerrar la campaña', texto: 'Cerrar',
              efecto: 'No se vende más. Las reservas hechas siguen. Igual se cierra sola cuando pasa su última función.',
              accion: () => correr(() => estadoCampana('cerrada'), 'Campaña cerrada.'),
            })
          }
          onDuplicar={duplicar}
          onEliminar={() =>
            setHoja({
              tipo: 'confirmar', titulo: 'Eliminar la campaña', texto: 'Eliminar', peligro: true,
              efecto: c.funciones.some((f) => f.reservas_activas > 0)
                ? 'Tiene reservas: queda en el historial (archivada) y no se lista ni se vende.'
                : 'No tiene reservas: se borra con su agenda.',
              accion: () => correr(() => eliminarCampanaAction(c.campana_id), 'Campaña eliminada.', () => router.push('/funciones')),
            })
          }
        />
      </Hoja>

      {hoja?.tipo === 'precios' && <HojaPrecios c={c} onCerrar={() => setHoja(null)} onGuardar={(f) => correr(f, 'Precios guardados. Las reservas hechas conservan su precio.')} pendiente={pendiente} />}

      {hoja?.tipo === 'funcion' && (
        <Hoja abierta onCerrar={() => setHoja(null)} titulo={hoja.f.inicia_texto}>
          <div className="grid gap-2">
            {hoja.f.estado === 'activa' && (
              <button type="button" className="h-11 rounded-md border border-[#E5E7EB] text-sm" onClick={() => {
                const f = hoja.f
                setHoja({
                  tipo: 'confirmar', titulo: 'Pausar la función', texto: 'Pausar',
                  efecto: 'El asistente deja de ofrecerla. El equipo puede seguir agendando a mano. Las reservas hechas siguen.',
                  accion: () => correr(() => cambiarEstadoFuncionAction(c.campana_id, f.funcion_id, 'pausada'), 'Función pausada.'),
                })
              }}>Pausar</button>
            )}
            {hoja.f.estado === 'pausada' && (
              <button type="button" className="h-11 rounded-md border border-[#E5E7EB] text-sm" onClick={() => reactivarFuncion(hoja.f)}>Reactivar</button>
            )}
            <button type="button" className="h-11 rounded-md border border-[#E5E7EB] text-sm" onClick={() => setHoja({ tipo: 'cupo', f: hoja.f })}>Cambiar cupos</button>
            <button type="button" className="h-11 rounded-md border border-[#E5E7EB] text-sm" onClick={() => setHoja({ tipo: 'preventa', f: hoja.f })}>
              Preventa{hoja.f.es_preventa ? ` (${etiquetaPreventa(hoja.f)})` : ''}
            </button>
            <button type="button" className="h-11 rounded-md border border-[#E5E7EB] text-sm" onClick={() => setHoja({ tipo: 'bienvenida', f: hoja.f })}>
              Copiar bienvenida al grupo
            </button>
            {hoja.f.estado !== 'cancelada' && (
              <button type="button" className="h-11 rounded-md border border-red-200 text-sm text-red-700" onClick={() => {
                const f = hoja.f
                setHoja({
                  tipo: 'confirmar', titulo: 'Cancelar la función', texto: 'Cancelar función', peligro: true,
                  efecto: f.reservas_activas > 0 ? `Tiene ${f.reservas_activas} reservas: hay que avisarles.` : 'No tiene reservas.',
                  accion: () => correr(() => cambiarEstadoFuncionAction(c.campana_id, f.funcion_id, 'cancelada'), 'Función cancelada.'),
                })
              }}>Cancelar función</button>
            )}
            <button type="button" className="h-11 rounded-md border border-red-200 text-sm text-red-700" onClick={() => {
              const f = hoja.f
              setHoja({
                tipo: 'confirmar', titulo: 'Eliminar la función', texto: 'Eliminar', peligro: true,
                efecto: f.reservas_activas > 0 ? 'Tiene reservas: queda en el historial (archivada) y no se vende.' : 'No tiene reservas: se borra.',
                accion: () => correr(() => eliminarFuncionAction(c.campana_id, f.funcion_id), 'Función eliminada.'),
              })
            }}>Eliminar</button>
          </div>
        </Hoja>
      )}

      {hoja?.tipo === 'cupo' && <HojaCupos c={c} f={hoja.f} pendiente={pendiente} onCerrar={() => setHoja(null)} onGuardar={(cap, asist) => correr(() => cambiarCuposAction(c.campana_id, hoja.f.funcion_id, cap, asist), 'Cupos guardados.')} />}
    </div>
  )
}

function MenuCampana(p: {
  c: CampanaPanel
  pendiente: boolean
  onPausar: () => void
  onReactivar: () => void
  onCerrarCampana: () => void
  onDuplicar: () => void
  onEliminar: () => void
}) {
  const { c } = p
  const router = useRouter()
  const [nombre, setNombre] = useState(c.nombre)
  const [codigo, setCodigo] = useState(c.codigo)
  const [anuncio, setAnuncio] = useState('')
  const [pendiente, empezar] = useTransition()
  const guardarDatos = () =>
    empezar(async () => {
      const r = await guardarCampanaAction(c.campana_id, {
        experiencia_id: c.experiencia.experiencia_id, nombre, codigo, desde: c.desde, hasta: c.hasta, estado: c.estado_guardado,
        minutos_apartado: c.minutos_apartado,
        precios: { precio_persona: c.precio_persona, precio_preventa_persona: c.precio_preventa_persona, abono_persona: c.abono_persona, permite_pago_total: c.permite_pago_total, tope_sobreventa: c.tope_sobreventa, dias_saldo_antes: c.dias_saldo_antes },
      })
      if (!r.ok) return void toast.error(r.error)
      toast.success('Datos guardados.')
      router.refresh()
    })
  const anuncioAccion = (ad: string, quitar: boolean) =>
    empezar(async () => {
      const r = await guardarAnuncioAction(c.campana_id, ad, quitar)
      if (!r.ok) return void toast.error(r.error)
      setAnuncio('')
      router.refresh()
    })
  const campo = 'mt-1 h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-base'
  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto text-sm">
      <div className="grid gap-2">
        {c.estado === 'activa' || c.estado === 'agotada' ? (
          <button type="button" className="h-11 rounded-md border border-[#E5E7EB]" onClick={p.onPausar}>Pausar</button>
        ) : null}
        {c.estado === 'pausada' && <button type="button" className="h-11 rounded-md border border-[#E5E7EB]" onClick={p.onReactivar}>Reactivar</button>}
        {c.estado !== 'cerrada' && c.publicada && <button type="button" className="h-11 rounded-md border border-[#E5E7EB]" onClick={p.onCerrarCampana}>Cerrar</button>}
        <button type="button" className="h-11 rounded-md border border-[#E5E7EB]" onClick={p.onDuplicar}>Duplicar</button>
        <button type="button" className="h-11 rounded-md border border-red-200 text-red-700" onClick={p.onEliminar}>Eliminar</button>
      </div>

      <div className="space-y-2 border-t border-[#E5E7EB] pt-3">
        <p className="font-medium">Datos de la campaña</p>
        <label className="block">Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} className={campo} /></label>
        <label className="block">
          Código de atribución
          <input value={codigo} disabled={c.publicada} onChange={(e) => setCodigo(e.target.value.toUpperCase())} className={`${campo} font-mono disabled:bg-gray-50`} />
          {c.publicada && <span className="text-xs text-[#6B7280]">Publicada: el código ya no cambia.</span>}
        </label>
        <p className="text-xs text-[#6B7280]">Fechas: {c.desde ?? '—'} a {c.hasta ?? '—'} (de la primera a la última función).</p>
        <button type="button" disabled={pendiente || p.pendiente} onClick={guardarDatos} className="h-11 w-full rounded-md bg-[#10B981] font-medium text-white disabled:opacity-50">Guardar datos</button>
      </div>

      <div className="space-y-2 border-t border-[#E5E7EB] pt-3">
        <p className="font-medium">Anuncios de WhatsApp</p>
        <p className="text-xs text-[#6B7280]">El id de cada anuncio que lleva a esta campaña: así el asistente sabe de qué campaña viene el cliente.</p>
        {c.anuncios.map((a) => (
          <div key={a} className="flex items-center justify-between rounded border border-[#E5E7EB] px-2 py-1">
            <code className="font-mono text-xs">{a}</code>
            <button type="button" onClick={() => anuncioAccion(a, true)} className="text-xs text-red-700">Quitar</button>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={anuncio} onChange={(e) => setAnuncio(e.target.value.trim())} placeholder="Id del anuncio" className="h-11 flex-1 rounded-md border border-[#E5E7EB] px-3 font-mono" />
          <button type="button" disabled={!anuncio || pendiente} onClick={() => anuncioAccion(anuncio, false)} className="h-11 rounded-md border border-[#E5E7EB] px-3 disabled:opacity-50">Agregar</button>
        </div>
      </div>
    </div>
  )
}

function HojaPrecios(p: { c: CampanaPanel; onCerrar: () => void; onGuardar: (f: () => Promise<{ ok: boolean; error?: string }>) => void; pendiente: boolean }) {
  const { c } = p
  const [precio, setPrecio] = useState(String(c.precio_persona ?? ''))
  const [preventa, setPreventa] = useState(String(c.precio_preventa_persona ?? ''))
  const [abono, setAbono] = useState(String(c.abono_persona ?? ''))
  const [total, setTotal] = useState(c.permite_pago_total)
  const [minutos, setMinutos] = useState(String(c.minutos_apartado ?? ''))
  const [tope, setTope] = useState(String(c.tope_sobreventa ?? ''))
  const [dias, setDias] = useState(String(c.dias_saldo_antes))
  const n = (s: string) => (s.trim() ? Math.round(Number(s.replace(/[.$\s]/g, ''))) : null)
  const campo = 'mt-1 h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-base'
  return (
    <Hoja
      abierta
      onCerrar={p.onCerrar}
      titulo="Precios y reglas"
      efecto="Las reservas hechas conservan su precio."
      confirmar={{
        texto: 'Guardar', pendiente: p.pendiente || !diasSaldoValido(n(dias)),
        onConfirmar: () => p.onGuardar(() => guardarCampanaAction(c.campana_id, {
          experiencia_id: c.experiencia.experiencia_id, nombre: c.nombre, codigo: c.codigo, desde: c.desde, hasta: c.hasta,
          estado: c.estado_guardado, minutos_apartado: n(minutos),
          precios: { precio_persona: n(precio), precio_preventa_persona: n(preventa), abono_persona: n(abono), permite_pago_total: total, tope_sobreventa: n(tope), dias_saldo_antes: n(dias) ?? DIAS_SALDO.porDefecto },
        })),
      }}
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>Por persona<input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} className={campo} /></label>
        <label>Preventa<input inputMode="numeric" value={preventa} onChange={(e) => setPreventa(e.target.value)} className={campo} /></label>
        <label>Abono por persona<input inputMode="numeric" value={abono} onChange={(e) => setAbono(e.target.value)} className={campo} /></label>
        <label className="flex items-end gap-2 pb-3"><input type="checkbox" checked={total} onChange={(e) => setTotal(e.target.checked)} className="size-5" /> Pago total</label>
        <label>Minutos de apartado<input inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value)} className={campo} /></label>
        <label>Tope de sobreventa<input inputMode="numeric" value={tope} onChange={(e) => setTope(e.target.value)} className={campo} placeholder="Sin sobreventa" /></label>
        <label className="col-span-2">Paga el saldo (días antes de la función)<input inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} className={campo} /></label>
        {!diasSaldoValido(n(dias)) && <p className="col-span-2 text-xs text-red-600">Los días antes para pagar el saldo van de 1 a 30.</p>}
      </div>
    </Hoja>
  )
}

function HojaCupos(p: { c: CampanaPanel; f: FuncionAgenda; pendiente: boolean; onCerrar: () => void; onGuardar: (cap: number, asist: number) => void }) {
  const [cap, setCap] = useState(String(p.f.capacidad))
  const [asist, setAsist] = useState(String(p.f.capacidad))
  const capN = Number(cap)
  const asistN = Number(asist)
  const bajaDeLoOcupado = capN < p.f.ocupadas
  const campo = 'mt-1 h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-base'
  return (
    <Hoja
      abierta
      onCerrar={p.onCerrar}
      titulo={`Cupos · ${p.f.inicia_texto}`}
      efecto={`Hay ${p.f.ocupadas} personas ocupando. La capacidad no baja de ahí.`}
      confirmar={{ texto: 'Guardar', pendiente: p.pendiente || bajaDeLoOcupado || !(asistN >= 1 && asistN <= capN), onConfirmar: () => p.onGuardar(capN, asistN) }}
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>Cupo<input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} className={campo} /></label>
        <label>Cupo del asistente<input inputMode="numeric" value={asist} onChange={(e) => setAsist(e.target.value)} className={campo} /></label>
      </div>
      {bajaDeLoOcupado && <p className="text-xs text-red-600">Hay {p.f.ocupadas} ocupando: el cupo no puede quedar en {capN}.</p>}
    </Hoja>
  )
}

/** «preventa hasta el 15 de octubre», «preventa vencida» o «preventa» (sin fecha de fin). */
function etiquetaPreventa(f: FuncionAgenda): string {
  if (f.tarifa.tarifa !== 'preventa') return 'preventa vencida'
  return f.preventa_hasta ? `preventa hasta el ${fechaCortaTexto(f.preventa_hasta)}` : 'preventa'
}

/** P4: el interruptor de preventa de una función, con su fecha de fin (no puede pasar el día de la función). */
function HojaPreventa(p: { f: FuncionAgenda; pendiente: boolean; onCerrar: () => void; onGuardar: (on: boolean, hasta: string | null) => void }) {
  const [on, setOn] = useState(p.f.es_preventa)
  const [hasta, setHasta] = useState(p.f.preventa_hasta ?? '')
  const diaFuncion = diaBogota(p.f.inicia_at)
  const pasa = on && preventaPasaLaFuncion(hasta, diaFuncion)
  return (
    <Hoja
      abierta
      onCerrar={p.onCerrar}
      titulo={`Preventa · ${p.f.inicia_texto}`}
      efecto="Encendida, rige el precio de preventa hasta su fecha de fin (inclusive); después, el regular. Las reservas hechas conservan su precio."
      confirmar={{ texto: 'Guardar', pendiente: p.pendiente || pasa, onConfirmar: () => p.onGuardar(on, on && hasta ? hasta : null) }}
    >
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-5" /> Preventa encendida</label>
        {on && (
          <label className="block">
            Hasta (inclusive)
            <input type="date" value={hasta} max={diaFuncion} onChange={(e) => setHasta(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-base" />
            <span className="text-xs text-[#6B7280]">Vacía: sin fecha de fin.</span>
          </label>
        )}
        {pasa && <p className="text-xs text-red-600">La preventa no puede terminar después de la función.</p>}
      </div>
    </Hoja>
  )
}
