/**
 * Paso 1 del asistente: soltar o elegir los documentos, y ver qué es cada uno.
 */
import { useId, useState, type DragEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { Distintivo } from "../../../components/ui/Distintivo";
import { EXTENSIONES_ADMITIDAS, queEs, type FicheroDelAsistente } from "./ficheros";
import { descargarPlantillaCsv, descargarPlantillaExcel } from "./plantilla";

function LineaDelFichero({ fichero, alQuitar }: { fichero: FicheroDelAsistente; alQuitar: () => void }) {
  let detalle;
  if (fichero.estado === "leyendo") detalle = <span className="gestor-fila__nota" role="status">Leyendo…</span>;
  else if (fichero.estado === "reconocido") detalle = <span className="gestor-fila__nota">{queEs(fichero)}</span>;
  else if (fichero.estado === "ilegible") {
    detalle = (
      <span className="gestor-fila__nota">
        <Distintivo tono="aviso">No se puede leer</Distintivo> {fichero.error}
      </span>
    );
  } else {
    detalle = (
      <span className="gestor-fila__nota">
        <Distintivo tono="aviso">No se ha reconocido</Distintivo> Se ha probado con {(fichero.reconocimiento?.intentos ?? []).join(" · ")}.
        <span className="gestor-fila__nota">Si es de otra entidad, pasa sus movimientos a la plantilla.</span>
      </span>
    );
  }
  return (
    <div className="rows__item gestor-fila">
      <span className="rows__label">
        {fichero.nombre}
        {detalle}
      </span>
      <span className="rows__value">
        <Button aria-label={`Quitar ${fichero.nombre}`} onClick={alQuitar} size="sm" variant="quiet">Quitar</Button>
      </span>
    </div>
  );
}

export function PasoDocumentos({ ficheros, repetidos, alAnadir, alQuitar }: {
  ficheros: readonly FicheroDelAsistente[];
  /** Nombres de los ficheros que ya estaban en la lista y no se han vuelto a añadir. */
  repetidos: readonly string[];
  alAnadir: (ficheros: File[]) => void;
  alQuitar: (id: string) => void;
}) {
  const id = useId();
  const [encima, setEncima] = useState(false);
  const [errorDePlantilla, setErrorDePlantilla] = useState<string | null>(null);

  const soltar = (evento: DragEvent<HTMLDivElement>) => {
    evento.preventDefault();
    setEncima(false);
    const soltados = Array.from(evento.dataTransfer?.files ?? []);
    if (soltados.length > 0) alAnadir(soltados);
  };

  const excel = () => {
    setErrorDePlantilla(null);
    descargarPlantillaExcel().catch(() => setErrorDePlantilla("No se ha podido preparar el Excel. Descarga la plantilla en CSV, que se abre igual con Excel."));
  };

  return (
    <div className="stack">
      <div
        className={encima ? "gestor-soltar gestor-soltar--encima" : "gestor-soltar"}
        onDragLeave={() => setEncima(false)}
        onDragOver={(evento) => {
          evento.preventDefault();
          setEncima(true);
        }}
        onDrop={soltar}
      >
        <p className="gestor-soltar__texto">Suelta aquí los extractos del banco, o elígelos. Puedes cargar varios a la vez: movimientos, operaciones y posiciones.</p>
        <label className="ui-button ui-button--secondary" htmlFor={id}>Elegir ficheros</label>
        <input
          accept={EXTENSIONES_ADMITIDAS.join(",")}
          className="gestor-oculto"
          id={id}
          multiple
          onChange={(evento) => {
            const elegidos = Array.from(evento.target.files ?? []);
            /* Se vacía para que el mismo fichero se pueda volver a elegir tras quitarlo. */
            evento.target.value = "";
            if (elegidos.length > 0) alAnadir(elegidos);
          }}
          type="file"
        />
        <p className="cmp-note">Los documentos se leen en este equipo y no se envían a ningún sitio.</p>
      </div>

      {ficheros.length > 0 ? (
        <div className="stack stack--3">
          <h3 className="gestor-subtitulo">Extractos cargados</h3>
          <div className="rows">
            {ficheros.map((fichero) => (
              <LineaDelFichero alQuitar={() => alQuitar(fichero.id)} fichero={fichero} key={fichero.id} />
            ))}
          </div>
        </div>
      ) : null}
      {repetidos.length > 0 ? <p className="cmp-note" role="status">Ya estaba en la lista: {repetidos.join(", ")}.</p> : null}

      <p className="cmp-note">
        ¿Tus extractos son de otra entidad? Pasa los movimientos a la plantilla y cárgala aquí:{" "}
        <button className="gestor-enlace" onClick={descargarPlantillaCsv} type="button">plantilla en CSV</button>
        {" o "}
        <button className="gestor-enlace" onClick={excel} type="button">plantilla en Excel</button>
        {" "}(con instrucciones y una hoja opcional de posiciones para comprobar que cuadra).
      </p>
      {errorDePlantilla ? <p className="field__error" role="alert">{errorDePlantilla}</p> : null}
    </div>
  );
}
