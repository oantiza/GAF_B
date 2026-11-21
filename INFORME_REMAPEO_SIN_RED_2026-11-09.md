# Re-mapeo sin red: qué pierde y qué no (medición del 09-11-2026)

Encargo de medición de la incidencia «Un re-mapeo entero sin red no es neutro: pierde FIRDS en 27 fichas». No se ha
cambiado código del extractor, ni la base nueva, ni la nube.

## Conclusión

**La incidencia está al revés: un re-mapeo sin red no quita FIRDS a ninguna ficha. Las 27 fichas lo ganan.**

- Medido sobre 1.316 instrumentos: **0 fichas pierden ningún campo de FIRDS**, y **27 fondos ganan los diez campos**.
  La cifra de 27 es exacta; la dirección no. El estado de partida es el mismo del 08-11, porque las 1.305 fichas se
  devolvieron a su copia previa.
- **FIRDS no depende de la red.** El adaptador lee `cache/firds/firds.sqlite`, y `--sin-red` solo gobierna las peticiones
  HTTP. La hipótesis de la incidencia («algún campo vive solo en la respuesta de la red») no se sostiene en el código ni
  en la medida.
- **El riesgo real de pérdida de FIRDS es otro, y sí existe:** si falta el índice, o un ISIN sale de él, la identidad
  desaparece en silencio. Comprobado en copia: 3 de 3 fichas la perdieron sin aviso, sin error y sin que la guarda de
  calidad parara nada. Hoy no le ocurre a ninguna ficha.
- **`refrescar.mjs` no corre ninguna pasada sin red.** El daño descrito no podía llegar a la base por esa vía.
- **Que el re-mapeo no es neutro sigue siendo cierto, por otras razones:** 198 acciones pasan a llevar `dato_retenido`, y
  8 fondos caen de ALTO a BAJO porque la fecha de la pasada avanza con el mismo valor liquidativo.

## Cómo se midió

- Copia completa de `1-extractor` (sin `.git`) en una carpeta de trabajo fuera del repositorio. `main.py` toma su raíz de
  su propia ubicación, así que `update` escribe solo en la copia.
- **Control:** `calidad` → `export` → `bdb` sobre la copia sin tocar. Resultado idéntico al real: 1.323 fichas en
  `data/funds` y 1.316 en el canónico, 0 diferencias, mismo hash. Sin este control, cualquier diferencia podría deberse
  a la fecha del día.
- **Pasada:** `update --all --sin-red --sin-caducidad --sin-historico`, y otra vez `calidad` → `export` → `bdb`. 0
  peticiones a red, 27.420 de caché, 158 sin caché.
- **Comparación ruta a ruta** de control contra pasada en `export/fondos.ndjson`, `data/funds` y `export_bdb/`.
- **Intacto, comprobado al terminar:** `export/fondos.ndjson` real con hash `c088fa9b…c94c5` antes y después, y
  `git status` del extractor limpio, en `6600196`.

## Qué cambia

Sobre 1.316 fichas del canónico:

| Grupo | Fichas | Qué es |
|---|---:|---|
| Idénticas | 4 | Ni un byte |
| Solo sellos de la pasada | 648 | `actualizado`, `meta.adquisicion`, y fechas de comprobación o de visto (30 con el criterio estricto y 618 más con estas fechas) |
| Procedencia y retención | 595 | 495 acciones y 100 fondos. Etiquetas `retenido:` y `meta.fuentes` |
| Calidad | 67 | 63 fondos y 4 acciones |
| Ganan FIRDS | 27 | 27 fondos. Tabla abajo |
| Guarda de calidad: actualización parcial | 10 | Solo `meta.actualizacion_parcial` |

Un grupo no excluye a otro: una ficha puede estar en varios. El bloque `emisor`, el valor liquidativo y su fecha no
cambian en ninguna ficha.

### Campos de FIRDS

