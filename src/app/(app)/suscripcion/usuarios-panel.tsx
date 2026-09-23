'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { UserPlus } from 'lucide-react'
import { formatCOP } from '@/lib/cobros/format'
import {
  etiquetaRol,
  licenciaAdicionalLiberable,
  type AccionesUsuario,
  type Cupo,
  type UsuarioDelEspacio,
} from '@/lib/usuarios-espacio/reglas'
import {
  cambiarRolEnEspacio,
  comprarUsuarioAdicional,
  cotizarUsuarioAdicional,
  invitarAlEspacio,
  reenviarInvitacionEspacio,
  retirarDelEspacio,
  type CotizacionVisible,
} from './acciones'

export interface FilaUsuario extends UsuarioDelEspacio {
  acciones: AccionesUsuario
  /** El último ingreso ya formateado en el servidor (Bogotá); `null` = invitación pendiente. */
  ultimoIngresoTexto: string | null
}

export interface DatosUsuarios {
  /** `null` = no se pudieron leer. */
  lista: FilaUsuario[] | null
  cupo: Cupo | null
  valorAdicional: number | null
  adicionalesVigentes: number
  licenciasContrato: number | null
  /** «Ver como» de un platform admin: se ve la lista, sin agregar a nadie. */
  soloLectura?: boolean
}

/**
 * La pestaña Usuarios de `/suscripcion`: quién tiene acceso, invitar, retirar, reenviar la invitación
 * y cambiar el rol. Cuando no hay licencia libre, el mismo flujo ofrece agregar una (cláusula 2.3)
 * con una casilla de solicitud expresa. Todo lo decide el servidor; aquí solo se pregunta.
 */
export function UsuariosPanel({ datos }: { datos: DatosUsuarios }) {
  const [agregando, setAgregando] = useState(false)
  const [cotizacion, setCotizacion] = useState<{ cot: CotizacionVisible | null; error: string | null } | null>(null)
  const [cotizando, iniciarCotizacion] = useTransition()

  function abrirAgregar() {
    setAgregando(true)
    // Sin licencia libre, el mismo flujo ofrece agregar una: el cobro depende de la fecha y del plan,
    // así que lo calcula el servidor al abrir.
    if (datos.cupo && datos.cupo.libres <= 0) {
      setCotizacion(null)
      iniciarCotizacion(async () => {
        const r = await cotizarUsuarioAdicional()
        setCotizacion(r.ok ? { cot: r.cotizacion, error: null } : { cot: null, error: r.error })
      })
    }
  }

  if (!datos.lista) {
    return (
      <p className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">
        No se pudieron cargar los usuarios de tu espacio. Intenta de nuevo en un momento.
      </p>
    )
  }

  const lista = datos.lista
  const contador = datos.cupo
    ? `${datos.cupo.usados} de ${datos.cupo.licencias} licencias en uso`
    : `${lista.length} usuarios con acceso`
  const precio = datos.valorAdicional !== null ? ` · ${formatCOP(datos.valorAdicional)} por usuario adicional al mes` : ''

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-tinta" data-contador-licencias>
          {contador}
          {precio}
        </p>
        {datos.cupo && !agregando && !datos.soloLectura && (
          <button
            type="button"
            onClick={abrirAgregar}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-acento px-4 py-2 text-sm font-semibold text-white"
          >
            <UserPlus className="h-4 w-4" />
            Agregar usuario
          </button>
        )}
      </div>

      {!datos.cupo && (
        <p className="rounded-lg border border-border bg-papel p-3 text-sm text-tinta-suave">
          Tu espacio no tiene registradas sus licencias. Escríbenos y lo resolvemos.
        </p>
      )}

      {agregando && datos.cupo && (
        datos.cupo.libres > 0 ? (
          <FormularioInvitacion onCerrar={() => setAgregando(false)} />
        ) : (
          <AgregarLicencia
            valorAdicional={datos.valorAdicional}
            cotizando={cotizando}
            cot={cotizacion?.cot ?? null}
            error={cotizacion?.error ?? null}
            onCerrar={() => setAgregando(false)}
          />
        )
      )}

      <ul className="space-y-2" data-lista-usuarios>
        {lista.map((u) => (
          <FilaDeUsuario
            key={u.id}
            usuario={u}
            liberable={
              datos.licenciasContrato !== null &&
              licenciaAdicionalLiberable({
                licencias: datos.licenciasContrato,
                usadosDespues: lista.length - 1,
                adicionalesVigentes: datos.adicionalesVigentes,
              })
            }
          />
        ))}
      </ul>
    </div>
  )
}

