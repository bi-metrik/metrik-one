// Spec del estudio ACTIVO: La Araucania — "hacer negocios" (voz del empresario).
// Capa A CONGELADA, literal de cardumen-app/turismo.html. Dos narrativas (experiencia + proximo paso),
// dimensiones agrupadas por fase. La IA nunca la modifica.

import type { StudySpec } from "./types.ts";

export const STUDY_SPEC: StudySpec = {
  study_id: "araucania-turismo",
  title: "La Araucania — Voz del empresario (hacer negocios en la region)",
  lang_default: "es",
  collection_mode: "study_async",
  elicitation_prompt: {
    status: "OK",
    literal_es:
      "Uno de tus amigos esta interesado en entender lo que es hacer negocios en La Araucania. ¿Que experiencia compartirias con el/ella para ayudarle a entender como es? Puede ser una experiencia para animarlo/a a montar un negocio, o para darle un consejo, o sugerir cosas a tener en cuenta.",
    literal_en:
      "A friend of yours wants to understand what doing business in La Araucania is like. What experience would you share to help them understand?",
    placeholder_es: "",
    placeholder_en: "",
  },
  second_elicitation: {
    status: "OK",
    literal_es:
      "¿Que oportunidades o desafios ves para La Araucania? Cuentame lo que crees que deberia ser el proximo paso para la region.",
    literal_en:
      "What opportunities or challenges do you see for La Araucania? Tell me what you think the next step should be.",
    placeholder_es: "",
    placeholder_en: "",
  },
  narrative_fields: ["story1", "title", "story2"],
  triads: [
    { id: "Q3", phase: 1, theme_es: "Sentido", theme_en: "Sensemaking",
      apex_es: ["Le encuentra sentido a las cosas", "Trabaja y maneja las situaciones", "Encuentra lo que es significativo e importante"],
      apex_en: ["Makes sense of things", "Works and handles situations", "Finds what is meaningful and important"] },
    { id: "Q4", phase: 1, theme_es: "Consideraciones del negocio", theme_en: "Business considerations",
      apex_es: ["La influencia de otras regiones", "Las necesidades de la region", "El Medio Ambiente y el contexto"],
      apex_en: ["Influence of other regions", "Needs of the region", "Environment and context"] },
    { id: "Q5", phase: 1, theme_es: "Influencia", theme_en: "Influence",
      apex_es: ["Su comunidad", "Ellos mismos", "Todos los chilenos"],
      apex_en: ["Their community", "Themselves", "All Chileans"] },
    { id: "Q10", phase: 2, theme_es: "Enfoque del proximo paso", theme_en: "Next-step approach",
      apex_es: ["Mantener lo que esta funcionando", "Construir nuevos sistemas", "Imaginar otras posibilidades"],
      apex_en: ["Keep what works", "Build new systems", "Imagine other possibilities"] },
    { id: "Q11", phase: 2, theme_es: "Agencia", theme_en: "Agency",
      apex_es: ["La comunidad / la sociedad civil", "Las empresas / los negocios", "El gobierno"],
      apex_en: ["Community / civil society", "Companies / businesses", "Government"] },
    { id: "Q12", phase: 2, theme_es: "Foco", theme_en: "Focus",
      apex_es: ["La gente y sus habilidades", "La tecnologia y la infraestructura", "Los procesos y procedimientos"],
      apex_en: ["People and skills", "Technology and infrastructure", "Processes and procedures"] },
  ],
  dyads: [
    { id: "Q9", phase: 2, theme_es: "Probabilidad", theme_en: "Probability",
      poles_es: ["Muy probable", "Muy improbable"], poles_en: ["Very likely", "Very unlikely"] },
    { id: "Q13", phase: 2, theme_es: "Flexibilidad vs estructura", theme_en: "Flexibility vs structure",
      poles_es: ["Flexibilidad y espacio para explorar", "Estructura y claras directrices"], poles_en: ["Flexibility and room to explore", "Structure and clear guidelines"] },
    { id: "Q14", phase: 2, theme_es: "Horizonte", theme_en: "Time horizon",
      poles_es: ["el corto plazo", "el largo plazo"], poles_en: ["short term", "long term"] },
    { id: "Q15", phase: 2, theme_es: "Sector", theme_en: "Sector influence",
      poles_es: ["El sector privado", "El sector publico"], poles_en: ["Private sector", "Public sector"] },
  ],
  classification_metadata: ["Rol", "Comuna", "Sector"],
  closing: { turn_cap: 16, saturation_window: 2 },
};

// Alias para no tocar el resto del modulo (index.ts importa el spec por este nombre).
export { STUDY_SPEC as FEDE_SPEC };
