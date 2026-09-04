'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import {
  actualizarSujeto,
  cerrarRelacionSujeto,
  crearSujeto,
  historialSujeto,
  listarStaffSinSujeto,
  listarSujetos,
  reabrirRelacionSujeto,
  type EventoSujeto,
  type ExpedienteSujetos,
  type FilaSujeto,
} from '@/lib/actions/compliance-sujetos';
import {
  ESTADOS_SUJETO,
  ESTADO_SUJETO_ACCION,
  ESTADO_SUJETO_LABEL,
  TIPOS_SUJETO,
  TIPO_SUJETO_LABEL,
  porVencer,
  puedeGestionarSujetos,
  type EstadoSujeto,
} from '@/lib/compliance/sujetos';

/**
 * El color dice lo mismo que la frase: verde se puede contratar, ámbar hay que
 * hacer algo antes, rojo no. El ejecutor mira la fila, no la leyenda.
 */
const CHIP: Record<EstadoSujeto, string> = {
  habilitado: 'bg-[#ECFDF5] text-[#059669] border-[#10B981]/30',
  en_seguimiento: 'bg-[#ECFDF5] text-[#047857] border-[#10B981]/50',
  vencido: 'bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30',
  sin_consultar: 'bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30',
  inhabilitado: 'bg-[#EF4444]/10 text-[#B91C1C] border-[#EF4444]/30',
};

type Segmento = { id: string; nombre: string };
type StaffLibre = { id: string; full_name: string; position: string | null };

