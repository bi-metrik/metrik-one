---
name: cifras-del-brief-caducan
description: Las cifras de QA que trae un brief se vuelven a medir AL HACER EL QA, no solo al empezar — otra sesión puede mover los datos de producción a mitad del encargo
metadata:
  type: feedback
---

Las cifras que un brief trae como criterio de aceptación se **re-miden en el momento del QA**,
no solo al arrancar. Si difieren de las del brief, manda la base y se reporta la diferencia
con su causa.

**Why:** el 2026-09-02, el brief de campañas en la vista general de contactos traía como QA
«MADELEINE PEREZ RUA: 3 formularios y 3 campañas» y «Más de una campaña: 26 contactos».
Medido al empezar: 988 contactos (el brief decía 1.029) y **44** con más de una campaña. Y al
llegar al QA, MADELEINE tenía **4 formularios y 4 campañas**. Nadie se equivocó: una sesión
paralela (`fusionar_contactos`, PR #497) estuvo **fusionando contactos duplicados en
producción** mientras se escribía el código, y cada fusión reparte interacciones sobre el
contacto que sobrevive. Escribir la prueba contra el número del brief la habría dejado roja
sin defecto, o —peor— habría llevado a «ajustar» el código para reproducir una cifra vieja.

La familia es la misma que el resto de gotchas de verificación del repo: **la base de Supabase
es una sola y compartida entre `main` y todas las ramas**, así que los datos se mueven debajo
del encargo.

**How to apply:**

- Medir al **empezar** (para decidir el diseño) y otra vez al **cerrar** (para afirmar el QA).
  Son dos mediciones, no una guardada.
- Fijar las pruebas contra **filas reales copiadas de la base**, con la fecha de medición en el
  comentario: así el día que la cifra cambie se ve que la prueba envejeció, en vez de parecer
  un defecto.
- En el reporte, decir explícitamente **qué cifra del brief ya no aplica y por qué**. Un
  brief con números viejos no es un brief equivocado: es un brief con fecha.

Relacionado: [[medir-antes-de-construir]], [[worktree-git-bloqueado]], [[sql-prod-one]].
