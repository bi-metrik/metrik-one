'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  UserCheck,
} from 'lucide-react';
import {
  cambiarEstadoCargo,
  crearCargo,
  listarTableroResponsables,
  nominarResponsableControl,
  registrarAceptacion,
  subirSoporteAceptacion,
  type ControlConResponsable,
  type TableroResponsables,
} from '@/lib/actions/compliance-responsables';
import {
  MOTIVO_ACEPTACION_ACCION,
  MOTIVO_ACEPTACION_LABEL,
  type MotivoAceptacion,
} from '@/lib/compliance/responsables';
import { formatBogotaFechaCortaAno, todayBogotaISO } from '@/lib/dates/bogota';

const ESTILO_MOTIVO: Record<MotivoAceptacion, string> = {
  sin_cargo: 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/30',
  sin_aceptacion: 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30',
  no_incluido: 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30',
  desactualizada: 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/30',
  vigente: 'bg-[#ECFDF5] text-[#059669] border-[#10B981]/30',
};

export default function ResponsablesClient({ inicial }: { inicial: TableroResponsables }) {
  const [tablero, setTablero] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function recargar() {
    const r = await listarTableroResponsables();
    if (r.ok) setTablero(r.data);
    else setError(r.error);
  }

  function correr(accion: () => Promise<string | null>) {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const err = await accion();
      if (err) setError(err);
      await recargar();
    });
  }

  const ind = tablero.indicadores;
  const cargosActivos = useMemo(() => tablero.cargos.filter((c) => c.activo), [tablero.cargos]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserCheck className="h-6 w-6 text-[#1A1A1A]" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Responsables de controles</h1>
          <p className="text-sm text-[#6B7280]">
            Qué cargo responde por cada control y quién lo aceptó. Responde un cargo, no una persona
            ni una cuenta: el responsable firma la carta y no necesita entrar a la plataforma.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {aviso && (
        <div className="p-3 rounded-lg bg-[#ECFDF5] border border-[#10B981]/30 text-[#059669] text-sm flex items-start gap-2">
          <Check className="h-4 w-4 mt-0.5 shrink-0" /> {aviso}
        </div>
      )}

      {/* ── Indicadores ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Indicador
          titulo="Controles con cargo nominado"
          valor={ind.pct_nominados === null ? '—' : `${ind.pct_nominados}%`}
          detalle={`${ind.con_cargo} de ${ind.total}`}
          alerta={ind.sin_cargo > 0}
        />
        <Indicador
          titulo="Con aceptación vigente"
          valor={ind.pct_aceptacion_vigente === null ? '—' : `${ind.pct_aceptacion_vigente}%`}
          detalle={`${ind.vigentes} de ${ind.total}`}
          alerta={ind.total > 0 && ind.vigentes < ind.total}
        />
        <Indicador
          titulo="Aceptaciones desactualizadas"
          valor={String(ind.desactualizados)}
          detalle="El control cambió después de firmar"
          alerta={ind.desactualizados > 0}
        />
      </div>

      {ind.total === 0 && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 text-center text-sm text-[#6B7280]">
          Este workspace todavía no tiene controles en la matriz de riesgo. Los indicadores quedan en
          blanco a propósito: sin controles no hay nada que medir, y un 0% o un 100% mentirían en
          direcciones opuestas.
        </div>
      )}

      <Cargos
        tablero={tablero}
        pending={pending}
        onCrear={(nombre) =>
          correr(async () => {
            const r = await crearCargo({ nombre });
            if (!r.ok) return r.error;
            setAviso(`Cargo "${nombre}" agregado al catálogo.`);
            return null;
          })
        }
        onEstado={(cargoId, activo, nombre) =>
          correr(async () => {
            const r = await cambiarEstadoCargo({ cargo_id: cargoId, activo });
            if (!r.ok) return r.error;
            setAviso(
              activo
                ? `"${nombre}" vuelve al catálogo.`
                : `"${nombre}" queda desactivado. Sigue en la bitácora: los cargos no se borran.`,
            );
            return null;
          })
        }
        onAceptar={(cargoId, datos) =>
          correr(async () => {
            const r = await registrarAceptacion({ cargo_id: cargoId, ...datos });
            if (!r.ok) return r.error;
            setAviso('Aceptación registrada.');
            return null;
          })
        }
      />

      <Controles
        controles={tablero.controles}
        cargos={cargosActivos}
        usuarios={tablero.usuarios}
        pending={pending}
        onNominar={(controlId, cargoId, usuarioId) =>
          correr(async () => {
            const r = await nominarResponsableControl({
              control_id: controlId,
              cargo_responsable_id: cargoId,
              usuario_responsable_id: usuarioId,
            });
            if (!r.ok) return r.error;
            setAviso(
              'Responsable actualizado. Si el cargo ya había aceptado, esa aceptación queda desactualizada y hay que emitir una carta nueva.',
            );
            return null;
          })
        }
      />

      <Bitacora tablero={tablero} />
    </div>
  );
}

function Indicador({
  titulo,
  valor,
  detalle,
  alerta,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  alerta: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-lg border p-4 ${alerta ? 'border-[#F59E0B]/40' : 'border-[#E5E7EB]'}`}
    >
      <p className="text-xs uppercase tracking-wide text-[#6B7280]">{titulo}</p>
      <p className={`text-2xl font-bold mt-1 ${alerta ? 'text-[#B45309]' : 'text-[#059669]'}`}>
        {valor}
      </p>
      <p className="text-xs text-[#6B7280] mt-0.5">{detalle}</p>
    </div>
  );
}

// ─── Catálogo de cargos ────────────────────────────────────────────────────

function Cargos({
  tablero,
  pending,
  onCrear,
  onEstado,
  onAceptar,
}: {
  tablero: TableroResponsables;
  pending: boolean;
  onCrear: (nombre: string) => void;
  onEstado: (cargoId: string, activo: boolean, nombre: string) => void;
  onAceptar: (
    cargoId: string,
    datos: {
      persona_nombre: string;
      persona_documento: string;
      medio: 'documento_cargado';
      soporte_path: string;
      fecha_aceptacion: string;
    },
  ) => void;
}) {
  const [nuevo, setNuevo] = useState('');
  const [aceptando, setAceptando] = useState<string | null>(null);

  const controlesPorCargo = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of tablero.controles) {
      if (!c.cargo_responsable_id) continue;
      m.set(c.cargo_responsable_id, (m.get(c.cargo_responsable_id) ?? 0) + 1);
    }
    return m;
  }, [tablero.controles]);

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
      <div>
        <h2 className="text-base font-bold text-[#1A1A1A]">Cargos responsables</h2>
        <p className="text-sm text-[#6B7280]">
          El catálogo del workspace. Un cargo no se borra: se desactiva, porque el que ya nominó
          controles y firmó aceptaciones tiene que seguir siendo legible en la bitácora.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Ej. Coordinador jurídico predial"
          className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#10B981]/30"
        />
        <button
          type="button"
          disabled={pending || !nuevo.trim()}
          onClick={() => {
            onCrear(nuevo.trim());
            setNuevo('');
          }}
          className="px-3 py-2 text-sm font-semibold rounded-lg bg-[#1A1A1A] text-white disabled:opacity-40 flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" /> Agregar
        </button>
      </div>

      {tablero.cargos.length === 0 ? (
        <p className="text-sm text-[#6B7280]">
          Todavía no hay cargos. Empieza por los que ya aparecen en tu matriz de riesgo.
        </p>
      ) : (
        <div className="space-y-2">
          {tablero.cargos.map((cargo) => {
            const n = controlesPorCargo.get(cargo.id) ?? 0;
            return (
              <div key={cargo.id} className="border border-[#E5E7EB] rounded-lg">
                <div className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
                  <span
                    className={`text-sm font-semibold ${cargo.activo ? 'text-[#1A1A1A]' : 'text-[#6B7280] line-through'}`}
                  >
                    {cargo.nombre}
                  </span>
                  <span className="text-xs text-[#6B7280]">{n} control(es)</span>
                  <div className="flex-1" />
                  {n > 0 && (
                    <a
                      href={`/api/compliance/cargos/${cargo.id}/carta`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-[#1A1A1A] border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 hover:bg-[#F5F4F2]"
                    >
                      <FileText className="h-3.5 w-3.5" /> Carta
                    </a>
                  )}
                  {n > 0 && cargo.activo && (
                    <button
                      type="button"
                      onClick={() => setAceptando(aceptando === cargo.id ? null : cargo.id)}
                      className="text-xs font-semibold text-white bg-[#10B981] rounded-lg px-2.5 py-1.5"
                    >
                      Registrar aceptación
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onEstado(cargo.id, !cargo.activo, cargo.nombre)}
                    className="text-xs text-[#6B7280] underline disabled:opacity-40"
                  >
                    {cargo.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                </div>

                {aceptando === cargo.id && (
                  <FormAceptacion
                    pending={pending}
                    controles={n}
                    onCancelar={() => setAceptando(null)}
                    onGuardar={(datos) => {
                      onAceptar(cargo.id, datos);
                      setAceptando(null);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Formulario de aceptación.
 *
 * NO ofrece la firma dentro de la aplicación. Está construida en el modelo de
 * datos pero apagada (`FIRMA_ONE_HABILITADA`) hasta que el CLO se pronuncie
 * sobre su valor probatorio frente a un documento firmado. La vía operativa es
 * cargar el papel que la persona firmó.
 */
function FormAceptacion({
  pending,
  controles,
  onCancelar,
  onGuardar,
}: {
  pending: boolean;
  controles: number;
  onCancelar: () => void;
  onGuardar: (datos: {
    persona_nombre: string;
    persona_documento: string;
    medio: 'documento_cargado';
    soporte_path: string;
    fecha_aceptacion: string;
  }) => void;
}) {
  const hoy = todayBogotaISO();
  const [nombre, setNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  async function guardar() {
    setErrorLocal(null);
    if (!nombre.trim() || !documento.trim()) {
      setErrorLocal('El nombre y el documento de quien acepta son obligatorios.');
      return;
    }
    if (!archivo) {
      setErrorLocal('Carga la carta firmada: sin el documento, la aceptación es tu palabra.');
      return;
    }

    setSubiendo(true);
    const fd = new FormData();
    fd.append('archivo', archivo);
    const sub = await subirSoporteAceptacion(fd);
    setSubiendo(false);
    if (!sub.ok) {
      setErrorLocal(sub.error);
      return;
    }

    onGuardar({
      persona_nombre: nombre.trim(),
      persona_documento: documento.trim(),
      medio: 'documento_cargado',
      soporte_path: sub.data.path,
      fecha_aceptacion: fecha,
    });
  }

  return (
    <div className="border-t border-[#E5E7EB] p-3 bg-[#F5F4F2] space-y-3">
      <p className="text-xs text-[#6B7280]">
        Se registrarán los <strong>{controles}</strong> control(es) que este cargo tiene hoy, con la
        versión actual de cada uno. Si alguno cambia después, la aceptación quedará desactualizada y
        habrá que emitir una carta nueva.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-xs text-[#6B7280]">
          Nombre de quien acepta
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="mt-1 w-full px-2.5 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white"
          />
        </label>
        <label className="text-xs text-[#6B7280]">
          Documento de identidad
          <input
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
            placeholder="CC 1020304050"
            className="mt-1 w-full px-2.5 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white"
          />
        </label>
        <label className="text-xs text-[#6B7280]">
          Fecha de la firma
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => setFecha(e.target.value)}
            className="mt-1 w-full px-2.5 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white"
          />
        </label>
      </div>

      <label className="block text-xs text-[#6B7280]">
        Carta firmada (PDF o imagen)
        <input
          type="file"
          accept=".pdf,image/*"
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm text-[#1A1A1A]"
        />
      </label>

      {errorLocal && <p className="text-xs text-[#B91C1C]">{errorLocal}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || subiendo}
          onClick={guardar}
          className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-[#10B981] text-white disabled:opacity-40 flex items-center gap-1.5"
        >
          {(pending || subiendo) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {subiendo ? 'Cargando documento…' : 'Registrar aceptación'}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="px-3 py-1.5 text-sm text-[#6B7280] underline"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Controles ─────────────────────────────────────────────────────────────

function Controles({
  controles,
  cargos,
  usuarios,
  pending,
  onNominar,
}: {
  controles: ControlConResponsable[];
  cargos: TableroResponsables['cargos'];
  usuarios: TableroResponsables['usuarios'];
  pending: boolean;
  onNominar: (controlId: string, cargoId: string | null, usuarioId: string | null) => void;
}) {
  const [abierto, setAbierto] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-bold text-[#1A1A1A]">Controles ({controles.length})</h2>
        <p className="text-sm text-[#6B7280]">
          El cargo dice quién responde ante un auditor. El usuario es opcional y solo aplica a quien
          opera el control dentro de la plataforma: nominarlo no reparte accesos, pero vincularlo sí
          hace que el control le aparezca.
        </p>
      </div>

      <div className="space-y-2">
        {controles.map((c) => (
          <FilaControl
            key={c.id}
            control={c}
            cargos={cargos}
            usuarios={usuarios}
            pending={pending}
            expandido={abierto === c.id}
            onToggle={() => setAbierto(abierto === c.id ? null : c.id)}
            onNominar={onNominar}
          />
        ))}
      </div>
    </div>
  );
}

function FilaControl({
  control,
  cargos,
  usuarios,
  pending,
  expandido,
  onToggle,
  onNominar,
}: {
  control: ControlConResponsable;
  cargos: TableroResponsables['cargos'];
  usuarios: TableroResponsables['usuarios'];
  pending: boolean;
  expandido: boolean;
  onToggle: () => void;
  onNominar: (controlId: string, cargoId: string | null, usuarioId: string | null) => void;
}) {
  const [cargoId, setCargoId] = useState(control.cargo_responsable_id ?? '');
  const [usuarioId, setUsuarioId] = useState(control.responsable_id ?? '');
  const motivo = control.estado.motivo;

  // Un cargo desactivado que todavía nomina este control tiene que seguir
  // visible en el selector; si no, abrir la fila lo borraría sin querer.
  const opciones = useMemo(() => {
    const base = cargos.filter((c) => c.activo);
    if (control.cargo_responsable_id && !base.some((c) => c.id === control.cargo_responsable_id)) {
      return [
        ...base,
        {
          id: control.cargo_responsable_id,
          nombre: `${control.cargo_nombre ?? 'Cargo'} (desactivado)`,
          activo: false,
          orden: 999,
        },
      ];
    }
    return base;
  }, [cargos, control.cargo_responsable_id, control.cargo_nombre]);

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left flex-wrap"
      >
        {expandido ? (
          <ChevronDown className="h-4 w-4 text-[#6B7280] shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#6B7280] shrink-0" />
        )}
        {control.referencia && (
          <span className="text-xs font-bold text-white bg-[#1A1A1A] rounded px-1.5 py-0.5">
            {control.referencia}
          </span>
        )}
        <span className="text-sm font-semibold text-[#1A1A1A] flex-1 min-w-[12rem]">
          {control.nombre_control ?? 'Control sin nombre'}
        </span>
        <span className="text-xs text-[#6B7280]">
          {control.cargo_nombre ?? 'Sin cargo responsable'}
        </span>
        <span className={`text-xs font-semibold border rounded-full px-2 py-0.5 ${ESTILO_MOTIVO[motivo]}`}>
          {MOTIVO_ACEPTACION_LABEL[motivo]}
        </span>
      </button>

      {expandido && (
        <div className="border-t border-[#E5E7EB] p-4 space-y-3">
          {MOTIVO_ACEPTACION_ACCION[motivo] && (
            <p className="text-sm text-[#B45309] flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              {MOTIVO_ACEPTACION_ACCION[motivo]}
            </p>
          )}

          {control.actividad_control && (
            <p className="text-sm text-[#6B7280]">{control.actividad_control}</p>
          )}

          {control.estado.aceptacion && (
            <p className="text-xs text-[#6B7280]">
              Última aceptación del cargo: {control.estado.aceptacion.persona_nombre} el{' '}
              {formatBogotaFechaCortaAno(control.estado.aceptacion.fecha_aceptacion)}.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-xs text-[#6B7280]">
              Cargo responsable (nomina)
              <select
                value={cargoId}
                onChange={(e) => setCargoId(e.target.value)}
                className="mt-1 w-full px-2.5 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white"
              >
                <option value="">Sin cargo</option>
                {opciones.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#6B7280]">
              Usuario que lo opera en ONE (opcional)
              <select
                value={usuarioId}
                onChange={(e) => setUsuarioId(e.target.value)}
                className="mt-1 w-full px-2.5 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white"
              >
                <option value="">Nadie — se ejecuta fuera de la plataforma</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            disabled={pending}
            onClick={() => onNominar(control.id, cargoId || null, usuarioId || null)}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-[#1A1A1A] text-white disabled:opacity-40"
          >
            Guardar responsable
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Bitácora ──────────────────────────────────────────────────────────────

function Bitacora({ tablero }: { tablero: TableroResponsables }) {
  if (tablero.aceptaciones.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-3">
      <div>
        <h2 className="text-base font-bold text-[#1A1A1A]">
          Bitácora de aceptaciones ({tablero.aceptaciones.length})
        </h2>
        <p className="text-sm text-[#6B7280]">
          No se puede editar ni borrar: corregir una aceptación es registrar otra. Cada fila
          conserva la versión de los controles que se aceptó.
        </p>
      </div>

      <div className="space-y-1.5">
        {tablero.aceptaciones.map((a) => (
          <div
            key={a.id}
            className="flex justify-between gap-3 border-t border-[#E5E7EB] pt-1.5 text-sm flex-wrap"
          >
            <span className="font-semibold text-[#1A1A1A]">
              {a.persona_nombre}{' '}
              <span className="font-normal text-[#6B7280]">— {a.cargo_nombre ?? 'Cargo'}</span>
            </span>
            <span className="text-[#6B7280] text-xs">
              {a.controles_snapshot?.length ?? 0} control(es) ·{' '}
              {formatBogotaFechaCortaAno(a.fecha_aceptacion)} · registró{' '}
              {a.registrada_por_nombre ?? 'el oficial'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
