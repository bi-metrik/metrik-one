'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Mail,
  Upload,
} from 'lucide-react';
import {
  aplicarCargueSujetos,
  generarPlantillaSujetos,
  previsualizarCargueSujetos,
  type ResultadoCargue,
} from '@/lib/actions/compliance-cargue-sujetos';
import {
  explicarInvalida,
  planTieneEfecto,
  type AccionCargue,
  type PlanCargue,
} from '@/lib/compliance/cargue-sujetos';
import {
  enviarInvitacionesEnLote,
  previsualizarInvitacionMasiva,
  type ResultadoInvitacionMasiva,
} from '@/lib/actions/compliance-invitacion-masiva';
import {
  invitables,
  LIMITE_INVITACIONES_LOTE,
  type EstadoInvitacion,
  type PlanInvitacion,
} from '@/lib/compliance/invitacion-masiva';

const ETIQUETA_INVITACION: Record<EstadoInvitacion, string> = {
  invitable: 'Se le escribe',
  sin_correo: 'Falta correo',
  ya_tiene_expediente: 'Ya tiene expediente',
  relacion_cerrada: 'Ya salió',
};

const ESTILO_INVITACION: Record<EstadoInvitacion, string> = {
  invitable: 'bg-[var(--acento-tinte)] text-acento border-acento/30',
  sin_correo: 'bg-[#FFFBEB] text-[#B45309] border-advertencia/30',
  ya_tiene_expediente: 'bg-papel text-tinta-suave border-[#E5E7EB]',
  relacion_cerrada: 'bg-papel text-tinta-suave border-[#E5E7EB]',
};

const ETIQUETA_ACCION: Record<AccionCargue, string> = {
  alta: 'Alta',
  alta_cerrada: 'Alta ya cerrada',
  actualizacion: 'Actualiza',
  cierre: 'Cierra',
  sin_cambio: 'Sin cambio',
};

