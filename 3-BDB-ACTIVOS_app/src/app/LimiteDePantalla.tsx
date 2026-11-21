import { Component, type ErrorInfo, type ReactNode } from "react";
import { appLogger } from "../core/appLogger";
import { EmptyState } from "../components/ui/AsyncState";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";

/**
 * El límite de error de una pantalla (MAR-02, 13-11-2026).
 *
 * Vive dentro del contenido principal, así que si una pantalla lanza al pintar se cae ella sola: el menú y la
 * barra siguen, y se puede ir a otra. Quien lo monta le da en `reiniciarCon` un valor que cambia con la pantalla:
 * al cambiar, el límite olvida el error. No es una `key`: una `key` volvería a montar la pantalla en cada navegación,
 * y Diseño e Informes comparten componente y estado (los candados que viajan de una a otra). El de `main.tsx` se
 * queda como última red, para lo que falle fuera de aquí.
 *
 * Distingue un caso: el trozo diferido de una pantalla que no se descarga. Es lo típico tras publicar una versión
 * nueva con la pestaña abierta —los nombres de los ficheros cambian—, y reintentar no sirve: hay que recargar.
 */

/* Los errores que Vite anuncia con `vite:preloadError` antes de rechazar el `import()` dinámico. */
const fallosDeCarga = new WeakSet<object>();
let escuchando = false;

function escucharFallosDeCarga() {
  if (escuchando || typeof window === "undefined") return;
  escuchando = true;
  window.addEventListener("vite:preloadError", (evento) => {
    const error: unknown = (evento as Event & { payload?: unknown }).payload;
    if (error && typeof error === "object") fallosDeCarga.add(error);
  });
}

/* Lo que dicen los navegadores cuando un `import()` dinámico no llega: Chrome, Firefox y Safari. */
const MENSAJE_DE_IMPORT_FALLIDO =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

function esFalloDeCarga(error: unknown): boolean {
  if (error && typeof error === "object" && fallosDeCarga.has(error)) return true;
  const mensaje = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return MENSAJE_DE_IMPORT_FALLIDO.test(mensaje);
}

interface LimiteDePantallaProps {
  /** El nombre de la pantalla, como en el menú. */
  pantalla: string;
  /** A dónde lleva el botón de salida, que es otra pantalla y no esta. */
  rotuloDeSalida: string;
  alSalir: () => void;
  /** Cambia al navegar a otra pantalla: con el cambio, el límite olvida el error y vuelve a pintar a sus hijos. */
  reiniciarCon: string;
  children: ReactNode;
}

export class LimiteDePantalla extends Component<LimiteDePantallaProps, { error: unknown; hayError: boolean }> {
  state = { error: null as unknown, hayError: false };

  constructor(props: LimiteDePantallaProps) {
    super(props);
    escucharFallosDeCarga();
  }

  static getDerivedStateFromError(error: unknown) {
    return { error, hayError: true };
  }

  componentDidUpdate(anteriores: LimiteDePantallaProps) {
    if (this.state.hayError && anteriores.reiniciarCon !== this.props.reiniciarCon) this.setState({ error: null, hayError: false });
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    appLogger.error(`La pantalla «${this.props.pantalla}» no se ha podido abrir`, { error, info });
  }

  render() {
    if (!this.state.hayError) return this.props.children;
    const { pantalla, rotuloDeSalida, alSalir } = this.props;
    const salir = (
      <Button onClick={alSalir} variant="quiet">
        {rotuloDeSalida}
      </Button>
    );
    if (esFalloDeCarga(this.state.error)) {
      return (
        <div>
          <PageHeader title={pantalla} />
          <EmptyState
            action={
              <>
                <Button onClick={() => window.location.reload()} variant="primary">
                  Recargar la aplicación
                </Button>
                {salir}
              </>
            }
            description="Hay una versión nueva de la aplicación y esta pestaña aún tiene la anterior. Recárgala para abrir la pantalla: la cartera en curso se conserva."
            title="Esta pantalla no se ha podido abrir"
          />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={pantalla} />
        <EmptyState
          action={
            <>
              <Button onClick={() => this.setState({ error: null, hayError: false })} variant="primary">
                Reintentar
              </Button>
              {salir}
            </>
          }
          description="Algo ha fallado al pintarla. El resto de la aplicación sigue funcionando: puedes reintentarlo o ir a otra pantalla."
          title="Esta pantalla no se ha podido abrir"
        />
      </div>
    );
  }
}
