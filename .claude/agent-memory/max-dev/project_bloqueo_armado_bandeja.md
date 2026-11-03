---
name: bloqueo-armado-bandeja
description: Bandeja de bloqueo que arma paquetes (#1408), botón «Marcar como Bloqueo» (#1407) y selector de modalidad en pausa (3-nov)
metadata:
  type: project
---

Al 2026-11-03:
- **#1408** (`fix/trappvel-bandeja-paquete-vuelo-hoteles`): en Bloqueo, el pegado de la bandeja va a `pegarEnBloqueo`, en cola y uno a la vez. Paquete = ranura «Paquete de bloqueo» = 1 vuelo; cada hotel es una opción de esa ranura. Paquete vigente = ranura con el número más alto. La opción nueva hereda Pública/Neta. El default sigue siendo Neta: Mauricio dice que las tarifas de ATN ya traen el 15 % (Pública). Queda propuesto que el default dependa del operador, sin decidir.
- **#1407** (`fix/trappvel-marcar-bloqueo-desde-cotizacion`): botón en la tarjeta «no es Bloqueo». NO reusa `actualizarBloqueData`, porque Condiciones del viaje es de Solicitud (etapa superada) y sin `corregir_campos_gerencial` ese guardado rechaza la escritura. La acción es estrecha (`cambiarModalidadDelViaje`): guardEditarBloque, RLS y traza de corrección `dato_posterior`. Mauricio marcó SAN ANDRÉS por SQL, así que perdió urgencia.
- El selector «Modalidad: A medida | Bloqueo» está en la rama `feat/trappvel-selector-modalidad-cotizacion` (encima de #1407), CANCELADO por ahora y sin PR.

**Why:** Tatiana tenía que cotizar el bloqueo de SAN ANDRÉS ya.
**How to apply:** si vuelve el selector, retargetear a main después del merge de #1407. CHD por edad con varias columnas (Koray tiene 2) no está construido. Relacionado: [[san-andres-precio-persona-zonas]], [[bloqueo-trappvel]].
