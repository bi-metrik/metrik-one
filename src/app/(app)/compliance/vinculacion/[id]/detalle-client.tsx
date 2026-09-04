'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  FileText,
  Loader2,
  Quote,
  X,
} from 'lucide-react';
import {
  decidirVinculacion,
  detalleVinculacion,
  type DetalleVinculacion,
} from '@/lib/actions/compliance-vinculacion';
import {
  CONFIDENCE_LABEL,
  ESTADO_EXPEDIENTE_ACCION,
  ESTADO_EXPEDIENTE_LABEL,
  ETAPAS,
  ETAPA_LABEL,
  EXTRACCION_LABEL,
  ORIGEN_LABEL,
  agruparCamposPorDocumento,
  etiquetaCampo,
  etiquetaSlot,
  mostrarValor,
  nombreContraparte,
  progresoEtapa,
  puedeDecidirse,
  razonNoDecidible,
  slotsFaltantes,
  validarMotivoRechazo,
  type ConfidenceEstado,
  type EstadoExtraccion,
} from '@/lib/compliance/vinculacion';

const CHIP_CONFIDENCE: Record<ConfidenceEstado, string> = {
  extraido: 'bg-[#ECFDF5] text-[#059669] border-[#10B981]/30',
  requiere_confirmacion: 'bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30',
  manual_obligatorio: 'bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]',
};

const CHIP_EXTRACCION: Record<EstadoExtraccion, string> = {
  ok: 'bg-[#ECFDF5] text-[#059669] border-[#10B981]/30',
  pendiente: 'bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30',
  failed: 'bg-[#EF4444]/10 text-[#B91C1C] border-[#EF4444]/30',
  no_key: 'bg-[#EF4444]/10 text-[#B91C1C] border-[#EF4444]/30',
};

