---
name: cardumen-filtro-blindaje
description: PR #924 filtro de riesgo/FT/INJ/CO antes del lector de Navigate; filtro caido NO es contencion; SIN mergear hasta repetir el benchmark
metadata:
  type: project
---

PR #924 (`fix/cardumen-navigate-blindaje`) — SIN mergear a proposito: Mauricio pidio repetir el
benchmark del lector (golden v1, Yuto/Saga) contra la rama antes. Sin migraciones. Mergear no
despliega `wa-webhook` (despliegue manual, lo hace la sesion principal).

**Why:** el benchmark del 24-sep mostro que el lector ubicaba el mensaje de crisis G28 y que no
habia red en codigo. La correccion del 25-sep (Mauricio, tras golden v1) invirtio una decision:
"mandarle un mensaje de crisis a una persona sin crisis tambien es dano".

**How to apply:**
- El filtro vive en `navigate/filtro.ts` y corre en `procesar` ANTES de meta y del lector; ademas
  `interpreteConModelo` lo aplica dentro de cada lectura (memo por texto), para que el benchmark,
  que llama `it.diada` directo, tambien pase por el.
- Filtro caido (lanza o sale del esquema) = `SIN_CLASIFICAR`/`fuente:"error"`: texto neutro
  `BANCO.errorTecnico`, sin pausa, no cuenta al tope, `integridad.fallos_filtro` + `revision_humana`.
  La contencion SOLO si palabras o modelo detectan SEN. No volver a "fallar hacia riesgo".
- CO (autocorreccion, G20) no es INJ: no cuenta al tope ni reinicia `seguidos`, repite la pregunta.
  Pierde contra marcas fuertes de manipulacion (`INJ_FUERTE`).
- G15: middle vs both_intense es FUERZA, no cantidad de polos (Saga). Guarda `medioQueEsAmbas`.
- Banco de textos PENDIENTE de Saga y Emilio; `CONTACTO_HUMANO_NAVIGATE = null` omite la linea.
- R1/R2 exige `spec.entrevistador_libre`; araucania-turismo y trappvel-equipo van por lista.
- Mutar el filtro para probarlo: el 24-sep el clasificador de auto mode lo bloqueo ("Security
  Weaken"); el 25-sep pasaron 3 mutaciones con commit previo y `git checkout --` para revertir.
  Ver [[pruebas-por-mutacion]].
