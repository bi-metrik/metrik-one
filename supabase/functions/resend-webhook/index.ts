// ============================================================
// resend-webhook — los acuses de Resend vuelven a `avisos_cliente`
// ------------------------------------------------------------
// EL PROBLEMA QUE CIERRA:
//   `notificar-etapa` escribe `estado = 'enviado'` en cuanto Resend acepta el
//   POST. Lo que pasa DESPUES —que el buzon lo devuelva, que el servidor
//   confirme la entrega, que el destinatario lo marque como spam— solo llega por
//   este webhook, y hasta hoy no existia. Resultado medido el 2026-09-09 en
//   SOENA: 51 avisos por correo, tres de ellos rebotados, y los tres figurando
//   como `enviado` igual que los 48 que si llegaron. La tabla respondia "si le
//   avisamos" sobre clientes a los que nadie les aviso.
//
// QUE APLICA, Y QUE NO:
//   · email.delivered  -> `entregado_at`.  NO toca `estado`.
//   · email.bounced    -> `estado = 'rebotado'` + `motivo` con el tipo y el
//                         diagnostico del servidor.
//   · email.complained -> `queja_at`.      NO toca `estado` (el correo SI llego).
//   Cualquier otro evento (`email.sent`, `email.opened`, `email.delivery_delayed`,
//   `contact.*`, `domain.*`) se responde 200 y se ignora.
//
// ⚠️⚠️ LA IDEMPOTENCIA Y EL ORDEN VIVEN EN EL `WHERE`, NO EN UN `IF`.
//   Svix entrega "al menos una vez" y NO garantiza orden (sus reintentos van
//   hasta 10 h despues, y el panel permite reenviar un evento a mano). Un
//   `delivered` que llegue tarde no puede devolver una fila rebotada a
//   `enviado`, y reprocesar el mismo evento dos veces tiene que dar el mismo
//   resultado. Las dos cosas las decide `actualizacionDeAcuse` en
//   `_shared/resend-acuses.ts`, y esta funcion solo traduce esa decision a la
//   llamada. Comprobar antes con un SELECT no serviria: entre el SELECT y el
//   UPDATE cabe el otro acuse.
//
// ⚠️ UN `email_id` SIN FILA NO ES UN ERROR. Los correos INTERNOS al equipo
//   (`notificar-etapa` tambien avisa por dentro, y `alertas-plazo` manda los
//   suyos) no dejan fila en `avisos_cliente`: esa tabla es solo la traza de lo
//   que se le manda al CLIENTE. Devolver 4xx/5xx por uno de esos haria que Svix
//   reintente durante horas un acuse que nunca vamos a poder casar, y despues
//   Resend deshabilita el endpoint por fallar — con lo cual perderiamos tambien
//   los rebotes que si importan. Se responde 200 y se deja en `console.log`, no
//   en `console.error`: no hay nada que arreglar.
//
// CUANDO SI SE DEVUELVE ERROR, Y POR QUE:
//   Solo cuando el evento NO quedo aplicado y un reintento puede arreglarlo:
//   si la base falla (500) o si el secreto no esta configurado (500). Un 401 por
//   firma invalida tambien reintenta, y esta bien que lo haga: si esa firma es
//   nuestra y no la reconocemos, el problema es el secreto y queremos que el
//   evento siga vivo mientras se corrige. Lo que NUNCA devuelve error es un
//   evento ya aplicado, uno que no aplica, o uno que no tiene fila.
//
// verify_jwt = false en config.toml: Resend no manda el JWT de Supabase. La
// autenticidad la valida esta funcion con la firma Svix. Sin ese flag el gateway
// responde 401 antes de ejecutar una linea de codigo y Resend ve el endpoint
// caido — le paso a `wa-webhook` el 2026-05-26 y a `wa-alerts` durante meses.
// ============================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  actualizacionDeAcuse,
  interpretarAcuse,
  leerCabecerasSvix,
  verificarFirmaSvix,
} from '../_shared/resend-acuses.ts';