function fecha(iso: string | null): string {
  if (!iso) return 'sin fecha';
  return new Date(iso).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function DetalleClient({ inicial }: { inicial: DetalleVinculacion }) {
  const [d, setD] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const exp = d.expediente;
  const grupos = agruparCamposPorDocumento(d.campos, d.documentos);
  const faltantes = slotsFaltantes(d.kit, d.documentos);
  const decidible = puedeDecidirse(exp.estado);
  const razon = razonNoDecidible(exp.estado);
  const errMotivo = rechazando ? validarMotivoRechazo(motivo) : null;
  const { paso, total } = progresoEtapa(exp.etapa_actual);

  function decidir(decision: 'aprobado' | 'rechazado') {
    startTransition(async () => {
      setError(null);
      setAviso(null);
      const r = await decidirVinculacion({
        expedienteId: exp.expediente_id,
        decision,
        motivo: decision === 'rechazado' ? motivo : undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const rec = await detalleVinculacion(exp.expediente_id);
      if (rec.ok) setD(rec.data);
      setRechazando(false);
      setMotivo('');
      setAviso(decision === 'aprobado' ? 'Contraparte vinculada.' : 'Vinculación rechazada.');
    });
  }

  return (
    <div className="p-6 max-w-4xl">
      <Link
        href="/compliance/vinculacion"
        className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] mb-4"
      >
        <ChevronLeft className="w-4 h-4" /> Volver a la bandeja
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[#1A1A1A] truncate">{nombreContraparte(exp)}</h1>
          <p className="text-sm text-[#6B7280] mt-0.5">
            {exp.documento_tipo && exp.documento_numero
              ? `${exp.documento_tipo} ${exp.documento_numero} · `
              : ''}
            {exp.tipo_sujeto === 'juridica' ? 'Persona jurídica' : 'Persona natural'}
            {exp.email_contraparte ? ` · ${exp.email_contraparte}` : ''}
          </p>
        </div>
        {pending && <Loader2 className="w-4 h-4 animate-spin text-[#6B7280] mt-1 shrink-0" />}
      </div>

      <div className="mt-4 rounded-lg border border-[#E5E7EB] p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm font-semibold text-[#1A1A1A]">
            {ESTADO_EXPEDIENTE_LABEL[exp.estado] ?? exp.estado}
          </p>
          <p className="text-xs text-[#6B7280]">
            Etapa {paso} de {total}: {ETAPA_LABEL[exp.etapa_actual] ?? exp.etapa_actual}
          </p>
        </div>
        <p className="text-xs text-[#6B7280]">{ESTADO_EXPEDIENTE_ACCION[exp.estado]}</p>
        <div className="mt-3 flex gap-1">
          {ETAPAS.map((e, i) => (
            <div
              key={e}
              title={ETAPA_LABEL[e]}
              className={`h-1.5 flex-1 rounded-full ${
                i < paso ? 'bg-[#1A1A1A]' : 'bg-[#E5E7EB]'
              }`}
            />
          ))}
        </div>
        {exp.data_retention_until && (
          <p className="text-[11px] text-[#9CA3AF] mt-3">
            El expediente se conserva hasta el {fecha(exp.data_retention_until)}.
          </p>
        )}
      </div>

      {d.alertas.length > 0 && (
        <div className="mt-4 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#B45309] mt-0.5 shrink-0" />
            <div className="text-sm text-[#B45309]">
              <p className="font-semibold">Antes de decidir, mira esto.</p>
              <ul className="mt-1.5 space-y-1">
                {d.alertas.map((a) => (
                  <li key={a.clave}>{a.texto}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Documentos ── */}
      <h2 className="text-base font-bold text-[#1A1A1A] mt-6 mb-2">Documentos</h2>
      {d.documentos.length === 0 ? (
        <p className="text-sm text-[#6B7280]">La contraparte todavía no ha subido nada.</p>
      ) : (
        <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
          {d.documentos.map((doc, i) => (
            <div
              key={doc.doc_id}
              className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-[#F3F4F6]' : ''}`}
            >
              <FileText className="w-4 h-4 text-[#9CA3AF] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[#1A1A1A]">{etiquetaSlot(doc.slot)}</p>
                <p className="text-xs text-[#6B7280]">Subido el {fecha(doc.subido_en)}</p>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold shrink-0 ${
                  CHIP_EXTRACCION[doc.estado_extraccion ?? 'pendiente']
                }`}
              >
                {EXTRACCION_LABEL[doc.estado_extraccion ?? 'pendiente']}
              </span>
            </div>
          ))}
        </div>
      )}
      {faltantes.length > 0 && (
        <p className="text-xs text-[#B45309] mt-2">
          Falta subir: {faltantes.map((s) => etiquetaSlot(s)).join(', ')}.
        </p>
      )}

      {/* ── Campos ── */}
      <h2 className="text-base font-bold text-[#1A1A1A] mt-6 mb-1">Lo que dicen los documentos</h2>
      <p className="text-xs text-[#6B7280] mb-3">
        Cada dato muestra de dónde salió. Si un documento no se pudo leer, sus campos no aparecen
        acá: eso no quiere decir que vinieran vacíos.
      </p>
      {grupos.length === 0 ? (
        <p className="text-sm text-[#6B7280]">Todavía no hay datos extraídos.</p>
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <div key={g.docId ?? 'sueltos'} className="rounded-lg border border-[#E5E7EB]">
              <p className="px-4 py-2 text-xs font-semibold text-[#4B5563] bg-[#F9FAFB] border-b border-[#E5E7EB]">
                {g.titulo}
              </p>
              <div>
                {g.campos.map((c, i) => (
                  <div key={c.campo_id} className={`px-4 py-3 ${i > 0 ? 'border-t border-[#F3F4F6]' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-[#6B7280]">{etiquetaCampo(c.slug)}</p>
                        <p className="text-sm text-[#1A1A1A] break-words">
                          {mostrarValor(c.value) || (
                            <span className="text-[#9CA3AF] italic">
                              {c.reason_if_null ?? 'sin dato'}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {c.confidence_estado && (
                          <span
                            className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${CHIP_CONFIDENCE[c.confidence_estado]}`}
                          >
                            {CONFIDENCE_LABEL[c.confidence_estado]}
                          </span>
                        )}
                        <span className="text-[11px] text-[#9CA3AF]">{ORIGEN_LABEL[c.origen]}</span>
                        {c.confidence_estado === 'requiere_confirmacion' && (
                          <span className="text-[11px] font-semibold text-[#B45309]">
                            {c.confirmado_contraparte ? 'Confirmado' : 'Sin confirmar'}
                          </span>
                        )}
                      </div>
                    </div>
                    {c.evidencia && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[#6B7280] italic">
                        <Quote className="w-3 h-3 mt-0.5 shrink-0" />
                        <span className="break-words">{c.evidencia}</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── La decisión ── */}
      <h2 className="text-base font-bold text-[#1A1A1A] mt-6 mb-2">Decisión</h2>

      {exp.decision_oc ? (
        <div className="rounded-lg border border-[#E5E7EB] p-4 text-sm">
          <p className="font-semibold text-[#1A1A1A]">
            {ESTADO_EXPEDIENTE_LABEL[exp.estado] ?? exp.estado} el {fecha(exp.fecha_cierre)}
          </p>
          {typeof exp.decision_oc.motivo === 'string' && exp.decision_oc.motivo.length > 0 && (
            <p className="text-[#6B7280] mt-1">{exp.decision_oc.motivo}</p>
          )}
          <p className="text-xs text-[#9CA3AF] mt-2">
            La decisión no se reescribe. Si cambian las circunstancias, se abre una vinculación
            nueva.
          </p>
        </div>
      ) : !decidible ? (
        <p className="text-sm text-[#6B7280]">{razon}</p>
      ) : !d.puedeDecidir ? (
        <p className="text-sm text-[#6B7280]">Solo el oficial de cumplimiento decide.</p>
      ) : (
        <div className="rounded-lg border border-[#E5E7EB] p-4">
          {!rechazando ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => decidir('aprobado')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1A1A1A] text-white text-sm font-semibold disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> Aprobar la vinculación
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setRechazando(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#EF4444]/40 text-[#B91C1C] text-sm font-semibold disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Rechazar
              </button>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-[#4B5563] mb-1">
                Por qué se rechaza
              </label>
              <textarea
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
                rows={3}
                placeholder="Queda en el expediente. Es lo que va a leer quien revise esto después."
                className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
              />
              {errMotivo && <p className="text-xs text-[#B91C1C] mt-1">{errMotivo}</p>}
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  disabled={pending || errMotivo !== null}
                  onClick={() => decidir('rechazado')}
                  className="px-4 py-2 rounded-lg bg-[#B91C1C] text-white text-sm font-semibold disabled:opacity-50"
                >
                  Confirmar rechazo
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setRechazando(false);
                    setMotivo('');
                  }}
                  className="px-4 py-2 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#4B5563]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-[#B91C1C] mt-3">{error}</p>}
      {aviso && <p className="text-sm text-[#059669] mt-3">{aviso}</p>}
    </div>
  );
}
