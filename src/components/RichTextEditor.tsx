"use client";

import { useEffect, useRef, useState } from "react";
import ComposerIcon, { type ComposerIconName } from "@/components/ComposerIcon";

type Command = "bold" | "italic" | "underline" | "strikeThrough" | "insertUnorderedList" | "insertOrderedList" | "removeFormat";

const BUTTONS: { command: Command; letter?: string; icon?: ComposerIconName; className?: string; title: string }[] = [
  { command: "bold", letter: "B", className: "font-bold", title: "Bold (Ctrl+B)" },
  { command: "italic", letter: "I", className: "italic", title: "Italic (Ctrl+I)" },
  { command: "underline", letter: "U", className: "underline", title: "Underline (Ctrl+U)" },
  { command: "strikeThrough", letter: "S", className: "line-through", title: "Strikethrough" },
  { command: "insertUnorderedList", icon: "bulletList", title: "Bulleted list" },
  { command: "insertOrderedList", icon: "numberList", title: "Numbered list" },
];

// A contentEditable rich text editor with a small Gmail-style formatting
// toolbar (bold, italic, underline, strikethrough, lists, links). It is
// uncontrolled: `initialHtml` seeds the editor once on mount, and every edit
// after that is read from the DOM and reported through `onChange`.
// Formatting itself uses the browser's own execCommand editing commands,
// same as most lightweight email composers. To load a different draft's
// body, remount with a fresh `key` (e.g. `key={draft?.id ?? "new"}`) rather
// than relying on a prop change, since the DOM content isn't React state.
export default function RichTextEditor({
  id,
  labelledBy,
  initialHtml,
  disabled = false,
  placeholder,
  onChange,
}: {
  id?: string;
  labelledBy?: string;
  initialHtml: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [active, setActive] = useState<Partial<Record<Command, boolean>>>({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
    // Seed once on mount only; the parent remounts this component (via
    // `key`) to load a different draft rather than passing a new value here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emitChange() {
    onChange(editorRef.current?.innerHTML ?? "");
  }

  function updateActiveState() {
    try {
      setActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strikeThrough: document.queryCommandState("strikeThrough"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
        insertOrderedList: document.queryCommandState("insertOrderedList"),
      });
    } catch {
      // queryCommandState throws when the selection isn't in an editable region.
    }
  }

  function run(command: Command) {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command);
    emitChange();
    updateActiveState();
  }

  function openLink() {
    if (disabled) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
    setLinkValue("");
    setLinkOpen(true);
  }

  function restoreSelection() {
    const selection = window.getSelection();
    if (savedRangeRef.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
  }

  function applyLink() {
    const url = linkValue.trim();
    editorRef.current?.focus();
    restoreSelection();
    if (url) {
      const withProtocol = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
      document.execCommand("createLink", false, withProtocol);
    }
    setLinkOpen(false);
    emitChange();
  }

  function removeLink() {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand("unlink");
    setLinkOpen(false);
    emitChange();
  }

  const buttonClass = (isActive: boolean) =>
    `flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[12px] transition ${
      isActive ? "bg-ink text-white" : "text-neutral-600 hover:bg-neutral-100"
    }`;

  return (
    <div>
      {!disabled && (
        <div className="mb-1.5 flex flex-wrap items-center gap-0.5 rounded-lg border border-neutral-200 bg-[#f7f9fa] p-1" role="toolbar" aria-label="Text formatting">
          {BUTTONS.map((button) => (
            <button
              key={button.command}
              type="button"
              title={button.title}
              aria-pressed={Boolean(active[button.command])}
              className={buttonClass(Boolean(active[button.command]))}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(button.command)}
            >
              {button.icon ? <ComposerIcon name={button.icon} /> : <span className={button.className}>{button.letter}</span>}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-neutral-200" aria-hidden />
          <button type="button" title="Insert link" aria-pressed={linkOpen} className={buttonClass(linkOpen)} onMouseDown={(event) => event.preventDefault()} onClick={openLink}>
            <ComposerIcon name="link" />
          </button>
          <button
            type="button"
            title="Clear formatting"
            className={buttonClass(false)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run("removeFormat")}
          >
            <ComposerIcon name="clear" />
          </button>
        </div>
      )}
      {linkOpen && (
        <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-[#f0fafb] p-2">
          <input
            autoFocus
            type="text"
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkOpen(false);
              }
            }}
            placeholder="https://…"
            aria-label="Link URL"
            className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-cyan-300"
          />
          <button type="button" onClick={applyLink} className="flex-shrink-0 rounded-md bg-ink px-2.5 py-1.5 text-[11.5px] font-semibold text-white">
            Add
          </button>
          <button type="button" onClick={removeLink} className="flex-shrink-0 rounded-md border border-neutral-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-600">
            Remove
          </button>
          <button type="button" onClick={() => setLinkOpen(false)} className="flex-shrink-0 rounded-md border border-neutral-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-600">
            Cancel
          </button>
        </div>
      )}
      <div
        id={id}
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emitChange}
        onKeyUp={updateActiveState}
        onMouseUp={updateActiveState}
        onFocus={updateActiveState}
        className="vq-rich-text min-h-[240px] flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
      />
    </div>
  );
}
