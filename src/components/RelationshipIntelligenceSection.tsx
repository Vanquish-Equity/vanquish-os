import RelationshipIntelligence from "./RelationshipIntelligence";
import {
  relationshipMembers,
  type RelationshipOption,
} from "@/lib/relationships/intelligence-queries";
export default async function RelationshipIntelligenceSection({
  people,
  allowed,
  partial = false,
}: {
  people: RelationshipOption[];
  allowed: boolean;
  partial?: boolean;
}) {
  const roster = allowed
    ? await relationshipMembers()
    : { members: [], partial: false, unavailable: true };
  return (
    <RelationshipIntelligence
      people={people.slice(0, 50)}
      members={roster.members}
      allowed={allowed}
      unavailable={roster.unavailable}
      optionsPartial={partial || roster.partial}
    />
  );
}
