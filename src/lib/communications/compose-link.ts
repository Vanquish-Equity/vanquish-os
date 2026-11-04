// "Email contact" opens our own inbox composer instead of the desktop mail
// app: /communications?compose=<address> opens a new message to that address.
const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function composeHref(email: string): string {
  return `/communications?compose=${encodeURIComponent(email.trim())}`;
}

// The page reads the param back; anything that is not one plain address is
// ignored so a hand-edited URL cannot seed other recipients or headers.
export function composeAddress(value: string | undefined): string | undefined {
  const email = value?.trim();
  return email && email.length <= 254 && ADDRESS.test(email) ? email : undefined;
}