| Campo | Pierden | Ganan | Cambian |
|---|---:|---:|---:|
| `identificacion.cfi` y `cfi_tipo` | 0 | 27 | 0 |
| `identificacion.lei_emisor` | 0 | 27 | 0 |
| `identificacion.mercados_ue` (202 centros en total) | 0 | 27 | 0 |
| `identificacion.autoridad_competente_firds` | 0 | 27 | 0 |
| `identificacion.divisa_nominal_firds` | 0 | 27 | 0 |
| `identificacion.nombre_oficial_firds` y `nombre_corto_firds` | 0 | 27 | 0 |
| `meta.firds_visto` | 0 | 27 | 0 |

El país no es un campo de FIRDS aparte: lo que FIRDS da es la autoridad competente. `baja_en_todos_firds` no aparece en
ninguna ficha, antes ni después. En `export_bdb/` se ve lo mismo: `identidad_firds` entra en esas 27 y no sale de ninguna.

### Las 27 fichas que ganan FIRDS

| ISIN | Nombre | CFI | Tipo | LEI | Autoridad | Centros | Visto |
|---|---|---|---|---|---|---:|---|
| DE0005318406 | DWS ESG Stiftungsfonds LD | CIOILU | FONDO | 5493003ROQDYOKYRFJ60 | DE | 14 | 2026-10-31 |
| DE000DWS17J0 | DWS ESG Dynamic Opportunities LC | CIOGLU | FONDO | 549300K1EGUJKQ2Z1349 | DE | 9 | 2026-10-31 |
| ES0132526031 | OPORTUNIDAD BURSATIL, S.A., SICAV | CIOGLS | FONDO | 95980020140005389691 | ES | 1 | 2026-10-31 |
| FR0011253624 | R-co Valor C EUR | CIXXXX | FONDO | 9695005DN5QLA24VMP19 | DE | 7 | 2026-10-31 |
| IE00B8J38129 | Algebris UCITS Funds plc - Algebris Financial Credit | CMXXXS | FONDO | 5493007EKRT33WKV7H33 | DE | 3 | 2026-10-31 |
| IE00BYYPF474 | Aegon Global Diversified Income Fund A Acc EUR | CMXXXS | FONDO | 213800P4B14T1IBZX714 | DE | 3 | 2026-10-31 |
| LU0034353002 | DWS Floating Rate Notes LC | CIOIBS | FONDO | 549300FDG1MK13OUND45 | DE | 14 | 2026-10-31 |
| LU0048293368 | BL-Global 75 B EUR Acc | CMXXXS | FONDO | 529900HTWYRE4BD0GQ69 | DE | 13 | 2026-10-31 |
| LU0080237943 | DWS Euro Ultra Short Fixed Income Fund NC | CIOIMS | FONDO | 549300MKL56PER7UJQ26 | DE | 15 | 2026-10-31 |
| LU0087412390 | DWS Concept DJE Alpha Renten Global LC | CIOGES | FONDO | 549300LIRNC3J3R3AW93 | DE | 15 | 2026-10-31 |
| LU0102737730 | Invesco Funds - Invesco Euro Ultra-Short Term Debt F | CIOGMS | FONDO | 549300GBCZXE5EZTY434 | DE | 13 | 2026-10-31 |
| LU0251660279 | AXA World Funds - Euro Strategic Bonds E Capitalisat | CIOGBS | FONDO | 2138006GTA831JB41E69 | DE | 2 | 2026-10-31 |
| LU0273159177 | DWS Invest Gold and Precious Metals Equities LC | CIOGES | FONDO | 5493004E7FMYARX6NX55 | DE | 13 | 2026-10-31 |
| LU0352312184 | Allianz Strategy 50 CT EUR | CIOGBS | FONDO | 529900U565TVTIRHJ104 | DE | 11 | 2026-10-31 |
| LU0352312853 | Allianz Strategy 75 CT EUR | CIOGBS | FONDO | 529900589OY2G0CVOT53 | DE | 8 | 2026-10-31 |
| LU0599946893 | DWS Concept Kaldemorgen EUR LC | CIOGES | FONDO | 549300Q2LE5ES354XA11 | DE | 15 | 2026-10-31 |
| LU0599947198 | DWS Concept Kaldemorgen EUR NC | CIOGES | FONDO | 549300Q2LE5ES354XA11 | DE | 15 | 2026-10-31 |
| LU1164219682 | AXA World Funds - Euro Credit Total Return A Capital | CIOGMX | FONDO | 213800FPDKN4GVHVJI39 | DE | 3 | 2026-10-31 |
| LU1481583711 | Flossbach von Storch - Bond Opportunities RT | CIOGBX | FONDO | 529900STNWWRK4MM7H18 | DE | 3 | 2026-10-31 |
| LU1548496022 | Allianz Global Investors Fund - Allianz Dynamic Mult | CIOGEX | FONDO | 549300PQDMLKLFQGT068 | DE | 2 | 2026-10-31 |
| LU1594335520 | Allianz Global Investors Fund - Allianz Dynamic Mult | CIOGEX | FONDO | 549300MVGM26JNLKWO33 | DE | 3 | 2026-10-31 |
| LU1679113404 | UBS (Lux) Bond SICAV - Floating Rate Income (USD) (E | CIOGBX | FONDO | 5493002XL8VWILLFGP81 | DE | 3 | 2026-10-31 |
| LU1740985814 | DWS Strategic Dynamic LD | CIOIEX | FONDO | 549300AZ897RVVOGIL41 | DE | 5 | 2026-10-31 |
| LU1868537090 | DWS Invest ESG Dynamic Opportunities LC | CIOGLS | FONDO | 549300F0344VG88EO126 | DE | 5 | 2026-10-31 |
| LU1965927921 | DWS Invest ESG Floating Rate Notes LC | CIOGBX | FONDO | 54930035UIUSLZ2H7R96 | DE | 3 | 2026-10-31 |
| LU2050544563 | DWS ESG Multi Asset Dynamic LC | CIOGEX | FONDO | 549300FYQUMHSMVHMI93 | DE | 3 | 2026-10-31 |
| LU2697545163 | BlackRock Global Funds - Euro High Yield Fixed Matur | CIOGBS | FONDO | 529900M7BKCCZ7Z11H58 | LU | 1 | 2026-10-31 |

Las 27 son fondos con `meta.actualizado` del 05-11, y su plan guardado no incluye `esma_firds`. El adaptador se añadió
después, y estas fichas no se habían vuelto a escribir con él (ninguna de las 27 lo tiene en el plan; las 805 con FIRDS, sí).
Hoy el canónico tiene 511 fichas sin `firds_visto`: 33 están en el índice y 478 no. De las 33, estas 27 lo ganan y 6 siguen
sin él porque la guarda de calidad conserva su ficha: 3 acciones (ES0114400007, ES0125140A14, ES0158300410) y 3 fondos
(LU0153585137, LU0926439992, LU1127969597).

### Lo que cambia sin ser FIRDS

**Calidad (67 fichas).** La causa de las 63 de fondos es `vl_antiguo`, y es mecánica: `_dias_vl` cuenta de la fecha del
VL a la de la pasada (`meta.actualizado`). Un re-mapeo sin red adelanta esa fecha y el VL se queda igual. En ocho fondos
la alerta nueva es la cuarta, y con cuatro alertas el grupo pasa a BAJO aunque el `score` siga en 79-80:

| ISIN | Nombre | Antes | Después |
|---|---|---|---|
| ES0110407006 | Gestión Boutique VI, FI | ALTO 85 | BAJO 80 |
| ES0114904008 | Brightgate Focus, FI | ALTO 85 | BAJO 80 |
| ES0158600033 | Sigma Investment House Flexible Global | ALTO 85 | BAJO 80 |
| ES0162296000 | Cartera Renta Fija Horizonte 2028, FI | ALTO 85 | BAJO 80 |
| ES0173985005 | River Patrimonio, FI | ALTO 85 | BAJO 80 |
| FR0011253624 | R-co Valor C EUR | ALTO 84 | BAJO 79 |
| LU0501220429 | Global Evolution Funds - Frontier Markets | ALTO 84 | BAJO 79 |
| LU2278574715 | Buy & Hold Luxembourg B&H Flexible | ALTO 84 | BAJO 79 |

Las 4 acciones con cambio de calidad son Snam, Terna, Unipol y Nexi (`score` de 91 a 82, sin cambio de grupo): ver
«Menores». En los fondos la causa no es la red en sí: cualquier re-mapeo días después da lo mismo. Con red, en cambio, el
VL llegaría fresco.

**Retención (`dato_retenido`).** 198 acciones más la llevan en `validation.warnings` y `quality.warnings`: 296 antes y 494
después, con 0 que dejen de llevarla. Sin red no se puede preguntar a Yahoo, así que `retencion_acciones` conserva los
fundamentales y la identidad con etiqueta `retenido:eodhd…`. El dato se conserva y la procedencia dice la verdad. La
antigüedad máxima retenida es 162 días, en identidad, con límite de 365. No hay ningún descarte por caducidad. La
palabra `dato_retenido` no aparece en `2-plataforma-datos`.

**Guarda de calidad (17 fichas).** Sin red, las fuentes que no tienen caché devuelven menos datos y la guarda protege la
ficha: 10 fondos con actualización parcial, 2 fondos sin sobrescribir (LU2050929277, LU0251661590) y 5 acciones que
conservan su ficha, 3 de ellas aplicando su baja decidida (ES0114400007, ES0125140A14, ES0161560018) y 2 sin sobrescribir
(ES0143416115, ES0158300410). Funciona como debe.

**Menores.** Cuatro acciones italianas (Snam, Terna, Unipol, Nexi) dejan de llevar `sector` e `industria` como cadena
vacía. No se pierde contenido, pero su `score` baja de 91 a 82: la cadena vacía contaba como esencial presente, y por tanto
el 91 estaba inflado. Inmocemento y Duro Felguera ganan `cotizacion_aviso: mercado_de_origen_no_disponible`.
AXA Switzerland (LU0184627536) relee un trozo distinto del texto de su KID. Dos acciones actualizan una fecha en el
conflicto de disponibilidad.

## La causa en el código

**Comprobado:**

1. **De dónde salen.** `fetchers/esma_firds.py`, función `fetch`: lee `cache/firds/firds.sqlite` con los diez campos. Tiene
   CFI, LEI, autoridad, divisa, nombres, y por centro admisión, primera negociación y baja.
2. **Qué guarda la «caché».** La tabla SQLite contiene todos los campos. No pasa por `core/http`, y `--sin-red` no la
   afecta: la bandera solo llega a `Http`.
3. **Cuándo entra.** `ESMA_FIRDS` es `oficial=True`, así que `planifica` lo incluye siempre. Ni `--fuentes` ni `--familias`
   lo recortan. La pasada de hoy lo corrió en todos.
4. **Dónde se perdería si se perdiera.** `esma_firds.fetch` devuelve `{}` si el fichero no existe o si el ISIN no está. `merge`
   solo ve lo que traen las fuentes, y `retencion.REGLAS` y `retencion.REGISTROS` no incluyen ninguna ruta de FIRDS (`REGISTROS`
   lleva `esma`, que es otro registro). `retencion_acciones` tampoco. `quality_regression_reason` no mira FIRDS.
5. **Prueba de ese camino, en la copia.** Con `firds.sqlite` apartado, `update` de una acción, un fondo y un ETF: los tres
   escriben la ficha sin FIRDS, `esma_firds sin datos`, sin error, sin aviso y con la guarda sin actuar. Pérdida total de los
   campos en 3 de 3.

**Supuesto, no comprobado:**

- **Por qué la nota del 08-11 dice «pierden».** La explicación más probable es que la comparación se leyó invertida, por
  la coincidencia exacta de 27 y porque el estado de partida es el mismo. No he encontrado la transcripción ni el script de
  aquella sesión, así que no lo puedo afirmar.
- **Si `baseNueva:write` borraría `identidad_firds`** de un documento cuando el canónico deja de traerla. `mapper.ts` no lo
  escribe si falta, pero no he seguido lo que hace el escritor con lo que ya estaba.
- **Si un ISIN sale de un FULINS completo:** no hay medida. Hoy ninguna ficha lleva `baja_en_todos_firds`.

## `refrescar.mjs`

Corre `main.py firds --sin-deltas` y luego `main.py update --all`, con `--familias precio,rendimiento` salvo que se pida
`--completo`. **No usa `--sin-red`.** Tampoco lo hacen `2-plataforma-datos`, `ops_server.py`, `ops_plataforma.py` ni
`app.py` (búsqueda en esos ficheros y carpetas). Si `firds` falla, `paso` para el proceso con salida 2 y no sigue.

Una pérdida de FIRDS podría llegar a la base por tres vías, y ninguna es la de la incidencia: un `update` sobre un equipo
sin índice (`cache/` no va al repositorio), `--sin-firds` sin índice existente, o un ISIN que deje de estar en el índice.
La sustitución del índice es atómica, así que una
construcción a medias no deja un índice a medias.

## Opciones

La pregunta original era si la caché debe cubrir esos campos o si `--sin-red` debe negarse. **Ninguna de las dos hace falta:
la caché ya los cubre y FIRDS no depende de la red.** Lo que queda por decidir es el riesgo real:

| Opción | Qué hace | Coste | Riesgo que deja |
|---|---|---|---|
| **A. Corregir la incidencia y nada más** | Se reescribe como «ganan 27», y se documenta lo no neutro | Minutos | Un `update` sin índice borra FIRDS de 805 fichas en silencio |
| **B. `update` se para si falta el índice FIRDS** | Al arrancar, si no hay `firds.sqlite` con completo y existen fichas con `firds_visto`, error nombrando `python main.py firds`. Con bandera explícita para saltarlo | ~10 líneas y una prueba | Un ISIN concreto que salga del índice sigue perdiendo FIRDS |
| **C. Retener FIRDS con aviso** | Si `esma_firds` no trae nada y la ficha lo tenía: conservar con `retenido:esma_firds@fecha` hasta N días, y aviso `registro_no_encontrado` | ~40 líneas, pruebas, y decidir N (propongo 365, como la identidad) | Una identidad vieja puede seguir viva hasta N días, con aviso |
| **D. Que el índice falte se distinga de que el ISIN falte** | `fetch` avisa con `procedencia.no_servido`, y la retención de `--sin-red` lo recoge | ~20 líneas | Necesita B o C para tener efecto |

**Recomiendo A + B ahora, y C cuando se toque la retención.** B cierra por unas pocas líneas el único caso masivo. C es la
respuesta correcta para el caso fino y además da una señal útil: que una acción con FIRDS desaparezca del índice es un aviso
de baja. No propongo que `--sin-red` se niegue a nada: quitaría una herramienta que funciona, y `pipeline-extractor` la usa
para re-mapear gratis.

Sobre la calidad, aparte: si se quiere que un re-mapeo no envejezca el VL, `_dias_vl` tendría que contar desde la última
pasada con red. Es un cambio de criterio de calidad, y lo dejo señalado sin recomendarlo: hoy el efecto solo aparece al correr
`--sin-red` sobre todo el catálogo, y solo si esa ficha se conserva. La pasada del 08-11 la devolvió, con razón.

## Lo que necesita decisión de Óscar

1. **Corregir la incidencia** en `INCIDENCIAS_PENDIENTES.md` y las líneas de `COORDINACION_SESIONES.md` que repiten «pierde FIRDS».
   No las he tocado.
2. **¿Se construye B ahora?** (recomendado), y C más adelante.
3. **Las 27 fichas:** entrarán solas en la próxima pasada con red (o `update <ISIN> --sin-red --sin-caducidad` solo para ellas).
   Ganan identidad real; la base las recibirá en la siguiente escritura del catálogo.

## Limitaciones

- Se midió contra el estado de hoy, con el índice FIRDS de `2026-10-31` y deltas hasta el `2026-11-06`.
- Es una pasada sin red: no mide qué haría una pasada con red.
- La comparación con `export_bdb/` se hizo por campos planos; el detalle fino está hecho sobre `export/fondos.ndjson`.
