import sanitizeHtml from "sanitize-html";

function escapeText(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Parse HTML before applying the composer's allowlist. This also makes
// repeated saves idempotent for entities and handles malformed pasted HTML.
export function sanitizeDraftHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [
      "b",
      "strong",
      "i",
      "em",
      "u",
      "s",
      "strike",
      "br",
      "p",
      "div",
      "ul",
      "ol",
      "li",
      "a",
      "span",
      // Signature logos: remote https images only.
      "img",
    ],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt", "width", "height"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    // An image without an https source is dropped entirely, not kept empty.
    exclusiveFilter: (frame) => frame.tag === "img" && !/^https:\/\//i.test(frame.attribs.src ?? ""),
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs): sanitizeHtml.Tag => ({
        tagName: "a",
        attribs: /^(https?:|mailto:)/i.test(attrs.href ?? "")
          ? { href: attrs.href, target: "_blank", rel: "noopener noreferrer" }
          : {},
      }),
    },
  }).replace(/<br \/>/g, "<br/>");
}

// True when a stored body has no markup at all: a draft saved before the
// rich text editor existed, or the initial empty state.
export function isPlainTextBody(body: string): boolean {
  return !/<[a-z][\s\S]*>/i.test(body);
}

// Legacy plain-text bodies become HTML the first time they are opened in
// the rich text editor, preserving line breaks.
export function plainTextToHtml(text: string): string {
  return escapeText(text).replace(/\r\n|\r|\n/g, "<br>");
}
