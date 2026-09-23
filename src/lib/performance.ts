export function startDevPageTimer(label: string) {
  if (process.env.NODE_ENV === "production") return () => {};

  console.time(label);
  return () => console.timeEnd(label);
}
