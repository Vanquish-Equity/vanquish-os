// Synthetic rows for the round-trip test. All names and addresses are made up.
import type { Fixtures } from "./trip-recorder";

// The proxy (src/proxy.ts) verifies the session once per request.
export const PROXY_AUTH_CALLS = 1;

const NOW = "2026-10-01T12:00:00.000Z";
const rows = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

export function buildWorld(): Fixtures {
  const people = rows(30, (i) => ({
    id: `p${i}`,
    name: `Person ${String(i).padStart(2, "0")}`,
    title: "Operator",
    linkedin_url: null,
    primary_organization_id: `c${i}`,
    is_potential_lp: i % 3 === 0,
    organization: { id: `c${i}`, name: `Company ${i}` },
    person_emails: [{ email: `person${i}@synthetic.test`, is_primary: true }],
  }));
  const stage = { name: "Screening", is_terminal: false };
  const companies = rows(109, (i) => ({
    id: `c${i}`,
    name: `Company ${i}`,
    updated_at: NOW,
    last_activity_at: NOW,
    industry: { name: "Software" },
    company_aliases: [],
    deals: [{ id: `d${i}`, name: "Seed", archived_at: null, updated_at: NOW, last_activity_at: NOW, stage, priority: { name: "High" }, outcome: null }],
    investments: [],
    tasks: [{ id: `t${i}`, status: "open", archived_at: null }],
  }));
  const deals = rows(124, (i) => ({
    id: `d${i}`,
    name: "Seed",
    round: "Seed",
    first_seen_at: NOW,
    created_at: NOW,
    archived_at: null,
    potential_investment: 1000,
    updated_at: NOW,
    owner: null,
    last_activity_at: NOW,
    stage_id: "s1",
    company_id: `c${i % 109}`,
    stage,
    outcome: null,
    priority: { name: "High" },
    company: { id: `c${i % 109}`, name: `Company ${i % 109}`, deleted_at: null },
  }));
  const tasks = rows(5, (i) => ({
    id: `t${i}`,
    title: `Task ${i}`,
    owner: null,
    assignee_email: "member@synthetic.test",
    due_at: NOW,
    status: "open",
    priority_id: null,
    company_id: `c${i}`,
    deal_id: `d${i}`,
    deal: { name: "Seed", round: "Seed", first_seen_at: NOW, created_at: NOW },
    company: { id: `c${i}`, name: `Company ${i}` },
    priority: { name: "High" },
  }));
  return {
    tables: {
      app_members: [{ email: "member@synthetic.test", is_active: true, display_name: "Synthetic Member", avatar_path: "a/avatar.png" }],
      member_permissions: [{ permission: "documents" }, { permission: "portfolio" }],
      crm_boards: [{ id: "b1", name: "Board" }],
      people,
      companies,
      deals,
      tasks,
      person_groups: [{ id: "g1", name: "Group" }],
      pipeline_stages: [{ id: "s1", name: "Screening", sort_order: 1, is_terminal: false }],
      industries: [{ id: "i1", name: "Software" }],
      priorities: [{ id: "pr1", name: "High" }],
      deal_rounds: [{ id: "r1", name: "Seed" }],
      saved_views: [],
      person_last_interaction: [],
      notifications: [],
    },
    rpc: {
      customization_state: { views: true, kanban: true, templates: true },
      custom_fields_state: true,
      relationship_intelligence_state: { enabled: true, allowed: true },
      my_mailbox_connection: [{ connected: true, granted_scopes: ["gmail.readonly"], connected_at: NOW }],
      my_mailbox_connection_secret: [{ refresh_token_encrypted: "x", refresh_token_iv: "x", refresh_token_tag: "x", granted_scopes: [] }],
      chat_unread_counts: [],
      deal_assignee_directory: [{ email: "member@synthetic.test", display_name: "Synthetic Member", avatar_path: "a/avatar.png" }],
      assignable_members: [{ email: "member@synthetic.test", display_name: "Synthetic Member" }],
    },
  };
}
