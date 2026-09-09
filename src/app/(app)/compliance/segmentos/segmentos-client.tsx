'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Check, Plus, Tags, Trash2, X } from 'lucide-react';
import {
  actualizarSegmento,
  crearSegmento,
  eliminarSegmento,
  listarSegmentos,
} from '@/lib/actions/compliance-segmentos';
import type { ComplianceSegmento } from '@/lib/compliance/segmentos';
import {
  UNIVERSOS_SEGMENTACION,
  UNIVERSO_LABEL,
  type UniversoSegmentacion,
} from '@/lib/valida/segmentacion-presets';

export default function SegmentosClient({ inicial }: { inicial: ComplianceSegmento[] }) {
  const [segmentos, setSegmentos] = useState<ComplianceSegmento[]>(inicial);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoUniverso, setNuevoUniverso] = useState<UniversoSegmentacion>('contraparte');

  async function recargar() {
    const r = await listarSegmentos({ incluirInactivos: true });
    if (r.ok) setSegmentos(r.data);
    else setError(r.error);
  }

  function agregar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);

    const nombre = nuevoNombre.trim();
    if (!nombre) {
      setError('Ponle un nombre al segmento.');
      return;
    }

    startTransition(async () => {
      const r = await crearSegmento({ nombre, universo: nuevoUniverso });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNuevoNombre('');
      setAviso(`Segmento "${r.data.nombre}" creado.`);
      await recargar();
    });
  }

  function guardar(id: string, patch: Partial<ComplianceSegmento>) {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const r = await actualizarSegmento({ id, ...patch });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      await recargar();
    });
  }

  function borrar(seg: ComplianceSegmento) {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const r = await eliminarSegmento(seg.id);
      if (!r.ok) {
        // El caso normal es `segmento_en_uso`: borrar destruiria la trazabilidad
        // de por que se consulto a esa contraparte. El mensaje del server dice
        // cuantas consultas lo referencian y ofrece desactivarlo.
        setError(r.error);
        return;
      }
      setAviso(`Segmento "${seg.nombre}" eliminado.`);
      await recargar();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Tags className="h-6 w-6 text-tinta" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-tinta">Catálogo de segmentos</h1>
          <p className="text-sm text-tinta-suave">
            Las poblaciones que tu organización consulta en listas restrictivas. Cada consulta
            queda etiquetada con una, y por eso después se pueden volver a consultar en masa.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-tinta">Agregar segmento</h2>
          <p className="text-sm text-tinta-suave mt-1">
            El <strong>universo</strong> es el eje de tu metodología de segmentación SARLAFT:
            contrapartes y empleados se califican con pesos y umbrales distintos. El segmento es
            la etiqueta operativa que cuelga de él — &ldquo;Proveedor&rdquo;, &ldquo;Accionista&rdquo; y
            &ldquo;Aliado&rdquo; son todos del universo contrapartes.
          </p>
        </div>

        <form onSubmit={agregar} className="grid grid-cols-1 sm:grid-cols-[1fr_220px_auto] gap-3">
          <div>
            <label
              htmlFor="nuevo-segmento-nombre"
              className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1.5"
            >
              Nombre
            </label>
            <input
              id="nuevo-segmento-nombre"
              type="text"
              value={nuevoNombre}
              onChange={e => setNuevoNombre(e.target.value)}
              placeholder="Contraparte"
              maxLength={80}
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta"
            />
          </div>
          <div>
            <label
              htmlFor="nuevo-segmento-universo"
              className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1.5"
            >
              Universo
            </label>
            <select
              id="nuevo-segmento-universo"
              value={nuevoUniverso}
              onChange={e => setNuevoUniverso(e.target.value as UniversoSegmentacion)}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta bg-white text-sm"
            >
              {UNIVERSOS_SEGMENTACION.map(u => (
                <option key={u} value={u}>
                  {UNIVERSO_LABEL[u]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={pending || nuevoNombre.trim().length === 0}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-tinta text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="h-4 w-4" />
              Agregar
            </button>
          </div>
        </form>

        {error && (
          <div className="p-3 rounded-lg bg-alerta/10 border border-alerta/30 text-[#B91C1C] text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {aviso && (
          <div className="p-3 rounded-lg bg-[var(--acento-tinte)] border border-acento/30 text-acento text-sm flex items-center gap-2">
            <Check className="h-4 w-4" /> {aviso}
          </div>
        )}
      </div>

      {segmentos.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-8 text-center text-sm text-tinta-suave">
          Todavía no hay segmentos. Sin al menos uno, el equipo no puede consultar listas.
        </div>
      ) : (
        <TablaSegmentos
          segmentos={segmentos}
          pending={pending}
          onGuardar={guardar}
          onBorrar={borrar}
        />
      )}
    </div>
  );
}

function TablaSegmentos({
  segmentos,
  pending,
  onGuardar,
  onBorrar,
}: {
  segmentos: ComplianceSegmento[];
  pending: boolean;
  onGuardar: (id: string, patch: Partial<ComplianceSegmento>) => void;
  onBorrar: (seg: ComplianceSegmento) => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState('');

  function empezarEdicion(seg: ComplianceSegmento) {
    setEditando(seg.id);
    setBorrador(seg.nombre);
  }

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-papel border-b border-[#E5E7EB]">
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Segmento
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Universo
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Orden
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Estado
              </th>
              <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {segmentos.map(seg => (
              <tr key={seg.id} className="border-b border-[#E5E7EB] last:border-0">
                <td className="px-4 py-2.5">
                  {editando === seg.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={borrador}
                        onChange={e => setBorrador(e.target.value)}
                        maxLength={80}
                        aria-label={`Nuevo nombre para ${seg.nombre}`}
                        className="h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta text-sm"
                      />
                      <button
                        type="button"
                        disabled={pending || borrador.trim().length === 0}
                        onClick={() => {
                          onGuardar(seg.id, { nombre: borrador.trim() });
                          setEditando(null);
                        }}
                        title="Guardar nombre"
                        className="text-acento hover:text-acento-hover disabled:text-[#9CA3AF]"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditando(null)}
                        title="Cancelar"
                        className="text-tinta-suave hover:text-tinta"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => empezarEdicion(seg)}
                      className="font-medium text-tinta hover:underline"
                    >
                      {seg.nombre}
                    </button>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <select
                    value={seg.universo}
                    disabled={pending}
                    aria-label={`Universo de ${seg.nombre}`}
                    onChange={e =>
                      onGuardar(seg.id, { universo: e.target.value as UniversoSegmentacion })
                    }
                    className="h-9 px-2 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta bg-white text-sm"
                  >
                    {UNIVERSOS_SEGMENTACION.map(u => (
                      <option key={u} value={u}>
                        {UNIVERSO_LABEL[u]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <input
                    type="number"
                    defaultValue={seg.orden}
                    disabled={pending}
                    aria-label={`Orden de ${seg.nombre}`}
                    onBlur={e => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== seg.orden) onGuardar(seg.id, { orden: v });
                    }}
                    className="h-9 w-20 px-2 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta text-sm text-center"
                  />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onGuardar(seg.id, { activo: !seg.activo })}
                    title={
                      seg.activo
                        ? 'Desactivar: deja de ofrecerse en consultas nuevas, el historial no se toca'
                        : 'Reactivar'
                    }
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider transition-colors ${
                      seg.activo
                        ? 'bg-acento text-white hover:bg-acento-hover'
                        : 'bg-[#E5E7EB] text-tinta-suave hover:bg-[#D1D5DB]'
                    }`}
                  >
                    {seg.activo ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onBorrar(seg)}
                    title="Eliminar (solo si ninguna consulta lo usa)"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#B91C1C] hover:text-[#7F1D1D] disabled:text-[#9CA3AF]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-tinta-suave border-t border-[#E5E7EB]">
        Un segmento que ya tiene consultas no se puede eliminar: se desactiva. Así el historial
        conserva por qué se consultó a cada contraparte.
      </p>
    </div>
  );
}
