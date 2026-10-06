import { attachmentResourceId, googleClient, resourceId, requireScope } from "@/lib/google/client";
import type { GmailMessage, GmailPart } from "@/lib/google/mail-types";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const id = resourceId(params.get("message") ?? "");
    const partId = params.get("part") ?? "";
    const client = await googleClient();
    requireScope(client, "gmail.readonly", "gmail.modify");
    const message = await client.request<GmailMessage>(
      "gmail",
      `/messages/${id}?format=full`,
    );
    let found: GmailPart | undefined;
    function walk(part: GmailPart) {
      if (part.partId === partId && (part.filename || part.body?.attachmentId))
        found = part;
      part.parts?.forEach(walk);
    }
    if (message.payload) walk(message.payload);
    if (!found?.body)
      return new Response("Attachment not found.", { status: 404 });
    const body = found.body.attachmentId
      ? await client.request<{ data: string }>(
          "gmail",
          `/messages/${id}/attachments/${attachmentResourceId(found.body.attachmentId)}`,
        )
      : found.body;
    if (!body.data)
      return new Response("Attachment not found.", { status: 404 });
    const name = (found.filename || "attachment").replace(/[\r\n"]/g, "");
    const asciiName = name.replace(/[^\x20-\x7e]/g, "_");
    return new Response(Buffer.from(body.data, "base64url"), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(
      "Could not download this attachment. Check your Google connection.",
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
