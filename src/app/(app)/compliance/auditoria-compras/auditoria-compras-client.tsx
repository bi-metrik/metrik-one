'use client';

import { useRef, useState, useTransition } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import {
  auditarBaseDeCompras,
  generarPlantillaAuditoriaCompras,
  type InformeAuditoria,
} from '@/lib/actions/compliance-auditoria-compras';
import {
  ORDEN_VEREDICTO,
  VEREDICTO_LABEL,
  esHallazgo,
  type VeredictoCompra,
} from '@/lib/compliance/auditoria-compras';
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota';

const ESTILO_VEREDICTO: Record<VeredictoCompra, string> = {
  contratada_pese_a_rechazo: 'bg-[#1A1A1A] text-white border-[#1A1A1A]',
  hallazgo_sin_liberacion: 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/30',
  sin_consulta: 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/30',
  consultada_despues: 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30',
  sin_resultado: 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30',
  cubierta: 'bg-[#ECFDF5] text-[#059669] border-[#10B981]/30',
  sin_hallazgo: 'bg-[#F5F4F2] text-[#6B7280] border-[#E5E7EB]',
};

function descargarBase64(base64: string, filename: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditoriaComprasClient() {
  const [informe, setInforme] = useState<InformeAuditoria | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function bajarPlantilla() {
    startTransition(async () => {
      setError(null);
      const r = await generarPlantillaAuditoriaCompras();
      if (!r.ok) setError(r.error);
      else descargarBase64(r.data.base64, r.data.filename);
    });
  }

  function correr() {
    if (!archivo) {
      setError('Selecciona el archivo de compras del periodo.');
      return;
    }
    startTransition(async () => {
      setError(null);
      setInforme(null);
      const fd = new FormData();
      fd.append('archivo', archivo);
      const r = await auditarBaseDeCompras(fd);
      if (!r.ok) setError(r.error);
      else setInforme(r.data);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-6 w-6 text-[#1A1A1A]" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Auditoría de contrataciones</h1>
          <p className="text-sm text-[#6B7280]">
            Sube la base de compras del periodo y cruza cada contratación contra lo que sabías
            y habías decidido <strong>ese día</strong>. Es un control correctivo: la contratación
            ya ocurrió, y lo que sale es la evidencia de que el procedimiento se saltó.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={bajarPlantilla}
            disabled={pending}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#1A1A1A] border border-[#E5E7EB] rounded-lg px-3 py-2 hover:bg-[#F5F4F2] disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Bajar plantilla
          </button>
          <span className="text-xs text-[#6B7280]">
            El archivo no se guarda en la plataforma: el cruce corre y queda el informe.
          </span>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-[#E5E7EB] rounded-lg p-6 text-center hover:border-[#1A1A1A]/30 transition-colors"
        >
          <Upload className="h-5 w-5 mx-auto text-[#6B7280]" />
          <p className="text-sm text-[#1A1A1A] mt-2">
            {archivo ? archivo.name : 'Selecciona el XLSX de compras del periodo'}
          </p>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
        />

        <button
          type="button"
          onClick={correr}
          disabled={pending || !archivo}
          className="inline-flex items-center gap-2 bg-[#1A1A1A] text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Cruzar contra el historial
        </button>
      </div>

      {informe && <Informe informe={informe} />}
    </div>
  );
}

function Informe({ informe }: { informe: InformeAuditoria }) {
  const { resumen } = informe;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tarjeta
          valor={String(resumen.hallazgos)}
          label="Contrataciones con hallazgo"
          nota="Se contrató sin que el procedimiento estuviera cumplido."
          alarma={resumen.hallazgos > 0}
        />
        <Tarjeta
          valor={String(resumen.total_filas)}
          label="Filas auditadas"
          nota={
            resumen.filas_invalidas > 0
              ? `${resumen.filas_invalidas} no se pudieron leer.`
              : 'Todas legibles.'
          }
          alarma={false}
        />
        <Tarjeta
          valor={
            resumen.periodo_desde && resumen.periodo_hasta
              ? `${formatBogotaFechaCortaAno(resumen.periodo_desde)} a ${formatBogotaFechaCortaAno(resumen.periodo_hasta)}`
              : '—'
          }
          label="Periodo auditado"
          nota="Sale de las fechas del archivo, no del calendario."
          alarma={false}
        />
      </div>

      {informe.truncado && (
        <p className="text-xs text-[#B45309]">
          El archivo traía más filas de las que se auditan de una pasada. Divide el periodo:
          lo que quedó por fuera NO está auditado.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {ORDEN_VEREDICTO.filter((v) => resumen.por_veredicto[v] > 0).map((v) => (
          <span
            key={v}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${ESTILO_VEREDICTO[v]}`}
          >
            {VEREDICTO_LABEL[v]}: {resumen.por_veredicto[v]}
          </span>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#F5F4F2] text-left text-xs uppercase tracking-wider text-[#6B7280]">
            <tr>
              <th className="px-4 py-2">Contraparte</th>
              <th className="px-4 py-2">Contratación</th>
              <th className="px-4 py-2">Compró</th>
              <th className="px-4 py-2">Consultó</th>
              <th className="px-4 py-2">Liberó</th>
              <th className="px-4 py-2">Veredicto</th>
            </tr>
          </thead>
          <tbody>
            {informe.filas.map((f) => (
              <tr
                key={`${f.compra.posicion}`}
                className={`border-t border-[#E5E7EB] ${esHallazgo(f.veredicto) ? '' : 'opacity-60'}`}
              >
                <td className="px-4 py-2">
                  <div className="font-semibold text-[#1A1A1A]">
                    {f.compra.nombre ?? 'Sin nombre'}
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    {f.compra.documento_tipo} {f.compra.documento_numero}
                  </div>
                </td>
                <td className="px-4 py-2 text-[#1A1A1A]">
                  {formatBogotaFechaCortaAno(f.compra.fecha)}
                  {f.compra.referencia && (
                    <div className="text-xs text-[#6B7280]">{f.compra.referencia}</div>
                  )}
                </td>
                <td className="px-4 py-2 text-[#6B7280]">{f.compra.comprador ?? '—'}</td>
                <td className="px-4 py-2 text-[#6B7280]">
                  {f.consulto ?? '—'}
                  {f.consulta_previa && (
                    <div className="text-xs">
                      {formatBogotaFechaCortaAno(f.consulta_previa.created_at)}
                    </div>
                  )}
                  {!f.consulta_previa && f.consulta_posterior && (
                    <div className="text-xs text-[#B45309]">
                      solo el {formatBogotaFechaCortaAno(f.consulta_posterior.created_at)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-[#6B7280]">
                  {f.libero ?? '—'}
                  {f.liberacion_vigente_hasta && (
                    <div className="text-xs">
                      hasta {formatBogotaFechaCortaAno(f.liberacion_vigente_hasta)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${ESTILO_VEREDICTO[f.veredicto]}`}
                  >
                    {VEREDICTO_LABEL[f.veredicto]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {informe.invalidas.length > 0 && (
        <div className="bg-white rounded-lg border border-[#F59E0B]/40 p-5 space-y-2">
          <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#B45309]" />
            Filas que no se pudieron leer ({informe.invalidas.length})
          </h2>
          <p className="text-sm text-[#6B7280]">
            No se auditaron. No se descartan en silencio: corrige la celda en tu archivo y
            vuelve a cruzar, porque cualquiera de estas puede ser un hallazgo.
          </p>
          <ul className="text-sm space-y-1">
            {informe.invalidas.map((f) => (
              <li key={f.posicion} className="flex justify-between gap-3 border-t border-[#E5E7EB] pt-1.5">
                <span className="text-[#1A1A1A]">Fila {f.posicion}: {f.eco}</span>
                <span className="text-[#B45309] text-xs">{f.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tarjeta({
  valor,
  label,
  nota,
  alarma,
}: {
  valor: string;
  label: string;
  nota: string;
  alarma: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        alarma ? 'bg-[#FEF2F2] border-[#EF4444]/40' : 'bg-white border-[#E5E7EB]'
      }`}
    >
      <div className={`text-2xl font-bold ${alarma ? 'text-[#B91C1C]' : 'text-[#1A1A1A]'}`}>
        {valor}
      </div>
      <div className="text-sm font-semibold text-[#1A1A1A] mt-0.5">{label}</div>
      <div className="text-xs text-[#6B7280] mt-0.5">{nota}</div>
    </div>
  );
}
