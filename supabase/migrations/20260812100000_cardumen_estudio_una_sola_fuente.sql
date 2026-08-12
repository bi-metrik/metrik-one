-- Cardumen: el estudio activo pasa a tener UNA sola fuente (el catalogo), y deja de
-- estar repartido entre un import fijo, una constante y una env var.
--
-- EL PROBLEMA, medido en el codigo desplegado (no supuesto):
--
-- El webhook tiene cuatro vias de captura y CADA UNA decide el estudio por su cuenta:
--   1. `cardumen`      -> link a la mini-web con `estudio=${CARDUMEN_ESTUDIO}`, donde ese
--                         CARDUMEN_ESTUDIO es una CONSTANTE de TypeScript = 'fede'
--                         (wa-webhook/index.ts).
--   2. `cardumenflow`  -> Flow; al guardar usa `Deno.env.get('CARDUMEN_ESTUDIO') || 'fede'`,
--                         o sea una ENV VAR que se llama igual que la constante y NO es la misma.
--   3. `cardumenchat`  -> chat R1/R2 con el spec IMPORTADO de `_shared/cardumen/spec.ts`
--                         (hoy Araucania) y guarda con esa misma env var.
--   4. `turismo`       -> link a la mini-web con `estudio=turismo` literal en la URL.
--
-- Consecuencias reales:
--   (a) NO se puede correr dos estudios a la vez: el spec del chat es un import y el
--       estudio guardado una variable global. Trappvel exigiria apagar Araucania.
--   (b) El estudio que se GUARDA puede no ser el del spec que se USO. Ya paso: las 3
--       respuestas de `cardumen_respuestas` etiquetadas `estudio='fede'` contienen
--       narrativas de La Araucania ("La Araucania es una region con bastantes
--       necesidades y oportunidades..."), porque el spec era el de Araucania y la
--       etiqueta salio de la env var. **Ese dato mal etiquetado NO se corrige aqui:**
--       distinguirlo exige criterio de metodo y es decision de Saga, no del codigo.
--
-- Es la misma familia de defectos que este repo ya documenta: un mismo dato escrito por
-- varios caminos termina con varios vocabularios, y que dos de ellos se llamen igual es
-- peor que dos olvidos.
--
-- LA SOLUCION: `cardumen_estudios` (creada el 2026-08-11 para la vista publica) pasa a
-- ser tambien el catalogo de captura. El trigger que escribe la persona resuelve la fila,
-- y de esa fila salen el spec y el slug con el que se guarda. Una fila = un estudio.
--
-- RETROCOMPATIBLE: si el trigger no resuelve ninguna fila, el webhook se comporta como
-- hoy (palabra `cardumenchat` + spec importado). El default reproduce el comportamiento
-- previo, no la regla nueva.

alter table public.cardumen_estudios
  add column if not exists nombre  text,
  add column if not exists modo    text,
  add column if not exists spec    jsonb,
  add column if not exists activo  boolean not null default true;

comment on column public.cardumen_estudios.modo is
  'Como se captura: chat (entrevistador R1/R2 en WhatsApp) | miniweb | flow. Determina que via del webhook lo atiende.';
comment on column public.cardumen_estudios.spec is
  'Study-spec completo para modo chat. NULL = usa el spec importado en _shared/cardumen/spec.ts (comportamiento previo).';
comment on column public.cardumen_estudios.activo is
  'false = el trigger deja de abrirlo. No borra el estudio ni sus respuestas.';

alter table public.cardumen_estudios
  drop constraint if exists cardumen_estudios_modo_check;
alter table public.cardumen_estudios
  add constraint cardumen_estudios_modo_check
  check (modo is null or modo in ('chat', 'miniweb', 'flow'));

-- Triggers en tabla aparte, con la palabra como PRIMARY KEY: asi la base garantiza que
-- una palabra no puede abrir dos estudios. Con un array por fila esa ambiguedad quedaria
-- resuelta por el orden de la consulta, que es la peor clase de fallo: intermitente y no
-- reproducible.
create table if not exists public.cardumen_estudio_triggers (
  palabra    text primary key,
  estudio    text not null references public.cardumen_estudios(estudio) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.cardumen_estudio_triggers is
  'Palabra (normalizada: minuscula, sin puntuacion) que abre un estudio de Cardumen. La PK garantiza que ninguna palabra abra dos.';

create index if not exists cardumen_estudio_triggers_estudio_idx
  on public.cardumen_estudio_triggers (estudio);

alter table public.cardumen_estudio_triggers enable row level security;

-- server-only: lo consulta el webhook con service_role. Ningun cliente lo lee ni escribe.
revoke all on public.cardumen_estudio_triggers from anon, authenticated;

-- Datos: los dos estudios de chat -------------------------------------------------------
-- Araucania conserva su palabra y su spec importado (spec NULL) => cero cambio de
-- comportamiento para el estudio que hoy esta vivo.
update public.cardumen_estudios
   set nombre = 'La Araucania — Voz del empresario',
       modo   = 'chat'
 where estudio = 'araucania-turismo';

insert into public.cardumen_estudio_triggers (palabra, estudio) values
  ('cardumenchat',  'araucania-turismo'),
  ('cardumen chat', 'araucania-turismo')
on conflict (palabra) do nothing;

-- Trappvel: spec completo en la fila, y su propia palabra. Corre en paralelo con
-- Araucania sin apagar nada.
update public.cardumen_estudios
   set nombre = 'Trappvel — Voz del equipo',
       modo   = 'chat',
       spec   = $spec${
  "study_id": "trappvel-equipo",
  "title": "Trappvel — Voz del equipo (como se trabaja hoy)",
  "lang_default": "es",
  "collection_mode": "study_async",
  "context_note": "El equipo es de tres personas (el dueno y dos asesoras de viajes) en una agencia de viajes en Bogota, Colombia.",
  "elicitation_prompt": {
    "status": "OK",
    "literal_es": "Cuentame como es un dia tuyo cuando todo sale bien. ¿Que hiciste, con quien te toco cruzarte?",
    "literal_en": "Tell me about a day of yours when everything goes well. What did you do, who did you have to deal with?",
    "placeholder_es": "Cuentame como es un dia tuyo cuando todo sale bien.",
    "placeholder_en": "Tell me what a good day looks like for you."
  },
  "second_elicitation": {
    "status": "OK",
    "literal_es": "Ahora cuentame de algo que hayas tenido que hacer dos veces. ¿Que paso?",
    "literal_en": "Now tell me about something you had to do twice. What happened?",
    "placeholder_es": "Cuentame de algo que hayas tenido que hacer dos veces.",
    "placeholder_en": "Tell me about something you had to do twice."
  },
  "narrative_fields": ["DiaQueSaleBien", "AlgoHechoDosVeces"],
  "triads": [
    { "id": "T1", "phase": 1, "theme_es": "De que dependio el resultado", "theme_en": "What the outcome depended on",
      "apex_es": ["Mi propio criterio", "Que alguien me respondiera", "Lo que hizo un tercero (hotel, aerolinea, proveedor)"],
      "apex_en": ["My own judgement", "Someone answering me", "What a third party did (hotel, airline, supplier)"] },
    { "id": "T2", "phase": 1, "theme_es": "Como se resolvio", "theme_en": "How it got resolved",
      "apex_es": ["Como siempre lo hacemos", "Improvisando en el momento", "Preguntando"],
      "apex_en": ["The way we always do it", "Improvising on the spot", "By asking"] }
  ],
  "dyads": [
    { "id": "D1", "phase": 1, "theme_es": "Informacion disponible", "theme_en": "Available information",
      "poles_es": ["tenia toda la informacion que necesitaba", "tuve que adivinar"],
      "poles_en": ["I had all the information I needed", "I had to guess"] },
    { "id": "D2", "phase": 1, "theme_es": "A quien le correspondia decidir", "theme_en": "Whose decision it was",
      "poles_es": ["la decision me correspondia a mi", "la decision no me correspondia"],
      "poles_en": ["the decision was mine to make", "the decision was not mine to make"] },
    { "id": "D3", "phase": 2, "theme_es": "Frecuencia (la piedra)", "theme_en": "Frequency (the stone)",
      "poles_es": ["esto me pasa seguido", "esto fue algo excepcional"],
      "poles_en": ["this happens to me often", "this was exceptional"] }
  ],
  "closing_questions": [
    { "id": "C1", "literal_es": "Si tuvieras una herramienta que hiciera sola la parte mas aburrida de tu trabajo, ¿que le pondrias a hacer de primero?", "literal_en": "If you had a tool that did the most boring part of your job by itself, what would you set it to do first?" },
    { "id": "C2", "literal_es": "¿Que te preocupa de que las cosas cambien?", "literal_en": "What worries you about things changing?" }
  ],
  "classification_metadata": ["Rol", "Antiguedad"],
  "closing": { "turn_cap": 18, "saturation_window": 2 }
}$spec$::jsonb
 where estudio = 'trappvel-equipo';

insert into public.cardumen_estudio_triggers (palabra, estudio) values
  ('trappvel', 'trappvel-equipo')
on conflict (palabra) do nothing;
