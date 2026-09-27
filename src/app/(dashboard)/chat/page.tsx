import Link from "next/link";

export default function ChatIndexPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center">
      <div className="max-w-[360px]">
        <p className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-ink">Select a conversation</p>
        <p className="mt-1 text-[12.5px] text-neutral-500">
          Messages are only visible to the members of each conversation.
        </p>
        <Link
          href="/chat/new"
          className="mt-4 inline-block rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800"
        >
          New conversation
        </Link>
      </div>
    </div>
  );
}
