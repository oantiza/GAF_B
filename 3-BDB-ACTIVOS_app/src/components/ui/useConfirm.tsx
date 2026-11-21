import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog, type ConfirmOptions } from "./ConfirmDialog";

/**
 * `const { confirm, confirmDialog } = useConfirm();` → `if (!(await confirm({ title }))) return;`
 * y `{confirmDialog}` en el JSX. Una sola pregunta a la vez; una segunda
 * llamada mientras hay una abierta resuelve la anterior como cancelada.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; confirmDialog: ReactNode } {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setPending(options);
    });
  }, []);

  const confirmDialog = pending ? (
    <ConfirmDialog {...pending} onCancel={() => settle(false)} onConfirm={() => settle(true)} />
  ) : null;

  return { confirm, confirmDialog };
}