// Las edge functions no tienen el `Database` generado, y sin el supabase-js
// resuelve toda fila como `never`. Mismo `any` acotado que usa `notificar-etapa`:
// es el ESQUEMA, no el cliente.
// deno-lint-ignore no-explicit-any
type EsquemaSinGenerar = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<EsquemaSinGenerar>;

function getServiceClient(): Supabase {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function json(cuerpo: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // El cuerpo se lee CRUDO y no se vuelve a serializar nunca: la firma es
  // sensible a un espacio. `req.json()` aqui rompe la verificacion.
  const cuerpo = await req.text();

  const secreto = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const firma = await verificarFirmaSvix({
    secreto,
    cabeceras: leerCabecerasSvix(req.headers),
    cuerpo,
    ahoraMs: Date.now(),
  });

  if (!firma.ok) {
    if (firma.razon === 'sin_secreto') {
      // No es un rechazo, es una configuracion que falta. 500 para que Svix lo
      // reintente cuando el secreto exista, en vez de dar el evento por
      // descartado.
      console.error('[resend-webhook] RESEND_WEBHOOK_SECRET no esta configurado');
      return json({ error: 'server_misconfigured', detail: 'RESEND_WEBHOOK_SECRET' }, 500);
    }
    // La razon va en el log y NO en la respuesta: decirle a quien llama si fallo
    // la firma o el reloj es ayudarlo a afinar el intento.
    console.warn('[resend-webhook] firma rechazada: %s', firma.razon);
    return json({ error: 'invalid_signature' }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(cuerpo);
  } catch {
    // La firma ya dijo que viene de Resend, asi que un cuerpo que no parsea es
    // un problema nuestro y reintentarlo da lo mismo.
    console.error('[resend-webhook] cuerpo firmado que no es JSON');
    return json({ ok: true, ignorado: 'json_invalido' });
  }

  const lectura = interpretarAcuse(payload, new Date().toISOString());
  if (!lectura.ok) {
    console.log('[resend-webhook] ignorado: %s', lectura.razon);
    return json({ ok: true, ignorado: lectura.razon });
  }

  const { acuse } = lectura;
  const { set, guarda } = actualizacionDeAcuse(acuse);

  let consulta = getServiceClient()
    .from('avisos_cliente')
    .update(set)
    .eq('proveedor_id', acuse.emailId)
    // `proveedor_id` solo lo tienen las filas de correo, pero declararlo deja
    // escrito de que canal habla este webhook.
    .eq('canal', 'email');

  consulta = guarda.modo === 'es_nulo'
    ? consulta.is(guarda.columna, null)
    : consulta.eq(guarda.columna, guarda.valor);

  const { data, error } = await consulta.select('id, negocio_id');

  if (error) {
    // La base fallo: el acuse NO quedo aplicado y un reintento si puede
    // arreglarlo. Es el unico caso en que conviene que Svix vuelva.
    console.error('[resend-webhook] update fallo (%s %s): %s', acuse.clase, acuse.emailId, error.message);
    return json({ error: 'db_error' }, 500);
  }

  const filas = data?.length ?? 0;
  if (filas === 0) {
    // Dos casos legitimos caen aqui y ninguno es un error: un correo INTERNO
    // (no deja fila en esta tabla) y un acuse repetido que ya se aplico. No se
    // distinguen desde aqui, y tampoco hace falta: en los dos el resultado
    // correcto es no hacer nada.
    console.log('[resend-webhook] %s sin fila que actualizar (email_id=%s)', acuse.clase, acuse.emailId);
    return json({ ok: true, aplicado: 0 });
  }

  console.log(
    '[resend-webhook] %s aplicado a %d fila(s): %s',
    acuse.clase,
    filas,
    data.map((f: { id: string; negocio_id: string }) => `${f.id}/${f.negocio_id}`).join(','),
  );
  return json({ ok: true, aplicado: filas });
});
