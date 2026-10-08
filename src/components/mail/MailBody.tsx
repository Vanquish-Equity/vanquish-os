"use client";
import AttachmentImport from "./AttachmentImport";
import { useState } from "react";
import type { MailMessage } from "@/lib/google/mail-types";

export default function MailBody({ message }: { message: MailMessage }) {
  const [images, setImages] = useState(false);
  const policy = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${images ? "https: data:" : "data:"}; font-src 'none'; base-uri 'none'; form-action 'none';`;
  // An opaque-origin sandbox + CSP isolates arbitrary external email HTML.
  // No script, forms, embedded browsing contexts or remote tracking by default.
  const document = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>body{font:14px/1.6 system-ui;color:#182125;overflow-wrap:anywhere;margin:12px}img{max-width:100%}table{max-width:100%}a{color:#087e8b}</style></head><body>${message.html}</body></html>`;
  return (
    <div className="mt-4">
      {message.html ? (
        <>
          <button
            type="button"
            className="mb-2 text-[11px] font-medium text-cyan-800 hover:underline"
            onClick={() => setImages((v) => !v)}
          >
            {images
              ? "Hide remote images"
              : "Load remote images for this message"}
          </button>
          <iframe
            title={`Email from ${message.from}`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={document}
            className="min-h-[340px] w-full rounded-lg border border-neutral-100 bg-white"
          />
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[13px] leading-7 text-neutral-700">
          {message.text || "This message has no readable text body."}
        </p>
      )}
      {!!message.attachments.length && (
        <div className="mt-4 flex flex-wrap gap-2">
          {message.attachments.map((file, i) => (
            <div key={`${file.partId}-${i}`} className="flex flex-wrap items-center gap-2"><a
              className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] text-ink hover:border-cyan-300"
              href={`/api/mail/attachment?message=${encodeURIComponent(message.id)}&part=${encodeURIComponent(file.partId)}`}
            >
              {file.name}{" "}
              <span className="ml-2 text-neutral-400">
                {Math.ceil(file.size / 1024)} KB ↓
              </span>
            </a><AttachmentImport messageId={message.id} file={file} /></div>
          ))}
        </div>
      )}
    </div>
  );
}
