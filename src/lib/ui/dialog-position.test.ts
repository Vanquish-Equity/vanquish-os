import { expect, it } from "vitest";
import { clampDialogPosition } from "./dialog-position";
it("keeps the entire dialog on screen at each edge and after viewport shrink", () => {
  expect(clampDialogPosition(-100, -10, 480, 400, 1200, 800)).toEqual({ x: 8, y: 8 });
  expect(clampDialogPosition(1000, 900, 480, 400, 1200, 800)).toEqual({ x: 712, y: 392 });
  expect(clampDialogPosition(712, 392, 360, 500, 390, 600)).toEqual({ x: 22, y: 92 });
});
