-- Trappvel: repone la P2 del instrumento aprobado ("una vez en que toco resolver algo sin
-- poder consultarle a nadie"). El encuadre del bot anuncia CINCO preguntas y el spec solo
-- tenia cuatro: dos narrativas y dos de cierre. La P2 no estaba entre las que se movieron a
-- las entrevistas individuales, asi que su ausencia era un descuido del spec, no una decision.
--
-- Entra como PRIMERA pregunta de cierre. El motor solo admite dos narrativas, y las de cierre
-- se escuchan sin profundizar: recoge el caso pero no lo repregunta. Es la limitacion aceptada
-- (decision de Mauricio, 2026-08-12) a cambio de tener el instrumento completo.
--
-- Idempotente: si A1 ya esta, no hace nada.

update cardumen_estudios
set spec = jsonb_set(
      spec,
      '{closing_questions}',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'A1',
          'literal_es', 'Cuéntame de una vez en que tocó resolver algo sin poder consultarle a nadie. ¿Qué hiciste?',
          'literal_en', 'Tell me about a time you had to sort something out without being able to ask anyone. What did you do?'
        )
      ) || coalesce(spec->'closing_questions', '[]'::jsonb)
    ),
    updated_at = now()
where estudio = 'trappvel-equipo'
  and not coalesce(spec->'closing_questions', '[]'::jsonb) @> '[{"id":"A1"}]'::jsonb;
