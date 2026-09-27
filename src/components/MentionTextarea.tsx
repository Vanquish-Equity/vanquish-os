"use client";

import { useRef, useState } from "react";
import { activeMentionQuery, mentionToken } from "@/lib/chat/format";

export type MentionCandidate = { email: string; name: string };

// Textarea with an explicit @mention picker (same rules as chat): typing "@"
// lists members, and only members chosen from the list become mentions.
// Ctrl/Cmd+Enter submits; Enter adds a line.
export default function MentionTextarea({
  id,
  label,
  value,
  onChange,
  onMention,
  onSubmit,
  candidates,
  placeholder,
  rows = 3,
  autoFocus = false,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onMention: (member: MentionCandidate) => void;
  onSubmit: () => void;
  candidates: MentionCandidate[];
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [picker, setPicker] = useState<{ query: string; start: number } | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);

  const matches = picker
    ? candidates
        .filter((member) => member.name.toLowerCase().includes(picker.query.toLowerCase()) || member.email.startsWith(picker.query.toLowerCase()))
        .slice(0, 6)
    : [];

  function update(next: string, caret: number) {
    onChange(next);
    setPicker(activeMentionQuery(next, caret));
    setPickerIndex(0);
  }

  function choose(member: MentionCandidate) {
    if (!picker) return;
    const token = `${mentionToken(member.name)} `;
    const next = value.slice(0, picker.start) + token + value.slice(picker.start + picker.query.length + 1);
    onChange(next);
    onMention(member);
    setPicker(null);
    window.requestAnimationFrame(() => {
      const caret = picker.start + token.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (picker && matches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPickerIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPickerIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(matches[pickerIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPicker(null);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
  }

  const listId = `${id}-mentions`;
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        ref={inputRef}
        value={value}
        rows={rows}
        maxLength={4000}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => update(event.target.value, event.target.selectionStart ?? event.target.value.length)}
        onKeyDown={onKeyDown}
        onBlur={() => window.setTimeout(() => setPicker(null), 150)}
        aria-autocomplete="list"
        aria-controls={picker && matches.length > 0 ? listId : undefined}
        className="w-full resize-y rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[13px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100 disabled:opacity-60"
      />
      {picker && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention a member"
          className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {matches.map((member, index) => (
            <li key={member.email}>
              <button
                type="button"
                role="option"
                aria-selected={index === pickerIndex}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(member);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] ${
                  index === pickerIndex ? "bg-[#f0fafb] text-cyan-900" : "text-ink"
                }`}
              >
                <span className="font-semibold">{member.name}</span>
                <span className="truncate text-[11px] text-neutral-400">{member.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
