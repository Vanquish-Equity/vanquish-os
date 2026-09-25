import Link from "next/link";

// Shown instead of a page the member has no permission for. The data is
// also withheld by RLS; this only explains why the page is empty.
export default function RestrictedArea({ area }: { area: string }) {
  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <div className="vq-card-static max-w-lg rounded-[14px] bg-white p-6">
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          Restricted area
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-[20px] font-semibold text-ink">
          You do not have access to {area}
        </h1>
        <p className="mt-2 text-[13px] text-neutral-600">
          {area} is only available to members who have been given that permission explicitly.
        </p>
        <Link
          href="/overview"
          className="mt-4 inline-block rounded-full bg-ink px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
