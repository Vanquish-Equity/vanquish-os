export function clampDialogPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return {
    x: Math.max(8, Math.min(x, Math.max(8, viewportWidth - width - 8))),
    y: Math.max(8, Math.min(y, Math.max(8, viewportHeight - height - 8))),
  };
}
