"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

// Removes `new` and keeps every other parameter.
export function withoutNewParam(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  params.delete("new");
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

// The "+ New" menu links to <page>?new=1. When that parameter arrives, on
// first load or while already on the page, call `open` once and take the
// parameter out of the URL (replace, so Back/Forward/reload never reopen the
// dialog). Closing the dialog does not reopen it. Only pages that pass
// `enabled` react, so pages that embed the same modal for another purpose are
// unaffected.
export function useOpenOnNewParam(enabled: boolean, open: () => void) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  const wanted = enabled && params.get("new") === "1";
  const search = params.toString();
  useEffect(() => {
    if (!wanted) return;
    openRef.current();
    router.replace(withoutNewParam(pathname, search), { scroll: false });
  }, [wanted, pathname, search, router]);
}
