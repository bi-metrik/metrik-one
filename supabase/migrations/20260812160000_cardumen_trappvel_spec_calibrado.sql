-- Trappvel: calibracion del instrumento con la evidencia de la primera prueba humana (2026-08-12).
--
-- QUE MOSTRO LA PRUEBA (conversacion real, 12 turnos, medida en el historial de la sesion):
--
-- 1. SIETE repreguntas seguidas sobre la misma historia (turnos 5,7,9,11,13,15,17) y las
--    respuestas cayendo de 483 a 76 y 83 caracteres: la persona se quedo sin que responder y
--    el bot siguio. Las reglas de profundidad y de cierre se corrigieron en el motor.
--
-- 2. La SEGUNDA narrativa nunca se pregunto. El motor presenta la narrativa 2 cuando las
--    dimensiones de fase 1 estan cubiertas, y aqui 4 de las 5 estaban en fase 1: el bot
--    cubrio todo con una sola historia y se invento una transicion. Se reparten: T1 y D1
--    quedan en la historia del dia que sale bien; T2, D2 y D3 pasan a la del reproceso, que
--    es donde de verdad se ven.
--
-- 3. turn_cap 18 era el valor "conservador para cobertura" que dejo escrito el spec, con su
--    contrapeso anotado: protege cobertura y castiga la paciencia. La prueba dio el dato que
--    faltaba — con cobertura completa y las dos preguntas de cierre formuladas en el turno 10,
--    todo lo demas fue de mas. Baja a 12, que deja holgura sin dar para exprimir.
--
-- 4. C2 se reformula. Preguntaba "¿que te preocupa de que las cosas cambien?" y apunto directo
--    al miedo por el propio empleo (Mauricio, probandolo: "la pregunta sobre que me preocupa mi
--    trabajo"). Si incomoda a quien conoce todo el proyecto, a una asesora con su empleo en
--    juego le incomoda mas, y el material se devuelve en una reunion con su jefe presente. La
--    version nueva pregunta por EL CAMBIO, no por el estado de animo de la persona, y recoge lo
--    mismo que Saga buscaba: que resistencias y que riesgos percibe.

update public.cardumen_estudios
   set spec = jsonb_set(
         jsonb_set(
           jsonb_set(spec, '{closing}', '{"turn_cap": 12, "saturation_window": 2}'::jsonb),
           '{dyads}',
           (
             select jsonb_agg(
               case
                 when d->>'id' = 'D1' then jsonb_set(d, '{phase}', '1'::jsonb)
                 else jsonb_set(d, '{phase}', '2'::jsonb)
               end
               order by d->>'id'
             )
             from jsonb_array_elements(spec->'dyads') d
           )
         ),
         '{triads}',
         (
           select jsonb_agg(
             case
               when t->>'id' = 'T1' then jsonb_set(t, '{phase}', '1'::jsonb)
               else jsonb_set(t, '{phase}', '2'::jsonb)
             end
             order by t->>'id'
           )
           from jsonb_array_elements(spec->'triads') t
         )
       )
 where estudio = 'trappvel-equipo';

-- C2 reformulada (la clave del array se mantiene, cambia el literal)
update public.cardumen_estudios
   set spec = jsonb_set(
         spec, '{closing_questions}',
         (
           select jsonb_agg(
             case when q->>'id' = 'C2'
               then jsonb_set(
                      jsonb_set(q, '{literal_es}', '"Si cambia la forma de trabajar, ¿qué habría que cuidar para no perder algo que hoy funciona bien?"'::jsonb),
                      '{literal_en}', '"If the way of working changes, what would need to be protected so something that works today is not lost?"'::jsonb)
               else q end
             order by q->>'id'
           )
           from jsonb_array_elements(spec->'closing_questions') q
         )
       )
 where estudio = 'trappvel-equipo';