export default function SujetosClient({
  inicial,
  segmentos,
  rol,
}: {
  inicial: ExpedienteSujetos;
  segmentos: Segmento[];
  rol: string;
}) {
  const [base, setBase] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<EstadoSujeto | null>(null);
  const [verCerradas, setVerCerradas] = useState(false);

  const puedeGestionar = puedeGestionarSujetos(rol);

  function correr<T>(
    fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    alOk: string,
  ) {
    startTransition(async () => {
      setError(null);
      setAviso(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const rec = await listarSujetos();
      if (rec.ok) setBase(rec.data);
      setAviso(alOk);
    });
  }

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return base.sujetos.filter((s) => {
      if (!verCerradas && s.situacion.relacionCerrada) return false;
      if (filtro && s.situacion.estado !== filtro) return false;
      if (!q) return true;
      return (
        s.nombre.toLowerCase().includes(q) ||
        s.documento_numero.toLowerCase().includes(q)
      );
    });
  }, [base.sujetos, busqueda, filtro, verCerradas]);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Users className="h-6 w-6 text-[#1A1A1A] mt-0.5" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Empleados y contrapartes</h1>
          <p className="text-sm text-[#6B7280]">
            Quién está vinculado y si puede contratarse. El estado no se marca a mano:{' '}
            <strong>sale de la consulta vigente y de la decisión del oficial</strong>, así que
            cuando una vigencia caduca esta lista lo dice sola.
          </p>
        </div>
        {puedeGestionar && (
          <button
            onClick={() => setNuevo((v) => !v)}
            className="shrink-0 px-3 py-2 rounded-lg bg-[#1A1A1A] text-white text-sm font-medium flex items-center gap-2 hover:bg-[#333]"
          >
            <Plus className="h-4 w-4" /> Agregar
          </button>
        )}
      </div>

      {base.sinPeriodicidad && base.esOficial && (
        <div className="p-3 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-sm text-[#B45309]">
          Hay sujetos habilitados <strong>sin fecha de revalidación</strong>: el workspace todavía
          no adoptó la periodicidad. Mientras no la adoptes, esas consultas no vencen nunca y el
          tablero no puede avisarte.
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {aviso && (
        <div className="p-3 rounded-lg bg-[#ECFDF5] border border-[#10B981]/30 text-[#059669] text-sm">
          {aviso}
        </div>
      )}

      {/* Resumen: cada chip filtra. Los números son la pantalla, no un adorno. */}
      <div className="flex flex-wrap gap-2">
        {ESTADOS_SUJETO.map((e) => (
          <button
            key={e}
            onClick={() => setFiltro((f) => (f === e ? null : e))}
            className={`px-3 py-2 rounded-lg border text-sm ${CHIP[e]} ${
              filtro === e ? 'ring-2 ring-[#1A1A1A]/20' : ''
            }`}
          >
            <span className="font-bold">{base.resumen[e]}</span> {ESTADO_SUJETO_LABEL[e]}
          </button>
        ))}
        {base.resumen.porVencer > 0 && (
          <span className="px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white text-sm text-[#6B7280]">
            <span className="font-bold text-[#B45309]">{base.resumen.porVencer}</span> vencen en los
            próximos 30 días
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o documento"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-[#6B7280]">
          <input
            type="checkbox"
            checked={verCerradas}
            onChange={(e) => setVerCerradas(e.target.checked)}
          />
          Ver relaciones cerradas ({base.resumen.relacionesCerradas})
        </label>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-[#6B7280]" />}
      </div>

      {nuevo && puedeGestionar && (
        <FormNuevo
          segmentos={segmentos}
          onCancelar={() => setNuevo(false)}
          onCrear={(input) => {
            correr(() => crearSujeto(input), 'Sujeto agregado.');
            setNuevo(false);
          }}
        />
      )}

      <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
        {visibles.length === 0 ? (
          <div className="p-6 text-sm text-[#6B7280] text-center">
            {base.sujetos.length === 0
              ? 'Todavía no hay nadie en la base. Agrega los proveedores y contratistas con los que trabajas hoy.'
              : 'Ningún sujeto coincide con el filtro.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F5F4F2] text-[#6B7280]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Nombre</th>
                <th className="text-left px-3 py-2 font-semibold">Tipo</th>
                <th className="text-left px-3 py-2 font-semibold">Documento</th>
                <th className="text-left px-3 py-2 font-semibold">Estado</th>
                <th className="text-left px-3 py-2 font-semibold">Vigencia</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((s) => (
                <FilaSujetoUI
                  key={s.id}
                  sujeto={s}
                  hoy={base.hoy}
                  esOficial={base.esOficial}
                  puedeGestionar={puedeGestionar}
                  segmentos={segmentos}
                  abierto={abierto === s.id}
                  onToggle={() => setAbierto((a) => (a === s.id ? null : s.id))}
                  onCerrar={(fecha, motivo) =>
                    correr(
                      () => cerrarRelacionSujeto(s.id, fecha, motivo),
                      'Relación cerrada. Queda en la bitácora.',
                    )
                  }
                  onReabrir={(fecha, motivo) =>
                    correr(() => reabrirRelacionSujeto(s.id, fecha, motivo), 'Relación reabierta.')
                  }
                  onActualizar={(patch) =>
                    correr(() => actualizarSujeto({ id: s.id, ...patch }), 'Ficha actualizada.')
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-[#9CA3AF]">
        Cerrar una relación no borra nada ni inhabilita a nadie: registra que dejó de trabajar con
        la compañía, con fecha y motivo. Inhabilitar es decisión del oficial de cumplimiento.
      </p>
    </div>
  );
}

function FilaSujetoUI({
  sujeto,
  hoy,
  esOficial,
  puedeGestionar,
  segmentos,
  abierto,
  onToggle,
  onCerrar,
  onReabrir,
  onActualizar,
}: {
  sujeto: FilaSujeto;
  hoy: string;
  esOficial: boolean;
  puedeGestionar: boolean;
  segmentos: Segmento[];
  abierto: boolean;
  onToggle: () => void;
  onCerrar: (fecha: string, motivo: string) => void;
  onReabrir: (fecha: string, motivo: string) => void;
  onActualizar: (patch: { tipo?: string; segmento_id?: string | null; notas?: string | null }) => void;
}) {
  const { situacion } = sujeto;
  const avisa = porVencer(situacion, hoy);

  return (
    <>
      <tr
        className={`border-t border-[#E5E7EB] cursor-pointer hover:bg-[#FAFAF9] ${
          situacion.relacionCerrada ? 'opacity-60' : ''
        }`}
        onClick={onToggle}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {abierto ? (
              <ChevronDown className="h-4 w-4 text-[#9CA3AF]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[#9CA3AF]" />
            )}
            <span className="font-medium text-[#1A1A1A]">{sujeto.nombre}</span>
            {situacion.relacionCerrada && (
              <span className="text-xs text-[#9CA3AF]">(relación cerrada)</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-[#6B7280]">{TIPO_SUJETO_LABEL[sujeto.tipo]}</td>
        <td className="px-3 py-2 text-[#6B7280]">
          {sujeto.documento_tipo} {sujeto.documento_numero}
        </td>
        <td className="px-3 py-2">
          <span className={`px-2 py-0.5 rounded border text-xs ${CHIP[situacion.estado]}`}>
            {ESTADO_SUJETO_LABEL[situacion.estado]}
          </span>
        </td>
        <td className="px-3 py-2 text-[#6B7280]">
          {situacion.venceEl ? (
            <span className={avisa ? 'text-[#B45309] font-medium' : ''}>
              hasta {situacion.venceEl}
            </span>
          ) : (
            <span className="text-[#9CA3AF]">sin fecha</span>
          )}
        </td>
      </tr>

      {abierto && (
        <tr className="border-t border-[#E5E7EB] bg-[#FAFAF9]">
          <td colSpan={5} className="px-4 py-4">
            <Detalle
              sujeto={sujeto}
              esOficial={esOficial}
              puedeGestionar={puedeGestionar}
              segmentos={segmentos}
              onCerrar={onCerrar}
              onReabrir={onReabrir}
              onActualizar={onActualizar}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function Detalle({
  sujeto,
  esOficial,
  puedeGestionar,
  segmentos,
  onCerrar,
  onReabrir,
  onActualizar,
}: {
  sujeto: FilaSujeto;
  esOficial: boolean;
  puedeGestionar: boolean;
  segmentos: Segmento[];
  onCerrar: (fecha: string, motivo: string) => void;
  onReabrir: (fecha: string, motivo: string) => void;
  onActualizar: (patch: { tipo?: string; segmento_id?: string | null; notas?: string | null }) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [fecha, setFecha] = useState('');
  const [historial, setHistorial] = useState<EventoSujeto[] | null>(null);
  const [cargandoHist, setCargandoHist] = useState(false);
  const { situacion } = sujeto;

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-white border border-[#E5E7EB]">
        <div className="text-sm font-medium text-[#1A1A1A]">
          {ESTADO_SUJETO_ACCION[situacion.estado]}
        </div>
        <div className="text-xs text-[#6B7280] mt-1">
          {situacion.fuente === 'liberacion' &&
            'El estado viene de una decisión del oficial de cumplimiento. '}
          {situacion.fuente === 'consulta' &&
            'El estado viene de la última consulta a listas, que salió sin hallazgo. '}
          {situacion.fuente === null &&
            'Nadie ha consultado a este sujeto contra listas restrictivas. '}
          Vinculado desde {sujeto.relacion_desde}.
          {sujeto.relacion_hasta && ` Relación cerrada el ${sujeto.relacion_hasta}.`}
          {sujeto.motivo_cierre && ` Motivo: ${sujeto.motivo_cierre}`}
        </div>
        {sujeto.responsable_nombre && (
          <div className="text-xs text-[#6B7280] mt-1">
            Responsable: {sujeto.responsable_nombre}
          </div>
        )}
        {sujeto.segmento_nombre && (
          <div className="text-xs text-[#6B7280]">Segmento: {sujeto.segmento_nombre}</div>
        )}
      </div>

      {esOficial && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[#6B7280]">
            Segmento de consulta
            <select
              defaultValue={sujeto.segmento_id ?? ''}
              onChange={(e) => onActualizar({ segmento_id: e.target.value || null })}
              className="block mt-1 px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
            >
              <option value="">Sin segmento</option>
              {segmentos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#6B7280]">
            Tipo
            <select
              defaultValue={sujeto.tipo}
              onChange={(e) => onActualizar({ tipo: e.target.value })}
              className="block mt-1 px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
            >
              {TIPOS_SUJETO.map((t) => (
                <option key={t} value={t}>
                  {TIPO_SUJETO_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {puedeGestionar && !situacion.relacionCerrada && (
        <div className="p-3 rounded-lg bg-white border border-[#E5E7EB] space-y-2">
          <div className="text-sm font-medium text-[#1A1A1A]">Terminar la relación</div>
          <p className="text-xs text-[#6B7280]">
            Úsalo cuando deje de trabajar con la compañía. No lo inhabilita ni borra su historial.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
            />
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué termina (queda en la bitácora)"
              className="flex-1 min-w-[220px] px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
            />
            <button
              disabled={motivo.trim().length === 0}
              onClick={() => onCerrar(fecha, motivo)}
              className="px-3 py-1.5 rounded bg-[#1A1A1A] text-white text-sm disabled:opacity-40"
            >
              Cerrar relación
            </button>
          </div>
        </div>
      )}

      {puedeGestionar && situacion.relacionCerrada && (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
          />
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por qué se reabre (opcional)"
            className="flex-1 min-w-[200px] px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
          />
          <button
            onClick={() => onReabrir(fecha, motivo)}
            className="px-3 py-1.5 rounded border border-[#E5E7EB] text-sm hover:bg-[#F5F4F2]"
          >
            Reabrir relación
          </button>
        </div>
      )}

      <div>
        {historial === null ? (
          <button
            onClick={async () => {
              setCargandoHist(true);
              const r = await historialSujeto(sujeto.id);
              setHistorial(r.ok ? r.data : []);
              setCargandoHist(false);
            }}
            className="text-sm text-[#6B7280] underline"
          >
            {cargandoHist ? 'Cargando...' : 'Ver historial de la ficha'}
          </button>
        ) : historial.length === 0 ? (
          <div className="text-xs text-[#9CA3AF]">Sin eventos registrados.</div>
        ) : (
          <ul className="space-y-1">
            {historial.map((e) => (
              <li key={e.id} className="text-xs text-[#6B7280]">
                <span className="font-medium text-[#1A1A1A]">{e.evento}</span>{' '}
                {e.detalle && <>{e.detalle}. </>}
                {e.motivo && <>Motivo: {e.motivo}. </>}
                {e.actor_nombre && <>Por {e.actor_nombre}. </>}
                {e.created_at.slice(0, 10)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FormNuevo({
  segmentos,
  onCancelar,
  onCrear,
}: {
  segmentos: Segmento[];
  onCancelar: () => void;
  onCrear: (input: {
    tipo: string;
    documento_tipo: string;
    documento_numero: string;
    nombre: string;
    staff_id?: string | null;
    segmento_id?: string | null;
  }) => void;
}) {
  const [tipo, setTipo] = useState<string>('proveedor');
  const [documentoTipo, setDocumentoTipo] = useState('NIT');
  const [documentoNumero, setDocumentoNumero] = useState('');
  const [nombre, setNombre] = useState('');
  const [segmentoId, setSegmentoId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [staff, setStaff] = useState<StaffLibre[] | null>(null);

  // Empleados: la ficha de personal manda. Se carga solo cuando hace falta para
  // no pedir la lista de nómina en cada alta de proveedor.
  async function cargarStaff() {
    if (staff !== null) return;
    const r = await listarStaffSinSujeto();
    setStaff(r.ok ? r.data : []);
  }

  return (
    <div className="p-4 rounded-lg border border-[#E5E7EB] bg-white space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-[#6B7280]">
          Tipo
          <select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value);
              if (e.target.value === 'empleado') void cargarStaff();
            }}
            className="block mt-1 px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
          >
            {TIPOS_SUJETO.map((t) => (
              <option key={t} value={t}>
                {TIPO_SUJETO_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        {tipo === 'empleado' && (
          <label className="text-xs text-[#6B7280]">
            Persona de la nómina
            <select
              value={staffId}
              onChange={(e) => {
                setStaffId(e.target.value);
                const p = staff?.find((s) => s.id === e.target.value);
                if (p) setNombre(p.full_name);
              }}
              className="block mt-1 px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
            >
              <option value="">Elegir...</option>
              {(staff ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                  {s.position ? ` — ${s.position}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="text-xs text-[#6B7280]">
          Documento
          <div className="flex gap-1 mt-1">
            <select
              value={documentoTipo}
              onChange={(e) => setDocumentoTipo(e.target.value)}
              className="px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
            >
              <option value="NIT">NIT</option>
              <option value="CC">CC</option>
              <option value="CE">CE</option>
              <option value="PAS">PAS</option>
            </select>
            <input
              value={documentoNumero}
              onChange={(e) => setDocumentoNumero(e.target.value)}
              placeholder="900123456"
              className="px-2 py-1.5 rounded border border-[#E5E7EB] text-sm w-40"
            />
          </div>
        </label>

        <label className="text-xs text-[#6B7280] flex-1 min-w-[200px]">
          Nombre o razón social
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="block w-full mt-1 px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
          />
        </label>

        <label className="text-xs text-[#6B7280]">
          Segmento
          <select
            value={segmentoId}
            onChange={(e) => setSegmentoId(e.target.value)}
            className="block mt-1 px-2 py-1.5 rounded border border-[#E5E7EB] text-sm"
          >
            <option value="">Sin segmento</option>
            {segmentos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-[#9CA3AF]">
        Agregarlo aquí no lo consulta. Aparecerá como <strong>sin consultar</strong> hasta que se
        corra la consulta a listas con su documento.
      </p>

      <div className="flex gap-2">
        <button
          disabled={nombre.trim().length < 2 || documentoNumero.trim().length === 0}
          onClick={() =>
            onCrear({
              tipo,
              documento_tipo: documentoTipo,
              documento_numero: documentoNumero,
              nombre,
              staff_id: tipo === 'empleado' ? staffId || null : null,
              segmento_id: segmentoId || null,
            })
          }
          className="px-3 py-1.5 rounded bg-[#1A1A1A] text-white text-sm disabled:opacity-40"
        >
          Agregar
        </button>
        <button
          onClick={onCancelar}
          className="px-3 py-1.5 rounded border border-[#E5E7EB] text-sm hover:bg-[#F5F4F2]"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
