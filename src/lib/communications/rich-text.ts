// A constrained HTML allowlist for draft bodies. Not a general HTML parser:
// it only needs to accept what the composer's own formatting toolbar
// produces (bold/italic/underline/strike, lists, links, line breaks) and
// strip everything else, since the stored body will eventually become a
// real email body once Gmail is connected.

const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "strike", "br", "p", "div", "ul", "ol", "li", "a", "span"]);
const SELF_CLOSING = new Set(["br"]);
const SAFE_HREF = /^(https?:|mailto:)/i;

function escapeText(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeDraftHtml(input: string): string {
  const withoutDangerous = input.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");

  let out = "";
  let i = 0;
  const n = withoutDangerous.length;
  while (i < n) {
    const lt = withoutDangerous.indexOf("<", i);
    if (lt === -1) {
      out += escapeText(withoutDangerous.slice(i));
      break;
    }
    out += escapeText(withoutDangerous.slice(i, lt));
    const gt = withoutDangerous.indexOf(">", lt);
    if (gt === -1) {
      out += "&lt;";
      i = lt + 1;
      continue;
    }
    const tagContent = withoutDangerous.slice(lt + 1, gt);
    i = gt + 1;

    const match = tagContent.match(/^\/?\s*([a-zA-Z0-9]+)/);
    if (!match) continue; // malformed tag, drop it

    const closing = tagContent.trim().startsWith("/");
    const tagName = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) continue; // drop disallowed markup, keep surrounding text

    if (closing) {
      out += `</${tagName}>`;
      continue;
    }

    let attrs = "";
    if (tagName === "a") {
      const hrefMatch = tagContent.match(/href\s*=\s*"([^"]*)"/i) ?? tagContent.match(/href\s*=\s*'([^']*)'/i);
      const href = (hrefMatch?.[1] ?? "").trim();
      if (SAFE_HREF.test(href)) {
        attrs = ` href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer"`;
      }
    }
    out += SELF_CLOSING.has(tagName) ? `<${tagName}${attrs}/>` : `<${tagName}${attrs}>`;
  }
  return out;
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
