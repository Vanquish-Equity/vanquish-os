// Where a person's name should lead. The profile page only exists when its
// gate is open (see profile-access.ts); otherwise the caller keeps today's UI.
export function personProfileHref(id: string, profileOpen: boolean) {
  return profileOpen ? `/people/${id}` : null;
}
