# El mapa de navegación

> **Estado a 04-11-2026:** la aplicación está en producción sobre la base nueva. Este documento es registro de cómo se planificó y varias cifras y pendientes están superados. Lo que queda está en [el informe de cierre](https://claude.ai/artifact/VHoLhhQE7SNhzMPe4S4kwv).

*Decisión 1 del rediseño. Tomada por Óscar el 2 de noviembre de 2026.*

Este documento existe por una razón concreta: de septiembre, cuando se eligió entre cuatro
direcciones visuales, **no quedó ni un documento que dijera por qué ganó la que ganó**. La
única huella son las horas de los ficheros. Así que el motivo de cada cambio del mapa se
escribe aquí, el día que se decide, medido sobre el código y no recordado.

La propuesta que Óscar aprobó está publicada en
<https://claude.ai/artifact/9iQNuSXLjHora7bFsTZGyA>.

## El rail de antes

Lo dibujó la auditoría del 11-08-2026 («ola 3b», §5.4), cuando el catálogo era de fondos y la
base nueva no existía. Cinco secciones, nueve destinos más Sistema:

```
Mercado        Mercado
Activos        Buscador · Comparador
Cartera        Diseño de cartera · [Informe de cliente] · Análisis · Posiciones globales
Cartera real   Rendimiento · Extracto externo
Sistema        Sistema                                   (al pie, solo admin)
```

Su principio está escrito en `src/app/navModel.tsx` y **no cambia**: «un destino pertenece al
grupo de la ENTIDAD sobre la que trabaja, no al de la herramienta que usa». Lo que cambia es
que ese principio no se estaba cumpliendo.

## Lo que falla, medido

**1. Una pantalla en dos secciones.** «Posiciones globales» y «Extracto externo» son el mismo
componente, `PositionsWorkbench`, en sus dos modos —`global` y `extracto`—. Lo dice su propia
cabecera desde la auditoría del 29-09: «antes eran dos copias de 700 líneas que divergían en
detalles; ahora las diferencias están en `MODE_CONFIG`». El código las unificó y el rail no se
enteró, así que el asesor tiene que saber en cuál de las dos secciones está la mesa de trabajo
que quiere.

**2. Dos secciones que se distinguen por un adjetivo.** «Cartera» y «Cartera real». El corte
entre ellas no es lo que el asesor hace, sino de dónde vienen los datos: modelados contra
importados. Esa es una distinción del sistema, no suya, y es la que obliga al reparto del punto
anterior.

**3. La ficha no está en el mapa.** La pantalla que más se abre delante de un cliente era un
estado del Buscador. Tenía dirección —`/buscador?activo=<id>`, y funcionaba en los dos
sentidos, lo cual conviene reconocer— pero no existía como sitio al que ir.

**4. Siete pantallas del rediseño fuera del rail.** Seis son la versión nueva de un destino que
ya existe; una es un ascenso —«Carteras guardadas», hasta hoy un panel del Constructor—; y una
es nueva de verdad, «Salud del catálogo», que no es asesoramiento y por eso no cabía en ninguna
de las cinco secciones.

### Una cifra del plan que no se reproduce

`PLAN_REDISENO_FRONTEND_2026-11-02` decía que la palabra «TER» aparece **122 veces** en el
código de la aplicación, como prueba de que el mapa nació de un catálogo de solo fondos. Son
**34** en `src/` y 42 contando las pruebas. El argumento se sostiene por los cuatro puntos de
arriba; por esa cifra, no.

## El rail de ahora

```
Mercado        Mercado
Activos        Buscador · Comparador
Carteras       Diseño de cartera · [Informe de cliente] · Carteras guardadas ·
               Análisis · Rendimiento · Posiciones
Datos          Salud del catálogo · Sistema             (al pie, solo admin)
```

Tres secciones de asesoramiento y una de datos. Nueve destinos más dos de datos.

## Las cuatro decisiones, y dónde se hacen cumplir

| | Decisión | Dónde vive |
|---|---|---|
| A | «Cartera» y «Cartera real» son una sola sección, «Carteras», y «Posiciones» es un destino con dos modos | `navModel.tsx`, `pages/PosicionesPage.tsx`, `components/PositionsWorkbench.tsx` |
| B | La ficha tiene dirección propia, `/activo/<ISIN>`, y **no** es entrada del rail | `appRoutes.ts` (`pathForAsset`, el prefijo en `resolveRoute`), `BdbActivosApp.tsx` |
| C | «Salud del catálogo» va al pie, en una sección «Datos» con Sistema | `navModel.tsx` (`SYSTEM_SECTION`) |
| D | «Carteras guardadas» asciende de panel a destino | `appRoutes.ts`, `BdbActivosApp.tsx`, `PortfolioBuilder.tsx` |

Las pruebas que fallan si alguien deshace cualquiera de las cuatro están en
`tests/appRoutes.test.ts` («el mapa del 02-11-2026») y `tests/appNavigation.test.tsx`.

### Por qué la ficha no entra en el rail

Nadie pulsa «Ficha» sin un instrumento delante. Un destino con dirección propia y una entrada
del rail son dos cosas distintas, y la ficha necesita la primera: se llega a ella desde el
Buscador, el Comparador y la cartera, y lo que gana es poder mandarse por correo, abrirse en
otra pestaña y marcarse como favorita. El rail sigue marcando «Buscador» mientras está abierta,
porque es de donde se suele venir; desde el 04-11-2026 es una pantalla propia y no la monta nadie
(decisión 26).

El cambio de forma no es cosmético: `?activo=<ISIN>` dice «el buscador, en este estado», y
`/activo/<ISIN>` dice «este instrumento». La forma vieja se sigue leyendo, porque hay enlaces
mandados por correo con ella.

### Por qué «Datos» sigue detrás del claim de admin

La sección del pie ya lo estaba con Sistema dentro, y las dos pantallas hablan del estado de la
base y no de un cliente. «Salud del catálogo» contesta dónde conviene invertir esfuerzo de
datos, que es trabajo de curación.

Una consecuencia que conviene tener presente: esa pantalla lee la **base nueva**. Cuando se
escribió esto, a esa base solo se llegaba desde desarrollo; **el 03-11-2026 dejó de ser cierto**
y ahora hay camino en producción si la aplicación está configurada contra
`bdb-gestor-de-activos`. Donde no lo esté, la entrada del rail existe y la página dice «Sin base
nueva» en vez de fallar: una ausencia honesta, no un destino roto.

### Por qué «Carteras guardadas» monta todavía el Constructor

La decisión de hoy es del **rail**: qué destinos hay y cómo se agrupan. **Cuándo** cada pantalla
del rediseño sustituye a la vieja es otra, y se toma pantalla a pantalla con las capturas de los
seis anchos delante. Así que «Carteras guardadas» abre hoy el Constructor con su panel de
guardadas arriba, que es la pantalla que funciona en producción, y su cabecera lo dice: «al
abrir una se carga en el Diseño de cartera, que es el resto de esta pantalla».

Cuando `CarterasGuardadasPage` tome el relevo, el destino no se mueve: cambia lo que renderiza.

*Superado el 04-11-2026, decisión 26: el destino del menú es la tabla de `/carteras-guardadas`, ya sin el Constructor debajo, y `/cartera/guardadas` redirige a ella.*

## Lo que esto no decide

El intercambio pantalla a pantalla. Hoy conviven las seis del rediseño fuera del rail
—`/ficha-nueva`, `/buscador-nuevo`, `/comparador-nuevo`, `/analisis-nuevo`, `/cartera-nueva`,
`/carteras-guardadas`— con las que están en su sitio. Sustituir significa que la nueva se queda
con la URL del destino y la anterior sale, y conviene hacerlo de una en una.
