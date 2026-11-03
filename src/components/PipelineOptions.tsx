"use client";

import { useRef, type ReactNode } from "react";

export default function PipelineOptions({ active, children }: {
  active: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
      >
        Views &amp; filters{active ? " · on" : ""}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="pipeline-options-title"
        className="vq-card-static fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-[14px] bg-white p-4 backdrop:bg-black/25"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="pipeline-options-title" className="text-sm font-semibold text-ink">Pipeline views &amp; filters</h2>
          <form method="dialog">
            <button className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600">Close</button>
          </form>
        </div>
        <div className="flex flex-col gap-3">{children}</div>
      </dialog>
    </>
  );
}
