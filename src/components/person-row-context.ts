import { createContext } from "react";

// What a People row shares with the buttons rendered inside it (the Contact
// cell), so "Classify" and "Edit" act on the row's one menu and one dialog.
export type PersonRowApi = {
  openMenuFrom: (anchor: HTMLElement) => void;
  openEdit: () => void;
  menuOpen: boolean;
};

export const PersonRowContext = createContext<PersonRowApi | null>(null);

export type PeopleGroupOption = { id: string; name: string };

// Sent once for the whole table instead of once per row.
export const PeopleGroupsContext = createContext<PeopleGroupOption[]>([]);
