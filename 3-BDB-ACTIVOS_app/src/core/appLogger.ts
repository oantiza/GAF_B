type LogDetail = unknown;

function formatMessage(message: string): string {
  return `[BDB] ${message}`;
}

export const appLogger = {
  warn(message: string, detail?: LogDetail): void {
    if (detail === undefined) {
      console.warn(formatMessage(message));
      return;
    }
    console.warn(formatMessage(message), detail);
  },

  error(message: string, detail?: LogDetail): void {
    if (detail === undefined) {
      console.error(formatMessage(message));
      return;
    }
    console.error(formatMessage(message), detail);
  }
};
