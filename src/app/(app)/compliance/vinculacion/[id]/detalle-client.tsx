'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronLeft,
  FileText,
  Loader2,
  Quote,
  ShieldAlert,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import {
  decidirVinculacion,
  detalleVinculacion,
  type DetalleVinculacion,
} from '@/lib/actions/compliance-vinculacion';
import {
  CONFIDENCE_LABEL,
  CONSTANCIA_SIN_LECTURA,
  ESTADO_EXPEDIENTE_ACCION,
  ESTADO_EXPEDIENTE_LABEL,
  ETAPAS,
  ETAPA_LABEL,
  EXTRACCION_LABEL,
  ORIGEN_LABEL,
  agruparCamposPorDocumento,
  etiquetaCampo,
  etiquetaParada,
  etiquetaSlot,
  llegoElArchivo,
  faltantesPorSocio,
  exigeConstanciaSinLectura,
  mostrarValor,
  nombreContraparte,
  progresoEtapa,
  puedeDecidirse,
  razonNoDecidible,
  resumirIntegridad,
  selloImpideAprobar,
  slotsFaltantes,
  validarMotivoRechazo,
  type ConfidenceEstado,
  type EstadoExtraccion,
} from '@/lib/compliance/vinculacion';
import { UMBRAL_BF, fraseFalta, textoParticipacion } from '@/lib/compliance/vinculacion-publica';

const CHIP_CONFIDENCE: Record<ConfidenceEstado, string> = {
  extraido: 'bg-[var(--acento-tinte)] text-acento border-acento/30',
  requiere_confirmacion: 'bg-advertencia/10 text-[#B45309] border-advertencia/30',
  manual_obligatorio: 'bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]',
};

/**
 * El sello tiene tres tonos y ninguno es decorativo: `ok` confirma, `alerta`
 * dice que no se pudo comprobar, `grave` dice que el contenido cambió después
 * de la firma. Si los tres se pintaran igual, el tercero se perdería entre los
 * otros dos justo el día que aparezca.
 */
const CAJA_INTEGRIDAD: Record<'ok' | 'alerta' | 'grave', string> = {
  ok: 'border-acento/30 bg-[var(--acento-tinte)] text-[var(--acento)]',
  alerta: 'border-advertencia/30 bg-advertencia/5 text-[#B45309]',
  grave: 'border-alerta/40 bg-alerta/5 text-[#B91C1C]',
};

