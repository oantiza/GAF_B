import { appErrorTitle, toAppError, type AppError } from "../core/appError";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";

interface AsyncErrorBannerProps {
  error: AppError | Error | unknown;
  onRetry?: () => void;
}

/* «Contrato de backend inválido en diagnostics: se esperaba object…» es para quien programa: a pantalla llega qué ha
   pasado, y lo técnico se queda en el detalle. */
const CONTRATO_ROTO = /^Contrato de backend inválido/;

/**
 * El fallo de una carga, con su causa y «Reintentar». Es un `Aviso` de tono `error` —se anuncia al aparecer, con el
 * filete y el fondo rojos de la maqueta— y su botón es la pieza `Button`. Conserva la clase `async-error-banner`,
 * que es por la que lo buscan las pruebas de las pantallas.
 */
export function AsyncErrorBanner({ error, onRetry }: AsyncErrorBannerProps) {
  const appError = toAppError(error);
  const contratoRoto = CONTRATO_ROTO.test(appError.message);
  const mensaje = contratoRoto ? "El servidor ha devuelto una respuesta que la aplicación no sabe leer. Reinténtalo; si sigue pasando, hay que revisarlo." : appError.message;
  const detalle = contratoRoto ? appError.message : appError.detail;
  return (
    <Aviso
      /* Un tope del servidor no se arregla reintentando: sin botón (10-11-2026). */
      accion={
        onRetry && !appError.limite ? (
          <Button onClick={onRetry} size="sm">
            Reintentar
          </Button>
        ) : undefined
      }
      className="async-error-banner"
      titulo={appErrorTitle(appError)}
      tono="error"
    >
      <p>{mensaje}</p>
      {detalle ? (
        <details className="async-error-banner__detail">
          <summary>Detalle técnico</summary>
          <code>{detalle}</code>
        </details>
      ) : null}
    </Aviso>
  );
}
