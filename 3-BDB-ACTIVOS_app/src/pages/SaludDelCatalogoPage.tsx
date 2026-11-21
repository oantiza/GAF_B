import { BASE_NUEVA_DISPONIBLE, listarCalidades } from "../adapters/baseNuevaLectura";
import { componerSalud, nombreDelAviso, rutaEnPalabras, type SaludDelCatalogo } from "../adapters/componerSalud";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { TablaDeDatos } from "../components/tabla/TablaDeDatos";
import { EmptyState } from "../components/ui/AsyncState";
import { Cifra } from "../components/ui/Cifra";
import { Esqueleto } from "../components/ui/Esqueleto";
import { PageHeader } from "../components/ui/PageHeader";
import { Panel } from "../components/ui/Panel";
import { Respuesta } from "../components/ui/Respuesta";
import { AppError } from "../core/appError";
import { appLogger } from "../core/appLogger";
import { numero, peso } from "../core/formato";
import { useAsyncData } from "../core/useAsyncData";
import type { ColumnaDeTabla } from "../types/tablaDeDatos";
import "../styles/datos.css";

/** Un recuento, con su punto de millar siempre (PLA-12). */
const recuento = (valor: number) => numero(valor) ?? "";

type Ruta = SaludDelCatalogo["rutas"][number] & { id: string };
type Aptitud = SaludDelCatalogo["aptitudes"][number] & { id: string };

/** El campo, en palabras, con su ruta del contrato debajo para quien la busque en el código. */
const celdaDeRuta = (ruta: Ruta) => ({ texto: rutaEnPalabras(ruta.ruta), valor: rutaEnPalabras(ruta.ruta), apunte: ruta.ruta });

const COLUMNAS_EN_TODOS: ColumnaDeTabla<Ruta>[] = [{ id: "campo", titulo: "Qué dato es", encabezaFila: true, celda: celdaDeRuta }];

function columnasParciales(instrumentos: number): ColumnaDeTabla<Ruta>[] {
  return [
    { id: "campo", titulo: "Qué dato es", encabezaFila: true, celda: celdaDeRuta },
    { id: "activos", titulo: "Activos", cifra: true, celda: (ruta) => ({ texto: recuento(ruta.cuantos), valor: ruta.cuantos }) },
    {
      id: "proporcion",
      titulo: "Del catálogo",
      cifra: true,
      /* Un decimal: 1.072 de 1.077 es el 99,5 %, y redondeado a cero decimales decía «100 %» en la tabla de lo que NO
         falta en todos. */
      celda: (ruta) => ({ texto: peso(ruta.cuantos / instrumentos) ?? "", valor: ruta.cuantos / instrumentos })
    }
  ];
}

const COLUMNAS_DE_APTITUD: ColumnaDeTabla<Aptitud>[] = [
  { id: "uso", titulo: "Uso", encabezaFila: true, sinOrden: true, celda: (a) => ({ texto: APTITUD[a.clave] ?? a.clave }) },
  { id: "si", titulo: "Sirven", cifra: true, sinOrden: true, celda: (a) => ({ texto: recuento(a.si), valor: a.si }) },
  { id: "no", titulo: "No", cifra: true, sinOrden: true, celda: (a) => ({ texto: recuento(a.no), valor: a.no }) },
  {
    id: "proporcion",
    titulo: "Proporción",
    cifra: true,
    sinOrden: true,
    celda: (a) => ({ texto: peso(a.si / (a.si + a.no)) ?? "", valor: a.si / (a.si + a.no) })
  }
];

/**
 * Salud del catálogo (dirección A + B, 02-11-2026). Fuera del rail, como las demás.
 *
 * Contesta la pregunta que ninguna otra pantalla contesta: **dónde conviene invertir
 * esfuerzo de datos**. Y la contesta separando dos cosas que un porcentaje de cobertura
 * mezcla: un campo que falta en tres instrumentos es un hueco de datos; un campo que
 * falta en los 1.077 es una decisión que nadie ha tomado, y se arregla una vez.
 */

const APTITUD: Record<string, string> = {
  COMPARAR_COSTE: "Comparar su coste",
  RADIOGRAFIA_DE_CARTERA: "Entrar en una radiografía",
  COMPARAR_RENTABILIDAD: "Comparar su rentabilidad",
  MOSTRAR_ALPHA: "Medir su alfa",
  METRICAS_PROPIAS: "Métricas nuestras",
  COMPARAR_CON_SU_GRUPO: "Compararlo con sus pares"
};

