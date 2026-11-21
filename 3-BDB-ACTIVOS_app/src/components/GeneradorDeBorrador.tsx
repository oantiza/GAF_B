import { useId, useState } from "react";
import {
  FONDOS_MAXIMOS,
  FONDOS_POR_DEFECTO,
  RENTA_VARIABLE_POR_NIVEL,
  type BorradorDeCartera,
  type PedidoDeBorrador,
  type PosicionDelBorrador
} from "../adapters/generadorBackend";
import { useModoCliente } from "../app/ClientModeContext";
import { esFaltaDeDatos, MENSAJE_GENERICO_PRECONDICION, motivoDelServidor } from "../core/appError";
import { fechaDeEje, numero, oFalta, peso, porcentaje } from "../core/formato";
import type { BdbRiskProfileContract } from "../types/bdbAssets";
import type { ColumnaDeTabla } from "../types/tablaDeDatos";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { Aviso } from "./ui/Aviso";
import { Campo } from "./ui/Campo";
import { Button } from "./ui/Button";

/**
 * «Generar un borrador» (decisión 122 de Óscar, 06-11-2026): una de las tres maneras de empezar una cartera, junto al Buscador y
 * a importar. El borrador lo compone el servidor (`generate_portfolio_draft`) con el criterio decidido: el porcentaje de renta
 * variable del nivel, bloques fijos y, en cada bloque, los fondos con mejor nota frente a los de su bloque. Primero se enseña y
 * después, si el asesor quiere, sustituye a la cartera, con la misma guardia que una importación.
 */
interface GeneradorDeBorradorProps {
  perfiles: BdbRiskProfileContract[];
  /** El nivel con que se abre: el del perfil elegido en Comprobar, si lo hay. */
  nivelInicial?: number;
  /** Si hay posiciones, el borrador las sustituye: el botón lo dice. */
  sustituye: boolean;
  onGenerar: (pedido: PedidoDeBorrador) => Promise<BorradorDeCartera>;
  onUsar: (borrador: BorradorDeCartera) => void;
}

interface FilaDelBorrador {
  id: string;
  posicion: PosicionDelBorrador;
}

function mesLegible(mes: string): string {
  /* Un mes, sin día: mes abreviado y año, «nov 2026». */
  return fechaDeEje(`${mes}-01`) ?? mes;
}

/** «81 de 100»: la nota es su posición en su bloque, de 0 a 1. */
function notaLegible(nota: number): string {
  return `${Math.round(nota * 100)} de 100`;
}

const COLUMNAS: ColumnaDeTabla<FilaDelBorrador>[] = [
  {
    id: "fondo",
    titulo: "Fondo",
    encabezaFila: true,
    sinOrden: true,
    celda: ({ posicion }) => ({
      texto: posicion.nombre,
      apunte: `${posicion.bloque}${posicion.indexado ? " · indexado" : ""}`,
      enlaceAFicha: posicion.asset_id
    })
  },
  { id: "peso", titulo: "Peso", cifra: true, sinOrden: true, celda: ({ posicion }) => ({ texto: oFalta(peso(posicion.peso_pct / 100)), valor: posicion.peso_pct }) },
  {
    id: "nota",
    titulo: "Nota en su bloque",
    cifra: true,
    sinOrden: true,
    celda: ({ posicion }) => ({
      texto: notaLegible(posicion.nota),
      valor: posicion.nota,
      apunte: `entre ${oFalta(numero(posicion.candidatos_del_bloque))}`
    })
  },
  {
    id: "gasto",
    titulo: "Gasto corriente",
    cifra: true,
    sinOrden: true,
    celda: ({ posicion }) => ({ texto: oFalta(porcentaje(posicion.gasto_corriente_pct / 100)), valor: posicion.gasto_corriente_pct })
  }
];

