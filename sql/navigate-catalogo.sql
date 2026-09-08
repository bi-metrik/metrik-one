-- Navigate (Cardumen x Reframeit) — catalogo del estudio de DEMO para Grupo Progreso.
--
-- Que hace: da de alta el estudio `navigate` en `cardumen_estudios` (modo chat, motor
-- determinista) y apunta la palabra `cardumen` a el en `cardumen_estudio_triggers`.
-- No crea tablas ni columnas: la bandera de demo y los campos de piloto van dentro de
-- `cardumen_respuestas.payload` (jsonb), que es lo que existe.
--
-- ⚠️ ORDEN: primero DESPLEGAR `wa-webhook` (y `cardumen-cron`) con el codigo de este PR;
-- DESPUES correr este archivo. Si se corre antes del deploy, la palabra `cardumen` abriria
-- el entrevistador R1 viejo con este spec (que no trae dimensiones), no el motor Navigate.
--
-- Idempotente: se puede correr las veces que haga falta. Lo corre Mauricio a mano.
--
-- Efecto colateral deliberado: mientras esta fila exista y este activa, `cardumen` deja
-- de mandar el link a la mini-web FEDE (`sendCardumenLink`), porque el catalogo se
-- consulta ANTES que la palabra fija. Para volver a lo de hoy sin borrar nada:
--   update public.cardumen_estudios set activo = false where estudio = 'navigate';

insert into public.cardumen_estudios (estudio, nombre, modo, activo, publicable, claves_publicas, nota, spec)
values (
  'navigate',
  'Navigate — demo Grupo Progreso (Cardumen x Reframeit)',
  'chat',
  true,
  false,
  '{}',
  'DEMO comercial. Toda respuesta lleva payload.demo = true: no entra en ningun estudio ni en la vista publica. Capa A y flujo viven en codigo (supabase/functions/_shared/cardumen/navigate/).',
  $spec${
    "study_id": "navigate",
    "motor": "navigate",
    "title": "Navigate — demo Grupo Progreso (Cardumen x Reframeit)",
    "lang_default": "es",
    "collection_mode": "panel_recurrente",
    "context_note": "DEMO. El instrumento (Capa A) y el flujo viven en supabase/functions/_shared/cardumen/navigate/instrumento.ts; este spec solo declara el motor.",
    "elicitation_prompt": {
      "status": "OK",
      "literal_es": "Cuéntenos algo que haya visto, oído o vivido últimamente que le haya hecho pensar. Algo que podría estar anunciando un cambio, para bien o para mal.",
      "literal_en": "",
      "placeholder_es": "",
      "placeholder_en": ""
    },
    "narrative_fields": ["historia"],
    "triads": [],
    "dyads": [],
    "classification_metadata": ["poblacion", "sector", "idioma"],
    "closing": { "turn_cap": 30, "saturation_window": 2 }
  }$spec$::jsonb
)
on conflict (estudio) do update
   set nombre     = excluded.nombre,
       modo       = excluded.modo,
       activo     = excluded.activo,
       nota       = excluded.nota,
       spec       = excluded.spec,
       updated_at = now();

-- `do update` y no `do nothing`: si alguien apunto `cardumen` a otro estudio, aqui se
-- re-apunta a la vista, en vez de quedar en silencio con el estudio equivocado.
insert into public.cardumen_estudio_triggers (palabra, estudio)
values ('cardumen', 'navigate')
on conflict (palabra) do update set estudio = excluded.estudio;

-- Verificacion (correr aparte; debe devolver una fila cada una):
--   select palabra, estudio from public.cardumen_estudio_triggers where palabra = 'cardumen';
--   select estudio, modo, activo, publicable, spec->>'motor' as motor
--     from public.cardumen_estudios where estudio = 'navigate';
