// Spec del estudio FEDE/GCG — Capa A CONGELADA (literal del instrumento maestro cardumen-app).
// Inline como const (los Edge Functions no leen JSON de disco facil). La IA nunca la modifica.

import type { StudySpec } from "./types.ts";

export const FEDE_SPEC: StudySpec = {
  study_id: "fede-gcg",
  title: "FEDE / GCG — Pequena mineria",
  lang_default: "es",
  collection_mode: "study_async",
  elicitation_prompt: {
    status: "PENDIENTE_LITERAL",
    placeholder_es:
      "Cuentanos una experiencia reciente en tu comunidad relacionada con la mineria y la GCG: algo que te haya pasado o que hayas visto, contado con tus propias palabras.",
    placeholder_en:
      "Tell us about a recent experience in your community related to mining and GCG: something that happened to you or that you saw, in your own words.",
  },
  narrative_fields: ["FragmentEntry", "Title", "Utopia", "Dystopia"],
  triads: [
    { id: "T1", theme_es: "Principals", theme_en: "Principals",
      apex_es: ["Las necesidades de la comunidad", "Los lideres politicos", "Las necesidades del negocio"],
      apex_en: ["Community needs", "Political leaders", "Business needs"] },
    { id: "T2", theme_es: "Mindset", theme_en: "Mindset",
      apex_es: ["Construir mejores sistemas", "Mantener las cosas como estan", "Imaginar nuevas posibilidades"],
      apex_en: ["Build better systems", "Keep things as they are", "Imagine new possibilities"] },
    { id: "T3", theme_es: "Impact felt", theme_en: "Impact felt",
      apex_es: ["La vida de todos", "La forma de ganarse la vida", "El entorno"],
      apex_en: ["Everyone's life", "How people make a living", "The environment"] },
    { id: "T4", theme_es: "Time", theme_en: "Time",
      apex_es: ["Como siempre ha sido", "Las preocupaciones que tengo ahora", "Consideraciones futuras"],
      apex_en: ["As it has always been", "My current concerns", "Future considerations"] },
    { id: "T5", theme_es: "Values", theme_en: "Values",
      apex_es: ["Lo que es correcto", "Lo mejor para todos", "Lo que dicen las normas"],
      apex_en: ["What is right", "What is best for all", "What the rules say"] },
    { id: "T6", theme_es: "Opportunities", theme_en: "Opportunities",
      apex_es: ["Conseguir cosas materiales", "Mejorar su bienestar", "Mejorar el lugar donde todos vivimos"],
      apex_en: ["Get material things", "Improve their wellbeing", "Improve where we all live"] },
    { id: "T7", theme_es: "Contribution", theme_en: "Contribution",
      apex_es: ["Aportan ideas y formas utiles", "Tienen un objetivo claro", "Unen y mobilizan a la gente"],
      apex_en: ["Offer useful ideas and ways", "Have a clear goal", "Unite and mobilize people"] },
  ],
  dyads: [
    { id: "D1", theme_es: "Giving people", theme_en: "Giving people",
      poles_es: ["Lo que querian", "Lo que necesitaban"], poles_en: ["What they wanted", "What they needed"] },
    { id: "D2", theme_es: "Control", theme_en: "Control",
      poles_es: ["Bajo el control de la comunidad", "Liderado por GCG"], poles_en: ["Under community control", "GCG-led"] },
  ],
  classification_metadata: ["Lugar", "Antiguedad", "Ocupacion", "Sector"],
  closing: { turn_cap: 12, saturation_window: 2 },
};
