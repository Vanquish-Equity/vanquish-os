import { describe, expect, it } from "vitest";
import { isPlainTextBody, plainTextToHtml, sanitizeDraftHtml } from "./rich-text";

describe("sanitizeDraftHtml", () => {
  it("keeps allowed formatting tags", () => {
    expect(sanitizeDraftHtml("<b>Hi</b> <i>there</i>, <u>welcome</u>.")).toBe("<b>Hi</b> <i>there</i>, <u>welcome</u>.");
  });

  it("keeps lists and line breaks", () => {
    expect(sanitizeDraftHtml("<ul><li>One</li><li>Two</li></ul><br>")).toBe("<ul><li>One</li><li>Two</li></ul><br/>");
  });

  it("strips script tags and their content entirely", () => {
    expect(sanitizeDraftHtml('<b>Hi</b><script>alert(1)</script>')).toBe("<b>Hi</b>");
  });

  it("drops disallowed tags but keeps their text", () => {
    expect(sanitizeDraftHtml("<img src=x onerror=alert(1)>Hello<iframe>bad</iframe>")).toBe("Hellobad");
  });

  it("keeps only http(s)/mailto links and drops javascript: hrefs", () => {
    expect(sanitizeDraftHtml('<a href="https://example.com">ok</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>'
    );
    expect(sanitizeDraftHtml('<a href="javascript:alert(1)">bad</a>')).toBe("<a>bad</a>");
  });

  it("strips arbitrary attributes from allowed tags", () => {
    expect(sanitizeDraftHtml('<b onclick="alert(1)" style="color:red">Hi</b>')).toBe("<b>Hi</b>");
  });

  it("escapes stray text-level angle brackets", () => {
    expect(sanitizeDraftHtml("1 < 2")).toBe("1 &lt; 2");
  });
});

describe("isPlainTextBody / plainTextToHtml", () => {
  it("treats a body without tags as plain text", () => {
    expect(isPlainTextBody("Hello,\nSee you soon.")).toBe(true);
    expect(isPlainTextBody("<b>Hello</b>")).toBe(false);
  });

  it("converts line breaks and escapes text", () => {
    expect(plainTextToHtml("a < b\nsecond line")).toBe("a &lt; b<br>second line");
  });
});


describe("HTML pasted from real email", () => {
  it("does not double-escape entities across repeated saves", () => {
    const html = '<p>R&amp;D &lt; 5 &quot;items&quot;</p>';
    expect(sanitizeDraftHtml(sanitizeDraftHtml(html))).toBe(sanitizeDraftHtml(html));
  });
  it("handles encoded unsafe links and attribute-breaking input", () => {
    expect(sanitizeDraftHtml('<a href="&#106;avascript:alert(1)">bad</a>')).toBe('<a>bad</a>');
    expect(sanitizeDraftHtml('<a href="https://example.com/&quot; onmouseover=&quot;alert(1)">text</a>')).not.toContain(' onmouseover="');
    expect(sanitizeDraftHtml('<svg><script>alert(1)</script></svg><p onclick="x">ok</p>')).toBe('<p>ok</p>');
  });
});
