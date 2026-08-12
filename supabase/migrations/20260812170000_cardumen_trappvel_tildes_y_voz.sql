-- Los literales del spec de Trappvel se habian escrito SIN tildes (descuido al armar el SQL),
-- y esos textos salen tal cual al participante: la primera pregunta llegaba como "Cuentame
-- como es un dia tuyo". Ademas se declara en el contexto que la conversacion es en espanol de
-- Colombia con tuteo, para no depender solo de la prohibicion de voseo del system prompt (el
-- guard determinista vive en _shared/es-neutro.ts).
update public.cardumen_estudios set spec =
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(spec,
    '{elicitation_prompt,literal_es}', '"Cuéntame cómo es un día tuyo cuando todo sale bien. ¿Qué hiciste, con quién te tocó cruzarte?"'::jsonb),
    '{elicitation_prompt,placeholder_es}', '"Cuéntame cómo es un día tuyo cuando todo sale bien."'::jsonb),
    '{second_elicitation,literal_es}', '"Ahora cuéntame de algo que hayas tenido que hacer dos veces. ¿Qué pasó?"'::jsonb),
    '{second_elicitation,placeholder_es}', '"Cuéntame de algo que hayas tenido que hacer dos veces."'::jsonb),
    '{context_note}', '"El equipo es de tres personas (el dueño y dos asesoras de viajes) en una agencia de viajes en Bogotá, Colombia. La conversación es en español de Colombia: tuteo, sin voseo."'::jsonb),
    '{title}', '"Trappvel — Voz del equipo (cómo se trabaja hoy)"'::jsonb),
    '{closing_questions}', (
      select jsonb_agg(case when q->>'id'='C1'
        then jsonb_set(q,'{literal_es}','"Si tuvieras una herramienta que hiciera sola la parte más aburrida de tu trabajo, ¿qué le pondrías a hacer de primero?"'::jsonb)
        else q end order by q->>'id')
      from jsonb_array_elements(spec->'closing_questions') q))
where estudio='trappvel-equipo';
