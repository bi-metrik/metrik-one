'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  actualizarDocumento,
  crearDocumento,
  listarExpediente,
  registrarVersion,
  sembrarCatalogoSugerido,
  verificarEnlacesExpediente,
  type FilaExpediente,
  type VersionDocumento,
} from '@/lib/actions/compliance-documentos';
import {
  ESTADO_DOC_LABEL,
  PERIODICIDAD_MAX,
  PERIODICIDAD_MIN,
  TIPOS_DOCUMENTO,
  TIPO_LABEL,
  advertenciaEnlace,
  versionVigenteEn,
  type EstadoDocumento,
} from '@/lib/compliance/documentos';

const CHIP: Record<EstadoDocumento, string> = {
  faltante: 'bg-[#EF4444]/10 text-[#B91C1C] border-[#EF4444]/30',
  link_roto: 'bg-[#EF4444]/10 text-[#B91C1C] border-[#EF4444]/30',
  vencido: 'bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30',
  por_vencer: 'bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30',
  vigente: 'bg-[#ECFDF5] text-[#059669] border-[#10B981]/30',
};

type Cargo = { id: string; nombre: string };

export default function DocumentosClient({
  inicial,
  cargos,
}: {
  inicial: FilaExpediente[];
  cargos: Cargo[];
}) {
  const [filas, setFilas] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevoDoc, setNuevoDoc] = useState(false);
  /** La pregunta del auditor: qué regía el día X. Vacío = hoy. */
  const [fechaCorte, setFechaCorte] = useState('');

  function recargar(mensaje?: string) {
    startTransition(async () => {
      const r = await listarExpediente();
      if (r.ok) setFilas(r.data);
      else setError(r.error);
      if (mensaje) setAviso(mensaje);
    });
  }

  function correr<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, alOk: (d: T) => string) {
    startTransition(async () => {
      setError(null);
      setAviso(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const rec = await listarExpediente();
      if (rec.ok) setFilas(rec.data);
      setAviso(alOk(r.data));
    });
  }

  const resumen = useMemo(() => {
    const c = { faltante: 0, link_roto: 0, vencido: 0, por_vencer: 0, vigente: 0 };
    for (const f of filas) if (f.activo && f.estado) c[f.estado] += 1;
    return c;
  }, [filas]);

  const activas = filas.filter((f) => f.activo);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <FileText className="h-6 w-6 text-[#1A1A1A] mt-0.5" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Expediente de cumplimiento</h1>
          <p className="text-sm text-[#6B7280]">
            El inventario de los documentos que sostienen el sistema. Los archivos siguen viviendo
            donde ya los manejas: acá queda registrado <strong>qué existe, qué versión rige y quién
            la aprobó</strong>, para que una auditoría se responda desde un solo lugar.
          </p>
        </div>
      </div>

      <div className="p-3 rounded-lg bg-[#F5F4F2] border border-[#E5E7EB] text-sm text-[#6B7280]">
        Enlaza siempre el <strong>PDF congelado de la versión aprobada</strong>, no el documento
        editable. Si el archivo se sigue editando, esta fila dirá una versión y el archivo tendrá
        otra, y esa diferencia aparece justo el día en que alguien la revisa.
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

      {/* Resumen + acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2 flex-1">
          {(['faltante', 'link_roto', 'vencido', 'por_vencer', 'vigente'] as EstadoDocumento[]).map((e) =>
            resumen[e] > 0 ? (
              <span key={e} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${CHIP[e]}`}>
                {resumen[e]} {ESTADO_DOC_LABEL[e].toLowerCase()}
              </span>
            ) : null,
          )}
          {activas.length === 0 && <span className="text-sm text-[#6B7280]">Todavía no hay piezas registradas.</span>}
        </div>

        <button
          type="button"
          onClick={() =>
            correr(verificarEnlacesExpediente, (d) =>
              d.revisados === 0
                ? 'No hay enlaces que revisar todavía.'
                : `${d.revisados} enlaces revisados: ${d.ok} responden, ${d.rotos} rotos, ${d.sin_permiso} sin acceso.`,
            )
          }
          disabled={pending}
          className="inline-flex items-center gap-2 border border-[#E5E7EB] text-[#1A1A1A] text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Verificar enlaces
        </button>
        <button
          type="button"
          onClick={() => setNuevoDoc((v) => !v)}
          className="inline-flex items-center gap-2 bg-[#1A1A1A] text-white text-sm font-semibold rounded-lg px-3 py-1.5"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar pieza
        </button>
      </div>

      {nuevoDoc && (
        <FormNuevoDocumento
          pending={pending}
          onCancelar={() => setNuevoDoc(false)}
          onGuardar={(input) => {
            correr(
              () => crearDocumento(input),
              () => `"${input.nombre}" quedó en el expediente. Falta registrarle una versión.`,
            );
            setNuevoDoc(false);
          }}
        />
      )}

      {/* La pregunta del auditor */}
      <div className="p-4 rounded-lg border border-[#E5E7EB] bg-white flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[18rem]">
          <p className="text-sm font-semibold text-[#1A1A1A]">¿Qué regía el día...?</p>
          <p className="text-xs text-[#6B7280]">
            Es la pregunta que hace una auditoría sobre un hecho pasado. Pon la fecha y la tabla
            muestra la versión que estaba vigente ese día, no la de hoy.
          </p>
        </div>
        <input
          type="date"
          value={fechaCorte}
          onChange={(e) => setFechaCorte(e.target.value)}
          className="border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-sm"
        />
        {fechaCorte && (
          <button
            type="button"
            onClick={() => setFechaCorte('')}
            className="text-sm text-[#6B7280] underline"
          >
            Volver a hoy
          </button>
        )}
      </div>

      {filas.length === 0 && (
        <div className="p-6 rounded-lg border border-dashed border-[#E5E7EB] text-center space-y-3">
          <p className="text-sm text-[#6B7280]">
            Podemos sembrar un catálogo sugerido con las piezas que suelen componer un expediente.
            Es una <strong>sugerencia</strong>, no una lista de obligaciones: la adoptas, la editas
            y borras lo que no aplique.
          </p>
          <button
            type="button"
            onClick={() =>
              correr(sembrarCatalogoSugerido, (d) => `${d.creados} piezas agregadas al expediente.`)
            }
            disabled={pending}
            className="inline-flex items-center gap-2 bg-[#1A1A1A] text-white text-sm font-semibold rounded-lg px-3 py-2 disabled:opacity-40"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Sembrar catálogo sugerido
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
        {activas.map((f) => {
          // Con fecha de corte manda la versión que regía ese día. Sin ella, la
          // abierta. Son preguntas distintas y la pantalla no las mezcla.
          const mostrada = fechaCorte ? versionVigenteEn(f.versiones, fechaCorte) : f.vigente;
          const expandido = abierto === f.id;
          return (
            <div key={f.id} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <button
                  type="button"
                  onClick={() => setAbierto(expandido ? null : f.id)}
                  className="mt-0.5 text-[#6B7280]"
                  aria-label={expandido ? 'Contraer' : 'Expandir'}
                >
                  {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                <div className="flex-1 min-w-[18rem]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-[#6B7280]">{f.codigo}</span>
                    <span className="font-semibold text-[#1A1A1A]">{f.nombre}</span>
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border bg-[#F5F4F2] text-[#6B7280] border-[#E5E7EB]">
                      {TIPO_LABEL[f.tipo]}
                    </span>
                    {!fechaCorte && f.estado && (
                      <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${CHIP[f.estado]}`}>
                        {ESTADO_DOC_LABEL[f.estado]}
                      </span>
                    )}
                  </div>
                  {f.descripcion && <p className="text-xs text-[#6B7280] mt-0.5">{f.descripcion}</p>}

                  <div className="mt-1.5 text-xs text-[#6B7280] space-y-0.5">
                    {mostrada ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={mostrada.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[#1A1A1A] font-semibold underline"
                          >
                            Versión {mostrada.version} <ExternalLink className="h-3 w-3" />
                          </a>
                          <span>
                            rige desde {mostrada.vigente_desde}
                            {mostrada.vigente_hasta ? ` hasta ${mostrada.vigente_hasta}` : ''}
                          </span>
                        </div>
                        {(mostrada.aprobado_por || mostrada.aprobacion_referencia) && (
                          <div>
                            Aprobada por {mostrada.aprobado_por ?? 'sin registrar'}
                            {mostrada.aprobacion_referencia ? ` (${mostrada.aprobacion_referencia})` : ''}
                            {mostrada.fecha_aprobacion ? ` el ${mostrada.fecha_aprobacion}` : ''}
                          </div>
                        )}
                        {!fechaCorte && f.vence_el && <div>Se renueva el {f.vence_el}.</div>}
                      </>
                    ) : (
                      <div className="text-[#B91C1C]">
                        {fechaCorte
                          ? `Ninguna versión registrada regía el ${fechaCorte}.`
                          : 'Sin ninguna versión registrada.'}
                      </div>
                    )}
                    {f.responsable_cargo_nombre && <div>Responsable: {f.responsable_cargo_nombre}</div>}
                    {!fechaCorte && f.advertencia && (
                      <div className="text-[#B45309] flex items-start gap-1">
                        <Link2 className="h-3 w-3 mt-0.5 shrink-0" /> {f.advertencia}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {expandido && (
                <div className="mt-4 ml-7 space-y-4">
                  <Ajustes
                    fila={f}
                    cargos={cargos}
                    pending={pending}
                    onGuardar={(patch) =>
                      correr(
                        () => actualizarDocumento({ id: f.id, ...patch }),
                        () => `"${f.nombre}" actualizado.`,
                      )
                    }
                  />
                  <FormVersion
                    pending={pending}
                    onGuardar={(input) =>
                      correr(
                        () => registrarVersion({ documento_id: f.id, ...input }),
                        (d) =>
                          d.advertencia
                            ? `Versión ${input.version} registrada. ${d.advertencia}`
                            : `Versión ${input.version} registrada y la anterior quedó cerrada.`,
                      )
                    }
                  />
                  <Historial versiones={f.versiones} />
                  <button
                    type="button"
                    onClick={() =>
                      correr(
                        () => actualizarDocumento({ id: f.id, activo: false }),
                        () => `"${f.nombre}" salió del expediente. Su historial queda guardado.`,
                      )
                    }
                    className="text-xs text-[#B91C1C] underline"
                  >
                    Quitar del expediente
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filas.some((f) => !f.activo) && (
        <button
          type="button"
          onClick={() => recargar()}
          className="text-xs text-[#6B7280] underline"
        >
          {filas.filter((f) => !f.activo).length} piezas fuera del expediente conservan su historial.
        </button>
      )}

      <p className="text-xs text-[#6B7280]">
        Que una pieza sea obligatoria lo declaras tú: la plataforma no afirma que la norma la exija.
        Los reportes a la UIAF, los expedientes de contraparte y la ejecución de cada control no van
        acá, porque son evidencia por registro y quedan amarrados a su propio registro en ONE.
      </p>
    </div>
  );
}

// ─── Piezas de formulario ──────────────────────────────────────────────────

const INPUT = 'border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-sm w-full';
const LABEL = 'text-xs font-semibold text-[#6B7280] block mb-1';

function FormNuevoDocumento({
  pending,
  onGuardar,
  onCancelar,
}: {
  pending: boolean;
  onGuardar: (input: { codigo: string; tipo: string; nombre: string; descripcion: string; periodicidad_meses: string }) => void;
  onCancelar: () => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [tipo, setTipo] = useState<string>('manual');
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [periodicidad, setPeriodicidad] = useState('');

  return (
    <div className="p-4 rounded-lg border border-[#E5E7EB] bg-white grid gap-3 sm:grid-cols-2">
      <div>
        <label className={LABEL}>Código</label>
        <input
          className={`${INPUT} font-mono uppercase`}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          placeholder="MAN-SARLAFT"
        />
        <p className="text-[11px] text-[#6B7280] mt-1">Mayúsculas, números y guion. Es la cita del expediente.</p>
      </div>
      <div>
        <label className={LABEL}>Tipo</label>
        <select className={INPUT} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS_DOCUMENTO.map((t) => (
            <option key={t} value={t}>{TIPO_LABEL[t]}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL}>Nombre</label>
        <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL}>Descripción</label>
        <input className={INPUT} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      </div>
      <div>
        <label className={LABEL}>Se renueva cada (meses)</label>
        <input
          type="number"
          min={PERIODICIDAD_MIN}
          max={PERIODICIDAD_MAX}
          className={INPUT}
          value={periodicidad}
          onChange={(e) => setPeriodicidad(e.target.value)}
          placeholder="Vacío = no vence"
        />
      </div>
      <div className="flex items-end gap-2">
        <button
          type="button"
          disabled={pending || !codigo || nombre.trim().length < 3}
          onClick={() => onGuardar({ codigo, tipo, nombre, descripcion, periodicidad_meses: periodicidad })}
          className="inline-flex items-center gap-2 bg-[#1A1A1A] text-white text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
        </button>
        <button type="button" onClick={onCancelar} className="text-sm text-[#6B7280] underline">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Ajustes({
  fila,
  cargos,
  pending,
  onGuardar,
}: {
  fila: FilaExpediente;
  cargos: Cargo[];
  pending: boolean;
  onGuardar: (patch: { obligatorio?: boolean; periodicidad_meses?: string; responsable_cargo_id?: string | null }) => void;
}) {
  const [periodicidad, setPeriodicidad] = useState(
    fila.periodicidad_meses === null ? '' : String(fila.periodicidad_meses),
  );
  const [cargo, setCargo] = useState(fila.responsable_cargo_id ?? '');

  return (
    <div className="grid gap-3 sm:grid-cols-3 p-3 rounded-lg bg-[#F5F4F2] border border-[#E5E7EB]">
      <label className="flex items-center gap-2 text-sm text-[#1A1A1A]">
        <input
          type="checkbox"
          checked={fila.obligatorio}
          onChange={(e) => onGuardar({ obligatorio: e.target.checked })}
          disabled={pending}
        />
        Parte obligatoria del expediente
      </label>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className={LABEL}>Se renueva cada (meses)</label>
          <input
            type="number"
            min={PERIODICIDAD_MIN}
            max={PERIODICIDAD_MAX}
            className={INPUT}
            value={periodicidad}
            onChange={(e) => setPeriodicidad(e.target.value)}
            onBlur={() => {
              const actual = fila.periodicidad_meses === null ? '' : String(fila.periodicidad_meses);
              if (periodicidad !== actual) onGuardar({ periodicidad_meses: periodicidad });
            }}
          />
        </div>
      </div>
      <div>
        <label className={LABEL}>Responsable de mantenerlo vigente</label>
        <select
          className={INPUT}
          value={cargo}
          onChange={(e) => {
            setCargo(e.target.value);
            onGuardar({ responsable_cargo_id: e.target.value || null });
          }}
          disabled={pending}
        >
          <option value="">Sin asignar</option>
          {cargos.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function FormVersion({
  pending,
  onGuardar,
}: {
  pending: boolean;
  onGuardar: (input: {
    version: string;
    url: string;
    vigente_desde: string;
    fecha_aprobacion: string | null;
    aprobado_por: string | null;
    aprobacion_referencia: string | null;
  }) => void;
}) {
  const [version, setVersion] = useState('');
  const [url, setUrl] = useState('');
  const [desde, setDesde] = useState('');
  const [aprobacion, setAprobacion] = useState('');
  const [aprobadoPor, setAprobadoPor] = useState('');
  const [acta, setActa] = useState('');

  const advertencia = url ? advertenciaEnlace(url) : null;
  const esCarpeta = /^https:\/\/drive\.google\.com\/drive\/folders\//.test(url.trim());

  return (
    <div className="p-3 rounded-lg border border-[#E5E7EB] grid gap-3 sm:grid-cols-3">
      <div className="sm:col-span-3 text-xs font-semibold text-[#1A1A1A]">Registrar una versión nueva</div>
      <div>
        <label className={LABEL}>Versión</label>
        <input className={INPUT} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="3.0" />
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL}>Enlace al archivo congelado</label>
        <input className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/file/d/..." />
      </div>
      <div>
        <label className={LABEL}>Rige desde</label>
        <input type="date" className={INPUT} value={desde} onChange={(e) => setDesde(e.target.value)} />
      </div>
      <div>
        <label className={LABEL}>Fecha de aprobación</label>
        <input type="date" className={INPUT} value={aprobacion} onChange={(e) => setAprobacion(e.target.value)} />
      </div>
      <div>
        <label className={LABEL}>Aprobada por</label>
        <input className={INPUT} value={aprobadoPor} onChange={(e) => setAprobadoPor(e.target.value)} placeholder="Junta Directiva" />
      </div>
      <div>
        <label className={LABEL}>Acta</label>
        <input className={INPUT} value={acta} onChange={(e) => setActa(e.target.value)} placeholder="Acta 042" />
      </div>

      {esCarpeta && (
        <div className="sm:col-span-3 text-xs text-[#B91C1C]">
          Ese enlace es una carpeta. Una carpeta no es una versión: obliga a buscar adentro, que es
          justo lo que este expediente evita. Enlaza el archivo.
        </div>
      )}
      {advertencia && <div className="sm:col-span-3 text-xs text-[#B45309]">{advertencia}</div>}

      <div className="sm:col-span-3">
        <button
          type="button"
          disabled={pending || !version.trim() || !url.trim() || !desde || esCarpeta}
          onClick={() =>
            onGuardar({
              version,
              url,
              vigente_desde: desde,
              fecha_aprobacion: aprobacion || null,
              aprobado_por: aprobadoPor || null,
              aprobacion_referencia: acta || null,
            })
          }
          className="inline-flex items-center gap-2 bg-[#1A1A1A] text-white text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Registrar versión
        </button>
        <p className="text-[11px] text-[#6B7280] mt-1.5">
          Al registrarla, la versión que estaba vigente se cierra el mismo día en que arranca esta.
        </p>
      </div>
    </div>
  );
}

function Historial({ versiones }: { versiones: VersionDocumento[] }) {
  if (versiones.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-[#1A1A1A] mb-1.5">Historial de versiones</div>
      <div className="border border-[#E5E7EB] rounded-lg divide-y divide-[#E5E7EB] text-xs">
        {versiones.map((v) => (
          <div key={v.id} className="p-2 flex flex-wrap items-center gap-2">
            <a href={v.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#1A1A1A] underline">
              {v.version}
            </a>
            <span className="text-[#6B7280]">
              {v.vigente_desde} a {v.vigente_hasta ?? 'hoy'}
            </span>
            {v.aprobacion_referencia && <span className="text-[#6B7280]">{v.aprobacion_referencia}</span>}
            {v.url_estado && v.url_estado !== 'ok' && (
              <span className="text-[#B91C1C]">
                {v.url_estado === 'rota' ? 'Enlace roto' : 'Sin acceso'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