function FormularioInvitacion({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter()
  const [correo, setCorreo] = useState('')
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState<'operator' | 'admin'>('operator')
  const [pendiente, iniciar] = useTransition()

  function invitar(e: React.FormEvent) {
    e.preventDefault()
    iniciar(async () => {
      const r = await invitarAlEspacio({ correo, nombre, rol })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(
        r.correoEnviado
          ? `Listo. ${nombre.trim()} ya tiene acceso y le enviamos un correo para entrar.`
          : `${nombre.trim()} ya tiene acceso, pero el correo no salió. Reenvía la invitación desde la lista.`,
      )
      onCerrar()
      router.refresh()
    })
  }

  return (
    <form onSubmit={invitar} data-form-invitar className="space-y-3 rounded-lg border border-border bg-white p-4">
      <p className="text-sm font-semibold text-tinta">Agregar usuario</p>
      <label className="block text-sm text-tinta">
        Nombre
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm text-tinta">
        Correo
        <input
          type="email"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm text-tinta">
        Rol
        <select
          value={rol}
          onChange={(e) => setRol(e.target.value === 'admin' ? 'admin' : 'operator')}
          className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="operator">Operador</option>
          <option value="admin">Administrador</option>
        </select>
      </label>
      <p className="text-xs text-tinta-suave">
        La persona entra con este correo desde la página de ingreso de tu espacio; le llega un código, sin contraseña.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={pendiente}
          className="rounded-md bg-acento px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          Dar acceso
        </button>
        <button type="button" onClick={onCerrar} className="rounded-md border border-border px-4 py-2 text-sm text-tinta">
          Cancelar
        </button>
      </div>
    </form>
  )
}

function AgregarLicencia({
  valorAdicional,
  cotizando,
  cot,
  error,
  onCerrar,
}: {
  valorAdicional: number | null
  cotizando: boolean
  cot: CotizacionVisible | null
  error: string | null
  onCerrar: () => void
}) {
  const router = useRouter()
  const [acepta, setAcepta] = useState(false)
  const [pendiente, iniciar] = useTransition()

  function confirmar() {
    iniciar(async () => {
      const r = await comprarUsuarioAdicional({ solicitudExpresa: acepta })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Listo. Tienes una licencia más: ya puedes dar acceso a otra persona.')
      router.refresh()
    })
  }

  return (
    <section data-agregar-licencia className="space-y-3 rounded-lg border border-border bg-white p-4">
      <p className="text-sm font-semibold text-tinta">No hay licencias libres</p>
      <p className="text-sm text-tinta">
        Para dar acceso a otra persona, agrega una licencia
        {valorAdicional !== null ? ` de ${formatCOP(valorAdicional)} al mes` : ''}. El acceso es inmediato.
      </p>
      {cotizando && <p className="text-sm text-tinta-suave">Calculando el cobro…</p>}
      {error && <p className="text-sm text-amber-800">{error}</p>}
      {cot && (
        <>
          <div className="rounded-md bg-papel p-3 text-sm text-tinta" data-resumen-cobro>
            <p>
              Se suma a tu cuota {cot.cuotaNumero}: {formatCOP(cot.prorrataMonto)} por los {cot.prorrataDias} días que
              quedan del periodo del {cot.periodoTexto} (de {cot.periodoDias}), y {formatCOP(cot.valorMensual)} en cada
              periodo siguiente.
            </p>
            <p className="mt-1 text-tinta-suave">Tu cuota {cot.cuotaNumero} sube {formatCOP(cot.cuotaSube)}.</p>
          </div>
          <label className="flex items-start gap-2 text-sm text-tinta">
            <input
              type="checkbox"
              checked={acepta}
              onChange={(e) => setAcepta(e.target.checked)}
              className="mt-0.5"
              data-solicitud-expresa
            />
            Solicito un usuario adicional según la cláusula 2.3 de los Términos.
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={confirmar}
              disabled={!acepta || pendiente}
              className="rounded-md bg-acento px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Agregar una licencia
            </button>
            <button type="button" onClick={onCerrar} className="rounded-md border border-border px-4 py-2 text-sm text-tinta">
              Cancelar
            </button>
          </div>
        </>
      )}
      {error && (
        <button type="button" onClick={onCerrar} className="rounded-md border border-border px-4 py-2 text-sm text-tinta">
          Cerrar
        </button>
      )}
    </section>
  )
}

function FilaDeUsuario({ usuario: u, liberable }: { usuario: FilaUsuario; liberable: boolean }) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [dejarDePagar, setDejarDePagar] = useState(true)
  const [pendiente, iniciar] = useTransition()

  function retirar() {
    iniciar(async () => {
      const r = await retirarDelEspacio({ usuarioId: u.id, dejarDePagarAdicional: liberable && dejarDePagar })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      const cobro = r.licenciaLiberada
        ? r.desdeCuota !== null
          ? ` La licencia adicional deja de cobrarse desde la cuota ${r.desdeCuota}.`
          : ' La licencia adicional deja de cobrarse desde el periodo siguiente.'
        : ''
      toast.success(`${u.nombre} ya no tiene acceso.${cobro}`)
      setConfirmando(false)
      router.refresh()
    })
  }

  function cambiarRol(rol: string) {
    iniciar(async () => {
      const r = await cambiarRolEnEspacio({ usuarioId: u.id, rol })
      if (!r.ok) toast.error(r.error)
      else router.refresh()
    })
  }

  function reenviar() {
    iniciar(async () => {
      const r = await reenviarInvitacionEspacio({ usuarioId: u.id })
      if (!r.ok) toast.error(r.error)
      else toast.success(`Le reenviamos la invitación a ${u.correo ?? u.nombre}.`)
    })
  }

  return (
    <li className="rounded-lg border border-border bg-white p-3 text-sm" data-usuario={u.id}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-tinta">{u.nombre}</p>
          {u.correo && <p className="truncate text-xs text-tinta-suave">{u.correo}</p>}
          <p className="text-xs text-tinta-suave">
            {u.ultimoIngresoTexto ? `Último ingreso: ${u.ultimoIngresoTexto}` : 'Invitación pendiente'}
            {u.acciones.nota ? ` · ${u.acciones.nota}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {u.acciones.puedeCambiarRol ? (
            <select
              aria-label={`Rol de ${u.nombre}`}
              value={u.role === 'admin' ? 'admin' : 'operator'}
              disabled={pendiente}
              onChange={(e) => cambiarRol(e.target.value)}
              className="rounded-md border border-border bg-white px-2 py-1 text-sm"
            >
              <option value="operator">Operador</option>
              <option value="admin">Administrador</option>
            </select>
          ) : (
            <span className="rounded-full bg-papel px-2 py-0.5 text-xs text-tinta">{etiquetaRol(u.role)}</span>
          )}
          {u.acciones.puedeReenviar && (
            <button type="button" onClick={reenviar} disabled={pendiente} className="text-sm font-semibold text-acento">
              Reenviar invitación
            </button>
          )}
          {u.acciones.puedeRetirar && !confirmando && (
            <button type="button" onClick={() => setConfirmando(true)} className="text-sm text-tinta-suave">
              Retirar usuario
            </button>
          )}
        </div>
      </div>
      {confirmando && (
        <div className="mt-3 space-y-2 rounded-md bg-papel p-3" data-confirmar-retiro>
          <p className="text-tinta">
            {u.nombre} pierde el acceso ahora y su licencia queda libre para otra persona.
          </p>
          {liberable && (
            <label className="flex items-start gap-2 text-tinta">
              <input type="checkbox" checked={dejarDePagar} onChange={(e) => setDejarDePagar(e.target.checked)} className="mt-0.5" />
              Dejar de pagar la licencia adicional desde el periodo siguiente.
            </label>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={retirar}
              disabled={pendiente}
              className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
            >
              Retirar
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="rounded-md border border-border px-4 py-2 text-sm text-tinta"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
