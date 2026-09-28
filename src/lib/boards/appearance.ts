export const BOARD_BACKGROUNDS = {
  blue: { label: "Blue", color: "#0862a7" },
  cyan: { label: "Cyan", color: "#137f9a" },
  navy: { label: "Navy", color: "#173b68" },
  violet: { label: "Violet", color: "#694b96" },
  rose: { label: "Rose", color: "#aa536f" },
  slate: { label: "Slate", color: "#45576a" },
} as const;

export type BoardBackground = keyof typeof BOARD_BACKGROUNDS;
export function boardBackground(value: string): BoardBackground {
  return value in BOARD_BACKGROUNDS ? value as BoardBackground : "blue";
}