const CHIP_EXTRACCION: Record<EstadoExtraccion, string> = {
  ok: 'bg-[var(--acento-tinte)] text-acento border-acento/30',
  pendiente: 'bg-advertencia/10 text-[#B45309] border-advertencia/30',
  failed: 'bg-alerta/10 text-[#B91C1C] border-alerta/30',
  no_key: 'bg-alerta/10 text-[#B91C1C] border-alerta/30',
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
  const [constancia, setConstancia] = useState(false);

  const exp = d.expediente;
  const grupos = agruparCamposPorDocumento(d.campos, d.documentos);
  // Los soportes de la cadena no son casilleros del kit: se listan con su
  // socio, donde la pregunta que importa es "a cuál le falta el suyo".
  const docsDelKit = d.documentos.filter((doc) => !doc.persona_id);
  const faltantes = slotsFaltantes(d.kit, docsDelKit);
  const socios = d.expediente.socios ?? [];
  const cadena = d.expediente.cadena ?? null;
  const faltaEn = faltantesPorSocio(cadena);
  const decidible = puedeDecidirse(exp.estado);
  const razon = razonNoDecidible(exp.estado);
  const errMotivo = rechazando ? validarMotivoRechazo(motivo) : null;
  // Aprobar un expediente al que le falta algo se permite: el criterio es del
  // oficial. Lo que no se permite es que después no se sepa que fue así.
  const exigeConstancia = exigeConstanciaSinLectura(d.alertas);
  const sello = resumirIntegridad(d.integridad ?? null);
  // Rechazar sigue habilitado a propósito: un expediente alterado es
  // justamente uno que puede haber que rechazar.
  const selloBloquea = selloImpideAprobar(d.integridad ?? null);
  const { paso, total } = progresoEtapa(exp.etapa_actual);

  function decidir(decision: 'aprobado' | 'rechazado') {
    startTransition(async () => {
      setError(null);
      setAviso(null);
      const r = await decidirVinculacion({
        expedienteId: exp.expediente_id,
        decision,
        motivo: decision === 'rechazado' ? motivo : undefined,
        sinLectura: decision === 'aprobado' ? constancia : undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const rec = await detalleVinculacion(exp.expediente_id);
      if (rec.ok) setD(rec.data);
      setRechazando(false);
      setMotivo('');
      setConstancia(false);
      setAviso(decision === 'aprobado' ? 'Contraparte vinculada.' : 'Vinculación rechazada.');
    });
  }

  return (
    <div className="p-6 max-w-4xl">
      <Link
        href="/compliance/vinculacion"
        className="inline-flex items-center gap-1 text-sm text-tinta-suave hover:text-tinta mb-4"
      >
        <ChevronLeft className="w-4 h-4" /> Volver a la bandeja
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-tinta truncate">{nombreContraparte(exp)}</h1>
          <p className="text-sm text-tinta-suave mt-0.5">
            {exp.documento_tipo && exp.documento_numero
              ? `${exp.documento_tipo} ${exp.documento_numero} · `
              : ''}
            {exp.tipo_sujeto === 'juridica' ? 'Persona jurídica' : 'Persona natural'}
            {exp.email_contraparte ? ` · ${exp.email_contraparte}` : ''}
          </p>
        </div>
        {pending && <Loader2 className="w-4 h-4 animate-spin text-tinta-suave mt-1 shrink-0" />}
      </div>

      <div className="mt-4 rounded-lg border border-[#E5E7EB] p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm font-semibold text-tinta">
            {ESTADO_EXPEDIENTE_LABEL[exp.estado] ?? exp.estado}
          </p>
          <p className="text-xs text-tinta-suave">
            Etapa {paso} de {total}: {ETAPA_LABEL[exp.etapa_actual] ?? exp.etapa_actual}
          </p>
        </div>
        <p className="text-xs text-tinta-suave">{ESTADO_EXPEDIENTE_ACCION[exp.estado]}</p>
        <div className="mt-3 flex gap-1">
          {ETAPAS.map((e, i) => (
            <div
              key={e}
              title={ETAPA_LABEL[e]}
              className={`h-1.5 flex-1 rounded-full ${
                i < paso ? 'bg-tinta' : 'bg-[#E5E7EB]'
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

      {sello && (
        <div className={`mt-4 rounded-lg border p-4 ${CAJA_INTEGRIDAD[sello.tono]}`}>
          <div className="flex items-start gap-2">
            {sello.tono === 'ok' ? (
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <div className="text-sm">
              <p className="font-semibold">{sello.titulo}</p>
              <p className="mt-1 text-[13px] leading-snug">{sello.detalle}</p>
              {d.integridad?.firmado_en && (
                <p className="mt-1.5 text-[11px] opacity-80">
                  Firmado el {fecha(d.integridad.firmado_en)}
                  {d.integridad.hash_sellado
                    ? ` · sello ${d.integridad.hash_sellado.slice(0, 12)}…`
                    : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {d.alertas.length > 0 && (
        <div className="mt-4 rounded-lg border border-advertencia/30 bg-advertencia/5 p-4">
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
      <h2 className="text-base font-bold text-tinta mt-6 mb-2">Documentos</h2>
      {docsDelKit.length === 0 ? (
        <p className="text-sm text-tinta-suave">La contraparte todavía no ha subido nada.</p>
      ) : (
        <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
          {docsDelKit.map((doc, i) => (
            <div
              key={doc.doc_id}
              className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-[#F3F4F6]' : ''}`}
            >
              <FileText className="w-4 h-4 text-[#9CA3AF] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-tinta">{etiquetaSlot(doc.slot)}</p>
                <p className="text-xs text-tinta-suave">
                  {llegoElArchivo(doc)
                    ? `Subido el ${fecha(doc.subido_en)}`
                    : `Se intentó el ${fecha(doc.subido_en)}, pero el archivo no llegó`}
                </p>
              </div>
              {/* Se deja la fila a la vista: que la contraparte lo haya
                  intentado y se le haya cortado la subida es distinto de que
                  nunca lo haya intentado, y el casillero aparece igual en
                  "Falta subir". */}
              <span
                className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold shrink-0 ${
                  llegoElArchivo(doc)
                    ? CHIP_EXTRACCION[doc.estado_extraccion ?? 'pendiente']
                    : 'bg-alerta/10 text-[#B91C1C] border-alerta/30'
                }`}
              >
                {llegoElArchivo(doc)
                  ? EXTRACCION_LABEL[doc.estado_extraccion ?? 'pendiente']
                  : 'sin archivo'}
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

      {/* ── La cadena ── */}
      {socios.length > 0 && (
        <>
          <h2 className="text-base font-bold text-tinta mt-6 mb-1">Quién está detrás</h2>
          <p className="text-xs text-tinta-suave mb-3">
            Los porcentajes se multiplican a lo largo de la cadena. El umbral de {UMBRAL_BF}% se
            mide sobre esa participación efectiva, no sobre la del eslabón.
          </p>
          <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
            {socios.map((soc, i) => {
              const falta = faltaEn.get(soc.persona_id) ?? [];
              const parada = etiquetaParada(soc.motivo_parada);
              return (
                <div
                  key={soc.persona_id}
                  className={`px-4 py-3 ${i > 0 ? 'border-t border-[#F3F4F6]' : ''}`}
                  style={{ paddingLeft: 16 + soc.nivel * 20 }}
                >
                  <div className="flex items-center gap-2">
                    {soc.tipo_sujeto === 'juridica' ? (
                      <Building2 className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    ) : (
                      <User className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    )}
                    <p className="text-sm text-tinta min-w-0 flex-1 truncate">
                      {soc.nombre}
                      {soc.documento_numero && (
                        <span className="text-xs text-tinta-suave">
                          {' '}
                          · {soc.documento_tipo ?? ''} {soc.documento_numero}
                        </span>
                      )}
                    </p>
                    <span className="text-xs text-[#4B5563] shrink-0">
                      {textoParticipacion(soc)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 pl-6">
                    {soc.tipo_sujeto === 'juridica' && !parada && (
                      <span
                        className={`text-[11px] ${soc.tiene_soporte ? 'text-acento' : 'text-[#B45309]'}`}
                      >
                        {soc.tiene_soporte ? 'Con soporte' : 'Sin soporte'}
                      </span>
                    )}
                    {parada && <span className="text-[11px] text-[#B45309]">{parada}</span>}
                    {falta.map((f) => (
                      <span key={f} className="text-[11px] text-[#B91C1C]">
                        {fraseFalta(f as Parameters<typeof fraseFalta>[0])}
                      </span>
                    ))}
                  </div>
                  {soc.parada_justificacion && (
                    <p className="text-xs text-tinta-suave mt-1 pl-6 italic">
                      &ldquo;{soc.parada_justificacion}&rdquo;
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {cadena && cadena.beneficiarios.length > 0 && (
            <p className="text-xs text-[#4B5563] mt-2">
              Beneficiarios finales:{' '}
              {cadena.beneficiarios
                .map((b) => `${b.nombre}${b.documento_numero ? ` (${b.documento_numero})` : ''}`)
                .join(', ')}
              .
            </p>
          )}
          {cadena && cadena.beneficiarios.length === 0 && cadena.completa && (
            <p className="text-xs text-tinta-suave mt-2">
              Ningún socio llega al {UMBRAL_BF}% de participación efectiva.
            </p>
          )}
        </>
      )}

      {/* ── Campos ── */}
      <h2 className="text-base font-bold text-tinta mt-6 mb-1">Lo que dicen los documentos</h2>
      <p className="text-xs text-tinta-suave mb-3">
        Cada dato muestra de dónde salió. Si un documento no se pudo leer, sus campos no aparecen
        acá: eso no quiere decir que vinieran vacíos.
      </p>
      {grupos.length === 0 ? (
        <p className="text-sm text-tinta-suave">Todavía no hay datos extraídos.</p>
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
                        <p className="text-xs text-tinta-suave">{etiquetaCampo(c.slug)}</p>
                        <p className="text-sm text-tinta break-words">
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
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-tinta-suave italic">
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
      <h2 className="text-base font-bold text-tinta mt-6 mb-2">Decisión</h2>

      {exp.decision_oc ? (
        <div className="rounded-lg border border-[#E5E7EB] p-4 text-sm">
          <p className="font-semibold text-tinta">
            {ESTADO_EXPEDIENTE_LABEL[exp.estado] ?? exp.estado} el {fecha(exp.fecha_cierre)}
          </p>
          {typeof exp.decision_oc.motivo === 'string' && exp.decision_oc.motivo.length > 0 && (
            <p className="text-tinta-suave mt-1">{exp.decision_oc.motivo}</p>
          )}
          {exp.decision_oc.sin_lectura === true && (
            <p className="text-[#B45309] mt-1">
              Se decidió con el expediente incompleto. Quien decidió dejó constancia de haber
              revisado por fuera de la plataforma lo que faltaba acá.
            </p>
          )}
          <p className="text-xs text-[#9CA3AF] mt-2">
            La decisión no se reescribe. Si cambian las circunstancias, se abre una vinculación
            nueva.
          </p>
        </div>
      ) : !decidible ? (
        <p className="text-sm text-tinta-suave">{razon}</p>
      ) : !d.puedeDecidir ? (
        <p className="text-sm text-tinta-suave">Solo el oficial de cumplimiento decide.</p>
      ) : (
        <div className="rounded-lg border border-[#E5E7EB] p-4">
          {!rechazando ? (
            <div>
              {exigeConstancia && (
                <label className="flex items-start gap-2 mb-3 text-sm text-[#4B5563] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={constancia}
                    onChange={(ev) => setConstancia(ev.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {CONSTANCIA_SIN_LECTURA}
                    <span className="block text-xs text-[#9CA3AF] mt-0.5">
                      Queda en el expediente y en la bitácora, con tu nombre y la fecha.
                    </span>
                  </span>
                </label>
              )}
              {selloBloquea && (
                <p className="mb-3 text-sm text-[#B91C1C]">{selloBloquea}</p>
              )}
              <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending || selloBloquea !== null || (exigeConstancia && !constancia)}
                onClick={() => decidir('aprobado')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-tinta text-white text-sm font-semibold disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> Aprobar la vinculación
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setRechazando(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-alerta/40 text-[#B91C1C] text-sm font-semibold disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Rechazar
              </button>
              </div>
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
      {aviso && <p className="text-sm text-acento mt-3">{aviso}</p>}
    </div>
  );
}
