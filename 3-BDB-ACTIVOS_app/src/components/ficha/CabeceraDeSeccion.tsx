import type { ReactNode } from "react";
/* La pieza trae su hoja: si la pidiera cada pantalla, una que la olvide la pinta sin estilo. */
import "../../styles/ficha.css";

/**
 * La cabecera de una sección de la ficha: el título y, pegada debajo, la procedencia, que es lo que hace que la cifra de
 * abajo se pueda defender delante de un cliente. La procedencia lleva el filete.
 *
 * `acciones` es el mando de la sección, como el periodo de la evolución, y va a la derecha del título. Sin esta ranura, la
 * evolución se escribía otra cabecera a mano, con su propio filete.
 */
export function CabeceraDeSeccion({
  acciones,
  procedencia,
  titulo,
  tituloId
}: {
  acciones?: ReactNode;
  procedencia: ReactNode;
  titulo: ReactNode;
  tituloId?: string;
}) {
  const cabecera = (
    <>
      {/* ACT-18: una sección de la ficha es un `h2`, el nivel que sigue al `h1` del nombre: con `h3` se saltaba uno, y quien
          recorre la página por encabezados encontraba la estructura rota. La hoja la viste por su clase, no por la etiqueta. */}
      <h2 className="ficha__titulo" id={tituloId}>
        {titulo}
      </h2>
      <p className="ficha__procedencia">{procedencia}</p>
    </>
  );
  return acciones ? (
    <div className="ficha__cabecera-con-acciones">
      {cabecera}
      {acciones}
    </div>
  ) : (
    cabecera
  );
}