const ESTILO_ACCION: Record<AccionCargue, string> = {
  alta: 'bg-[var(--acento-tinte)] text-acento border-acento/30',
  alta_cerrada: 'bg-[#FFFBEB] text-[#B45309] border-advertencia/30',
  actualizacion: 'bg-[#FFFBEB] text-[#B45309] border-advertencia/30',
  cierre: 'bg-tinta text-white border-tinta',
  sin_cambio: 'bg-papel text-tinta-suave border-[#E5E7EB]',
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

export default function CargueSujetosClient({ puedeInvitar }: { puedeInvitar: boolean }) {
  const [plan, setPlan] = useState<PlanCargue | null>(null);
  const [resultado, setResultado] = useState<ResultadoCargue | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invitacion, setInvitacion] = useState<PlanInvitacion | null>(null);
  const [envio, setEnvio] = useState<ResultadoInvitacionMasiva | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function bajarPlantilla() {
    startTransition(async () => {
      setError(null);
      const r = await generarPlantillaSujetos();
      if (!r.ok) setError(r.error);
      else descargarBase64(r.data.base64, r.data.filename);
    });
  }

  function previsualizar() {
    if (!archivo) {
      setError('Selecciona el archivo con la base de terceros.');
      return;
    }
    startTransition(async () => {
      setError(null);
      setPlan(null);
      setResultado(null);
      const fd = new FormData();
      fd.append('archivo', archivo);
      const r = await previsualizarCargueSujetos(fd);
      if (!r.ok) setError(r.error);
      else setPlan(r.data);
    });
  }

  function aplicar() {
    if (!plan) return;
    startTransition(async () => {
      setError(null);
      const r = await aplicarCargueSujetos(plan.items);
      if (!r.ok) return setError(r.error);
      setResultado(r.data);
      setPlan(null);
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = '';
    });
  }

  function verInvitaciones() {
    startTransition(async () => {
      setError(null);
      setEnvio(null);
      const r = await previsualizarInvitacionMasiva();
      if (!r.ok) setError(r.error);
      else setInvitacion(r.data);
    });
  }

  function enviarInvitaciones() {
    if (!invitacion) return;
    const lista = invitables(invitacion).slice(0, LIMITE_INVITACIONES_LOTE);
    if (lista.length === 0) return;
    startTransition(async () => {
      setError(null);
      const r = await enviarInvitacionesEnLote(lista);
      if (!r.ok) return setError(r.error);
      setEnvio(r.data);
      setInvitacion(null);
    });
  }

  const porInvitar = invitacion ? invitables(invitacion) : [];
  const conEfecto = plan ? planTieneEfecto(plan) : false;
  const cierres = plan ? plan.resumen.cierre + plan.resumen.alta_cerrada : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/compliance/sujetos"
          className="inline-flex items-center gap-1 text-sm text-tinta-suave hover:text-tinta"
        >
          <ArrowLeft className="h-4 w-4" /> Base de sujetos
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-6 w-6 text-tinta" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-tinta">Cargue masivo de terceros</h1>
          <p className="text-sm text-tinta-suave">
            Una sola plantilla para proveedores, contratistas y empleados. La misma sirve para
            las novedades del mes: las filas con fecha de salida cierran la relación, y quien
            queda cerrado <strong>deja de consultarse en el monitoreo</strong>.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-alerta/10 border border-alerta/30 text-[#B91C1C] text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {resultado && (
        <div className="p-4 rounded-lg bg-[var(--acento-tinte)] border border-acento/30 text-sm space-y-1">
          <div className="flex items-center gap-2 font-semibold text-acento">
            <CheckCircle2 className="h-4 w-4" /> Cargue aplicado
          </div>
          <p className="text-tinta">
            {resultado.altas} alta(s), {resultado.cierres} cierre(s),{' '}
            {resultado.actualizaciones} actualización(es). {resultado.omitidas} fila(s) no
            necesitaban cambio.
          </p>
          {resultado.fallidas.length > 0 && (
            <p className="text-[#B91C1C]">
              {resultado.fallidas.length} fila(s) fallaron:{' '}
              {resultado.fallidas.map((f) => `fila ${f.fila} (${f.error})`).join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={bajarPlantilla}
            disabled={pending}
            className="inline-flex items-center gap-2 text-sm font-semibold text-tinta border border-[#E5E7EB] rounded-lg px-3 py-2 hover:bg-papel disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Bajar plantilla
          </button>
          <span className="text-xs text-tinta-suave">
            El archivo no se guarda: queda el efecto en la base, con su bitácora.
          </span>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-[#E5E7EB] rounded-lg p-6 text-center hover:border-tinta/30 transition-colors"
        >
          <Upload className="h-5 w-5 mx-auto text-tinta-suave mb-2" />
          <span className="text-sm text-tinta">
            {archivo ? archivo.name : 'Selecciona el archivo diligenciado (.xlsx)'}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            setPlan(null);
            setResultado(null);
          }}
        />

        <button
          type="button"
          onClick={previsualizar}
          disabled={pending || !archivo}
          className="inline-flex items-center gap-2 bg-tinta text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Ver qué va a pasar
        </button>
      </div>

      {plan && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-tinta">Vista previa</h2>
            <p className="text-sm text-tinta-suave">
              Todavía no se ha escrito nada. {plan.resumen.alta} alta(s),{' '}
              {plan.resumen.alta_cerrada} alta(s) ya cerrada(s), {plan.resumen.cierre} cierre(s),{' '}
              {plan.resumen.actualizacion} actualización(es), {plan.resumen.sin_cambio} sin cambio,{' '}
              {plan.resumen.invalidas} fila(s) rechazada(s).
            </p>
          </div>

          {plan.truncado && (
            <p className="text-sm text-[#B45309]">
              El archivo trae más filas de las que se procesan de una vez. Solo se leyeron las
              primeras; sube el resto en un segundo archivo.
            </p>
          )}

          {cierres > 0 && (
            <p className="text-sm text-tinta bg-papel border border-[#E5E7EB] rounded-lg p-3">
              Este cargue cierra {cierres} relación(es). A partir de la fecha de salida, esos
              terceros dejan de entrar al monitoreo recurrente.
            </p>
          )}

          {plan.invalidas.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#B91C1C]">
                Filas rechazadas ({plan.invalidas.length})
              </h3>
              <ul className="text-sm text-tinta-suave space-y-1">
                {plan.invalidas.map((f) => (
                  <li key={f.fila}>
                    <strong className="text-tinta">Fila {f.fila}</strong> — {f.eco}:{' '}
                    {explicarInvalida(f.motivo)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-papel text-left text-xs uppercase text-tinta-suave">
                  <tr>
                    <th className="px-3 py-2">Fila</th>
                    <th className="px-3 py-2">Qué pasa</th>
                    <th className="px-3 py-2">Tercero</th>
                    <th className="px-3 py-2">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {plan.items.map((it) => (
                    <tr key={it.fila}>
                      <td className="px-3 py-2 text-tinta-suave">{it.fila}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${ESTILO_ACCION[it.accion]}`}
                        >
                          {ETIQUETA_ACCION[it.accion]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-tinta">
                        {it.nombre}
                        <span className="block text-xs text-tinta-suave">
                          {it.documento_tipo} {it.documento_numero}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-tinta-suave">{it.detalle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={aplicar}
            disabled={pending || !conEfecto}
            className="inline-flex items-center gap-2 bg-tinta text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {conEfecto ? 'Aplicar el cargue' : 'No hay nada que aplicar'}
          </button>
        </div>
      )}

      {/* Paso 3. Separado del cargue a propósito: subir el archivo no le escribe
          a nadie, y esto sí. */}
      {puedeInvitar && (
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Mail className="h-5 w-5 text-tinta mt-0.5" />
          <div className="flex-1">
            <h2 className="text-base font-bold text-tinta">Invitar a abrir expediente</h2>
            <p className="text-sm text-tinta-suave">
              Le abre el expediente CCBF a cada tercero de la base y le manda su enlace personal
              al correo. <strong>Cargar el archivo no manda nada</strong>: esto sí, y no tiene
              reversa. Primero mira a quién le va a llegar.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={verInvitaciones}
          disabled={pending}
          className="inline-flex items-center gap-2 text-sm font-semibold text-tinta border border-[#E5E7EB] rounded-lg px-3 py-2 hover:bg-papel disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Ver a quién habría que invitar
        </button>

        {envio && (
          <div className="p-3 rounded-lg bg-[var(--acento-tinte)] border border-acento/30 text-sm space-y-1">
            <p className="font-semibold text-acento">{envio.enviadas} invitación(es) enviada(s).</p>
            {envio.sinCorreo.length > 0 && (
              <div className="text-tinta">
                <p>
                  {envio.sinCorreo.length} expediente(s) quedaron abiertos pero el correo no
                  salió. Cópiales el enlace:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {envio.sinCorreo.map((s) => (
                    <li key={s.url} className="break-all text-xs">
                      <strong>{s.nombre}</strong> — {s.url}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {envio.fallidas.length > 0 && (
              <p className="text-[#B91C1C]">
                {envio.fallidas.length} fallaron:{' '}
                {envio.fallidas.map((f) => `${f.nombre} (${f.error})`).join(', ')}
              </p>
            )}
          </div>
        )}

        {invitacion && (
          <div className="space-y-3">
            <p className="text-sm text-tinta-suave">
              {invitacion.resumen.invitable} recibirían correo.{' '}
              {invitacion.resumen.ya_tiene_expediente} ya tienen expediente,{' '}
              {invitacion.resumen.sin_correo} no tienen correo y{' '}
              {invitacion.resumen.relacion_cerrada} ya salieron.
            </p>

            {!invitacion.espejoVivo && (
              <p className="text-sm text-[#B45309] bg-[#FFFBEB] border border-advertencia/30 rounded-lg p-3">
                No hay ningún expediente reflejado en esta pantalla. Si ya invitaste gente desde
                la bandeja, el aviso de Valida no está llegando y esta lista puede volver a
                escribirle a quien ya contestó. Revisa la configuración del webhook antes de
                enviar.
              </p>
            )}

            {porInvitar.length > LIMITE_INVITACIONES_LOTE && (
              <p className="text-sm text-[#B45309]">
                Se envían de a {LIMITE_INVITACIONES_LOTE}. Vuelve a correr esto para el resto.
              </p>
            )}

            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-papel text-left text-xs uppercase text-tinta-suave sticky top-0">
                  <tr>
                    <th className="px-3 py-2">Qué pasa</th>
                    <th className="px-3 py-2">Tercero</th>
                    <th className="px-3 py-2">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {invitacion.items.map((it) => (
                    <tr key={it.sujeto_id}>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${ESTILO_INVITACION[it.estado]}`}
                        >
                          {ETIQUETA_INVITACION[it.estado]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-tinta">
                        {it.nombre}
                        <span className="block text-xs text-tinta-suave">
                          {it.documento_tipo} {it.documento_numero}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-tinta-suave">{it.detalle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={enviarInvitaciones}
              disabled={pending || porInvitar.length === 0}
              className="inline-flex items-center gap-2 bg-tinta text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {porInvitar.length === 0
                ? 'No hay a quién invitar'
                : `Enviar ${Math.min(porInvitar.length, LIMITE_INVITACIONES_LOTE)} invitación(es)`}
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
