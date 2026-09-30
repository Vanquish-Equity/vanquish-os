"use client";
import { useId, useRef, useState } from "react";
import { insertRecipient, suggestRecipients, type RecipientContact } from "@/lib/communications/contact-suggestions";

export default function RecipientInput({ id, value, contacts, disabled, className, placeholder, onChange }: {
  id: string; value: string; contacts: RecipientContact[]; disabled: boolean; className: string; placeholder: string; onChange: (value: string) => void;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  const suggestions = focused && !disabled && !dismissed ? suggestRecipients(contacts, value, caret) : [];
  const selected = Math.min(active, Math.max(0, suggestions.length - 1));
  function choose(email: string) {
    const next = insertRecipient(value, caret, email);
    onChange(next.value);
    setCaret(next.caret);
    setActive(0);
    setDismissed(true);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret); });
  }
  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={input} id={id} value={value} disabled={disabled} className={className} placeholder={placeholder}
        autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0}
        aria-controls={suggestions.length ? listId : undefined}
        aria-activedescendant={suggestions.length ? `${listId}-${selected}` : undefined}
        onFocus={(event) => { setFocused(true); setDismissed(false); setCaret(event.currentTarget.selectionStart ?? value.length); }}
        onBlur={() => setFocused(false)}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? value.length)}
        onChange={(event) => { onChange(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setActive(0); setDismissed(false); }}
        onKeyDown={(event) => {
          if (!suggestions.length || event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setActive((selected + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
          }
          if (event.key === "Enter") { event.preventDefault(); choose(suggestions[selected].email!); }
        }}
      />
      {suggestions.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Known contacts" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
          {suggestions.map((contact, index) => (
            <li key={contact.email} id={`${listId}-${index}`} role="option" aria-selected={index === selected}
              onPointerDown={(event) => event.preventDefault()} onClick={() => choose(contact.email!)}
              onPointerMove={() => setActive(index)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-[12px] ${index === selected ? "bg-cyan-50 text-cyan-900" : "text-ink hover:bg-neutral-50"}`}>
              <span className="block truncate font-semibold">{contact.name}</span>
              <span className="block truncate text-neutral-500">{contact.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
