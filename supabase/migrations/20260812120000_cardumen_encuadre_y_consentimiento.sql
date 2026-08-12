-- Cardumen: encuadre y consentimiento por estudio, con la politica de datos abrible
-- DENTRO de WhatsApp.
--
-- POR QUE: hoy el chat abre con un encuadre generico fijo en el codigo ("Cardumen /
-- gracias por sumar tu historia / 24 horas") y dispara la primera pregunta de inmediato.
-- Para Trappvel eso no alcanza: son dos personas de un equipo de cliente, se les prometio
-- que aprueban que se comparte, y hay que informar el tratamiento de datos ANTES de
-- recoger nada. Un encuadre generico no puede sostener eso.
--
-- DISENO: `cardumen_estudios.encuadre` (jsonb, opt-in). Si es NULL, el estudio abre como
-- hoy — Araucania no cambia. Si esta, el chat manda tres mensajes y **no pregunta nada**
-- hasta que la persona autorice:
--   1. saludo + rubrica (que se le va a preguntar y como)
--   2. tratamiento de datos + boton CTA que abre la politica en el navegador interno de
--      WhatsApp (`sendCtaUrl`, ya existe; un link de texto plano sacaria a la persona al
--      navegador externo)
--   3. peticion de autorizacion explicita
--
-- La autorizacion se registra con la VERSION del texto mostrado. Sin la version, dentro de
-- seis meses nadie puede decir que fue lo que aceptaron.
--
-- Verificado antes de escribir esto: https://metrik.com.co/privacidad responde 200 sin
-- redireccion ni SSO, y `display_text` del boton CTA se recorta a 20 caracteres en
-- `wa-respond.ts` (de ahi que el boton diga "Politica de datos" y no algo mas largo).

alter table public.cardumen_estudios
  add column if not exists encuadre jsonb;

comment on column public.cardumen_estudios.encuadre is
  'Encuadre y consentimiento del estudio. NULL = abre con el encuadre generico de siempre. Claves: version, saludo, rubrica, datos, url_politica, boton_politica, pide_consentimiento, palabra_si, palabra_no.';

update public.cardumen_estudios
   set encuadre = $enc${
  "version": "trappvel-v1",
  "pide_consentimiento": true,
  "palabra_si": "LISTO",
  "palabra_no": "NO",
  "url_politica": "https://metrik.com.co/privacidad",
  "boton_politica": "Politica de datos",
  "saludo": "Hola 👋 Soy el asistente de MéTRIK.\n\nEstamos ayudando a Trappvel a ordenar y automatizar procesos, y para eso queremos entender cómo se trabaja hoy de verdad.\n\n*Cómo funciona:* te voy a hacer 5 preguntas y te voy a pedir casos concretos, no opiniones. Sobre cada caso te haré un par de preguntas cortas para que tú misma ubiques lo que contaste. Puedes responder por audio o por escrito, cuando puedas, y puedes saltarte cualquier pregunta.",
  "datos": "Antes de empezar, sobre tus datos:\n\n• Lo que respondas lo lee el equipo de MéTRIK. Si mandas audio, lo transcribimos.\n• *No* es una evaluación de tu desempeño y no va a tu hoja de vida.\n• Lo que salga de aquí será el punto de partida de una reunión con todo el equipo. Como son dos personas, no te puedo prometer que sea anónimo, porque no podría cumplirlo. Lo que sí: *antes de esa reunión te mostramos qué se va a llevar de lo tuyo y tú decides* si va, si se ajusta o si se queda afuera.\n• Puedes pedir que borremos todo lo tuyo escribiendo *BORRAR* en cualquier momento.\n\nAquí puedes leer la política de tratamiento de datos 👇",
  "cierre_consentimiento": "¿Seguimos? Responde *LISTO* para empezar, o *NO* si prefieres no participar (no pasa nada).",
  "al_rechazar": "Listo, no hay problema. No guardamos nada. Si cambias de opinión, escríbeme cuando quieras.",
  "al_borrar": "Hecho: borré lo que habías compartido y cerré la conversación. Si quieres empezar de nuevo, escríbeme."
}$enc$::jsonb
 where estudio = 'trappvel-equipo';
