---
name: arnes-real-comparar-entrada
description: Un fallo del arnés con modelo real en una rama se separa de la variancia comparando byte a byte lo que ve el modelo en main y en la rama (guion + git archive), no corriendo más veces
metadata:
  type: feedback
---

Ante un fallo del arnés real que el coordinador atribuye a la rama, NO aceptar «es ruido» sin evidencia: capturar el
pedido al modelo (sistema, mensajes, herramientas) de los mismos turnos con un `modeloGuionado` que graba, sobre
`git archive origin/main supabase/functions` y sobre la rama, y hacer diff.

**Why:** 2026-10-21 (#1230): r-t-base cayó en «gasto de empresa». El diff mostró que mi rama sí cambiaba la entrada
(fichas nuevas en «siempre», línea del Estado quitada); en cambio r-audio/r-ambiguo/r-fuera de la bandeja daban entrada
IDÉNTICA a main → preexistentes. Sin llave no se pueden repetir corridas; el diff es la evidencia barata.

**How to apply:** script en scratchpad que importa por `file://<raiz>/supabase/functions/_shared/agente/...`; normalizar
horas e ids antes del diff. Si la entrada cambia, reducir el cambio (fichas al índice) Y poner un candado estructural
para el daño (aquí: `revisarRespuesta`, la lista con «Gasto de empresa» solo la arma el código).