export function GeneradorDeBorrador({ perfiles, nivelInicial, sustituye, onGenerar, onUsar }: GeneradorDeBorradorProps) {
  const [nivel, setNivel] = useState(nivelInicial ?? 5);
  const [numFondos, setNumFondos] = useState(String(FONDOS_POR_DEFECTO));
  const [incluirIndexados, setIncluirIndexados] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<BorradorDeCartera | null>(null);
  const { activo: modoCliente } = useModoCliente();

  const pedidos = Number(numFondos);
  const numeroValido = Number.isInteger(pedidos) && pedidos >= 1 && pedidos <= FONDOS_MAXIMOS;
  /* MAR-10: el aviso de un número no válido queda enlazado a su campo. */
  const idDelError = useId();

  async function generar() {
    if (!numeroValido) return;
    setCargando(true);
    setError(null);
    setBorrador(null);
    try {
      setBorrador(await onGenerar({ nivel, num_fondos: pedidos, incluir_indexados: incluirIndexados }));
    } catch (causa) {
      /* Cuando el servidor dice que con estos datos no se puede, lo que hay que leer es su motivo («El generador necesita
         la base nueva…»), no la frase común de ese código, que es lo que salía: en local, donde el generador no puede
         trabajar, la pantalla decía «La operación no se puede ejecutar en el estado actual de los datos» y nada más. El
         motivo es cocina del asesor: en Modo cliente no se enseña. */
      const faltaDeDatos = esFaltaDeDatos(causa);
      const motivo = faltaDeDatos && !modoCliente ? motivoDelServidor(causa) : undefined;
      /* Desde el 15-11-2026 el texto del servidor es el mensaje del error: en Modo cliente se vuelve a la frase común. */
      setError(faltaDeDatos && modoCliente ? MENSAJE_GENERICO_PRECONDICION : motivo ?? (causa instanceof Error && causa.message ? causa.message : "No se pudo generar el borrador."));
    } finally {
      setCargando(false);
    }
  }

  const filas: FilaDelBorrador[] = (borrador?.posiciones ?? []).map((posicion) => ({ id: posicion.asset_id, posicion }));

  return (
    <>
      <section className="portfolio-start-generador" aria-labelledby="generador-de-borrador-titulo">
        <div className="portfolio-col-head">
          <p className="portfolio-col-eyebrow" id="generador-de-borrador-titulo">Generar un borrador</p>
          <p className="portfolio-col-sub">
            Elige el nivel de riesgo y cuántos fondos. En cada bloque entran los fondos con mejor nota frente a los de su bloque, de
            gestoras distintas mientras se pueda: calidad de la gestión, solidez, consistencia y, con menos peso, coste.
          </p>
        </div>
        <Campo rotulo="Nivel de riesgo">
          <select value={nivel} onChange={(event) => setNivel(Number(event.target.value))}>
            {perfiles.map((perfil) => (
              <option key={perfil.risk_profile_id} value={perfil.level}>
                {perfil.risk_profile_label} · {oFalta(porcentaje(RENTA_VARIABLE_POR_NIVEL[perfil.level] / 100, { decimales: 0 }))} de renta variable
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Número de fondos">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={FONDOS_MAXIMOS}
            value={numFondos}
            onChange={(event) => setNumFondos(event.target.value)}
            aria-describedby={numeroValido ? undefined : idDelError}
            aria-invalid={!numeroValido}
          />
        </Campo>
        {!numeroValido ? <span className="portfolio-col-sub" id={idDelError} role="alert">Un número entero del 1 al {FONDOS_MAXIMOS}.</span> : null}
        <label className="check">
          <input type="checkbox" checked={incluirIndexados} onChange={(event) => setIncluirIndexados(event.target.checked)} />
          <span>Incluir indexados</span>
        </label>
        <Button variant="secondary" busy={cargando} disabled={cargando || !numeroValido} onClick={() => void generar()}>
          Generar borrador
        </Button>
        {error ? <span className="portfolio-col-sub" role="alert">{error}</span> : null}
      </section>
      {borrador ? (
        <div className="portfolio-start-resultado" role="region" aria-label="Borrador generado">
          {borrador.estado === "FALTAN_FONDOS" ? (
            <Aviso anunciar titulo="Hacen falta más fondos.">
              {borrador.aviso} Pide entre {borrador.minimo_de_fondos} y {borrador.maximo_de_fondos}.
            </Aviso>
          ) : (
            <>
              <div className="portfolio-col-head">
                <p className="portfolio-col-eyebrow">
                  Nivel {borrador.nivel} · {borrador.nombre_del_nivel} · {oFalta(porcentaje(borrador.renta_variable_pct / 100, { decimales: 0 }))} de renta variable ·{" "}
                  {borrador.posiciones.length} {borrador.posiciones.length === 1 ? "fondo" : "fondos"}
                  {typeof borrador.gasto_corriente_medio_pct === "number" ? ` · gasto corriente medio ${oFalta(porcentaje(borrador.gasto_corriente_medio_pct / 100))}` : ""}
                </p>
                <p className="portfolio-col-sub">
                  Borrador automático: no es una recomendación. Medido de {mesLegible(borrador.ventana.desde)} a {mesLegible(borrador.ventana.hasta)},
                  con datos mensuales. {borrador.incluir_indexados ? "Con indexados." : "Solo gestión activa."} Este nivel admite de{" "}
                  {borrador.minimo_de_fondos} a {borrador.maximo_de_fondos} fondos.
                </p>
              </div>
              <TablaDeDatos filas={filas} columnas={COLUMNAS} deActivos titulo="Fondos del borrador" />
              {borrador.avisos.length > 0 ? (
                <ul className="portfolio-import-warnings" aria-label="Avisos del borrador">
                  {borrador.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}
                </ul>
              ) : null}
              <div className="portfolio-start-acciones">
                <Button variant="primary" onClick={() => onUsar(borrador)}>
                  {sustituye ? "Sustituir la cartera por este borrador" : "Usar este borrador"}
                </Button>
                <Button variant="quiet" onClick={() => setBorrador(null)}>Descartar</Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