export function SaludDelCatalogoPage() {
  const { data, error, loading, retry } = useAsyncData(
    async () => {
      try {
        return componerSalud(await listarCalidades());
      } catch (causa) {
        /* ACT-25: el adaptador pregunta «¿Está levantado su emulador en…?», que es para quien programa. A
           pantalla, qué ha pasado; lo técnico, al registro. */
        appLogger.error("No se pudo leer la calidad del catálogo", causa instanceof Error ? causa.message : String(causa));
        throw new AppError("BACKEND", "No hemos podido leer la calidad del catálogo. Vuelve a intentarlo; si sigue pasando, hay que revisarlo.", { cause: causa });
      }
    },
    [],
    { enabled: BASE_NUEVA_DISPONIBLE }
  );

  const enTodos: Ruta[] = data?.rutas.filter((ruta) => ruta.enTodos).map((ruta) => ({ ...ruta, id: ruta.ruta })) ?? [];
  const parciales: Ruta[] =
    data?.rutas
      .filter((ruta) => !ruta.enTodos)
      .slice(0, 12)
      .map((ruta) => ({ ...ruta, id: ruta.ruta })) ?? [];
  const aptitudes: Aptitud[] = data?.aptitudes.map((aptitud) => ({ ...aptitud, id: aptitud.clave })) ?? [];

  return (
    <div className="salud datos-pagina">
      <PageHeader
        description="Qué sabe y qué no sabe el catálogo entero, y dónde compensa arreglarlo. Un campo que falta en todos los activos no es un hueco de datos: es una decisión pendiente."
        eyebrow="Datos · solo administración"
        title="Salud del catálogo"
      />

      {!BASE_NUEVA_DISPONIBLE ? (
        <EmptyState
          description="Esta pantalla lee la base nueva, y esta aplicación no está configurada contra ella. En desarrollo se llega siempre; en producción, solo si el proyecto es «bdb-gestor-de-activos»."
          title="Sin base nueva"
        />
      ) : (
        <>
          {error ? <AsyncErrorBanner error={error} onRetry={retry} /> : null}
          {loading && !data ? (
            <>
              <p className="sr-only">Leyendo las calidades…</p>
              <Esqueleto lineas={6} />
            </>
          ) : null}

          {data ? (
            <>
              <Respuesta
                abierta
                datos={[
                  { rotulo: "Activos", cifra: <Cifra tipo="numero" valor={data.instrumentos} /> },
                  {
                    rotulo: "Datos disponibles",
                    cifra: <Cifra tipo="peso" valor={data.cobertura} />,
                    apunte: `${recuento(data.presentes)} campos de ${recuento(data.aplicables)} aplicables`,
                    principal: true
                  },
                  { rotulo: "No nos los han dado", cifra: <Cifra tipo="numero" valor={data.porClase.falta} /> },
                  {
                    rotulo: "No aplican",
                    cifra: <Cifra tipo="numero" valor={data.porClase.noAplica} />,
                    apunte: "no son huecos: no existen para ese producto"
                  },
                  {
                    rotulo: "Sin pedir",
                    cifra: <Cifra tipo="numero" valor={data.porClase.sinPedir} />,
                    apunte: "lo único que se resuelve trabajando"
                  }
                ]}
                etiqueta="Qué sabe el catálogo"
              />

              <Panel
                subtitulo={`${enTodos.length} campos no están en ninguno de los ${recuento(data.instrumentos)} activos. Eso no es un hueco de datos: o el cálculo no los produce, o nadie ha decidido pedirlos. Cada uno se arregla una vez y sube los datos disponibles de todo el catálogo.`}
                titulo="Lo que falta en TODOS los activos"
              >
                <TablaDeDatos columnas={COLUMNAS_EN_TODOS} filas={enTodos} porPagina titulo="Campos que faltan en todos los activos" />
              </Panel>

              <Panel
                subtitulo="Aquí sí son huecos de datos: hay activos que lo tienen y otros que no."
                titulo="Lo que falta en muchos, pero no en todos"
              >
                <TablaDeDatos columnas={columnasParciales(data.instrumentos)} filas={parciales} titulo="Campos que más faltan" />
              </Panel>

              <Panel
                subtitulo="Cuántos activos valen para cada uso, de peor a mejor. Lo dice la propia base, activo a activo."
                titulo="Para qué sirve el catálogo"
              >
                <TablaDeDatos columnas={COLUMNAS_DE_APTITUD} filas={aptitudes} titulo="Aptitudes del catálogo" />
              </Panel>

              <Panel
                subtitulo="Avisos que la propia base emite al componer la calidad. No son errores: son cosas que cambian cómo se lee una cifra."
                titulo="Lo que la base avisa"
              >
                <dl className="salud__avisos">
                  {data.avisos.map((aviso) => (
                    <div key={aviso.codigo}>
                      <dt>
                        {nombreDelAviso(aviso.codigo)}
                        <b>{recuento(aviso.cuantos)}</b>
                      </dt>
                      <dd>{aviso.mensaje}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
