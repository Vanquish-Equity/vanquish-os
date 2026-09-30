import { loadAssignableMembers } from "@/lib/communications/queries";
import { memberLabel, type Member } from "@/lib/communications/drafts";
import { checkRecipient, primaryFirst } from "@/lib/communications/recipients";
import { loadAttentionDeals } from "@/lib/deals/attention-data";
import { dealHref } from "@/lib/deals/scope";
import { dealLabel } from "@/lib/deals/display";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// Everything Home shows, for one member. Portfolio and Documents data is
// only queried when the member has that permission; without it nothing
// from those areas (rows, names, counts or links) is loaded or returned.

export type HomeTask = {
  id: string;
  title: string;
  dueAt: string | null;
  context: string | null;
  contextHref: string | null;
};

export type HomeItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: "warn" | "info";
};

export type HomeNotice = {
  key: string;
  text: string;
  href: string;
  at: string;
};

export type HomeData = {
  tasks: { available: boolean; items: HomeTask[]; unassignedOpen: number };
  attention: HomeItem[];
  staleMore: number;
  notices: HomeNotice[];
  members: Member[];
};

const NOTICE_DAYS = 14;
const DONE_REQUIREMENT = ["received_found", "not_applicable", "waived"];

type TaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  company_id: string | null;
  deal_id: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  company: { id: string; name: string } | null;
  deal: { name: string; round: string | null; first_seen_at: string | null; created_at: string } | null;
};

type DraftRow = {
  id: string;
  subject: string;
  created_by: string;
  updated_at: string;
  recipients: {
    email_at_selection: string;
    person: {
      archived_at: string | null;
      is_potential_lp: boolean;
      person_emails: { email: string; is_primary: boolean }[];
    } | null;
    selected_email: { email: string } | null;
  }[];
};

type RequirementRow = {
  deal_id: string;
  deal: {
    id: string;
    name: string;
    round: string | null;
    first_seen_at: string | null;
    created_at: string;
    archived_at: string | null;
    company: { id: string; name: string; deleted_at: string | null } | null;
  } | null;
};

export async function loadHomeData(
  supabase: SupabaseClient,
  { email, canDocuments, canPortfolio }: { email: string; canDocuments: boolean; canPortfolio: boolean }
): Promise<HomeData> {
  const since = new Date(Date.now() - NOTICE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const noRows = Promise.resolve({ data: [], error: null, count: 0 });

  const [myTasks, unassigned, drafts, reviewOpen, attentionDeals, ddRows, portfolioCritical, members] =
    await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id,title,due_at,company_id,deal_id,assigned_by,assigned_at,company:companies(id,name),deal:deals(name,round,first_seen_at,created_at)"
        )
        .eq("assignee_email", email)
        .eq("status", "open")
        .is("archived_at", null)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(100) as unknown as Promise<{ data: TaskRow[] | null; error: { code?: string } | null }>,
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .is("assignee_email", null)
        .eq("status", "open")
        .is("archived_at", null) as unknown as Promise<{ count: number | null; error: unknown }>,
      supabase
        .from("email_drafts")
        .select(
          "id,subject,created_by,updated_at,recipients:email_draft_recipients(email_at_selection,person:people(archived_at,is_potential_lp,person_emails(email,is_primary)),selected_email:person_emails(email))"
        )
        .eq("created_by", email)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(20) as unknown as Promise<{ data: DraftRow[] | null }>,
      supabase
        .from("review_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "open") as unknown as Promise<{ count: number | null }>,
      loadAttentionDeals(supabase, { canDocuments }),
      (canDocuments
        ? supabase
            .from("document_requirements")
            .select(
              "deal_id,deal:deals!inner(id,name,round,first_seen_at,created_at,archived_at,company:companies(id,name,deleted_at))"
            )
            .eq("scope", "deal_dd")
            .eq("criticality", "critical")
            .not("status", "in", `(${DONE_REQUIREMENT.join(",")})`)
            .is("archived_at", null)
            .is("deal.archived_at", null)
        : noRows) as unknown as Promise<{ data: RequirementRow[] | null }>,
      // Portfolio checklists are both Portfolio and Documents data.
      (canDocuments && canPortfolio
        ? supabase
            .from("document_requirements")
            .select("id", { count: "exact", head: true })
            .in("scope", ["spv", "investor_spv", "spv_company"])
            .eq("criticality", "critical")
            .eq("status", "missing")
            .is("archived_at", null)
        : noRows) as unknown as Promise<{ count: number | null }>,
      loadAssignableMembers(supabase),
    ]);

  const name = (memberEmail: string) => memberLabel(members, memberEmail);

  // My tasks (needs migration 0017; without it the section says so).
  const tasksAvailable = !myTasks.error;
  const taskRows = tasksAvailable ? myTasks.data ?? [] : [];
  const tasks: HomeTask[] = taskRows.map((task) => {
    const dealName = task.deal
      ? dealLabel({
          name: task.deal.name,
          round: task.deal.round,
          companyName: task.company?.name,
          firstSeenAt: task.deal.first_seen_at,
          createdAt: task.deal.created_at,
        })
      : null;
    return {
      id: task.id,
      title: task.title,
      dueAt: task.due_at,
      context: dealName ?? task.company?.name ?? null,
      contextHref:
        task.company_id && task.deal_id
          ? `${dealHref(task.company_id, task.deal_id)}#tasks`
          : task.company_id
            ? `/companies/${task.company_id}`
            : null,
    };
  });

  // Needs attention.
  const attention: HomeItem[] = [];
  for (const draft of drafts.data ?? []) {
    const toReview = draft.recipients.filter(
      (row) =>
        checkRecipient({
          emailAtSelection: row.email_at_selection,
          person: row.person
            ? {
                archived: row.person.archived_at !== null,
                isPotentialLp: row.person.is_potential_lp,
                emails: primaryFirst(row.person.person_emails ?? []),
              }
            : null,
          selectedEmail: row.selected_email?.email ?? null,
        }).issue !== null
    ).length;
    if (toReview > 0) {
      attention.push({
        key: `draft-${draft.id}`,
        title: draft.subject.trim() || "Untitled draft",
        detail: `Email draft · ${toReview} recipient${toReview === 1 ? "" : "s"} to review`,
        href: `/communications/${draft.id}`,
        tone: "warn",
      });
    }
  }

  if (canDocuments) {
    const byDeal = new Map<string, { row: RequirementRow; count: number }>();
    for (const row of ddRows.data ?? []) {
      if (!row.deal || row.deal.company?.deleted_at) continue;
      const entry = byDeal.get(row.deal_id) ?? { row, count: 0 };
      entry.count += 1;
      byDeal.set(row.deal_id, entry);
    }
    [...byDeal.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .forEach(({ row, count }) => {
        const deal = row.deal!;
        attention.push({
          key: `dd-${deal.id}`,
          title: dealLabel({
            name: deal.name,
            round: deal.round,
            companyName: deal.company?.name,
            firstSeenAt: deal.first_seen_at,
            createdAt: deal.created_at,
          }),
          detail: `Due diligence · ${count} critical item${count === 1 ? "" : "s"} outstanding`,
          href: `${dealHref(deal.company?.id ?? "", deal.id)}#due-diligence`,
          tone: "warn",
        });
      });
  }

  if (canDocuments && canPortfolio && (portfolioCritical.count ?? 0) > 0) {
    const count = portfolioCritical.count ?? 0;
    attention.push({
      key: "portfolio-critical",
      title: "Portfolio documents",
      detail: `${count} critical document${count === 1 ? "" : "s"} missing`,
      href: "/portfolio?filter=critical_missing",
      tone: "warn",
    });
  }

  if ((reviewOpen.count ?? 0) > 0) {
    const count = reviewOpen.count ?? 0;
    attention.push({
      key: "review",
      title: "Review queue",
      detail: `${count} open item${count === 1 ? "" : "s"} to decide`,
      href: "/review",
      tone: "info",
    });
  }

  const stale = attentionDeals.staleDeals;
  stale.slice(0, 3).forEach((deal) => {
    attention.push({
      key: `stale-${deal.id}`,
      title: deal.name,
      detail: `No activity for ${deal.daysSinceActivity} days · ${deal.stageName ?? "No stage"}`,
      href: dealHref(deal.companyId, deal.id),
      tone: "info",
    });
  });

  // Notices: real events addressed to this member.
  const notices: HomeNotice[] = [];
  for (const task of taskRows) {
    if (!task.assigned_by || task.assigned_by === email || !task.assigned_at || task.assigned_at < since) continue;
    notices.push({
      key: `task-${task.id}`,
      text: `${name(task.assigned_by)} assigned you “${task.title}”`,
      href: `/tasks?view=mine#task-${task.id}`,
      at: task.assigned_at,
    });
  }
  for (const draft of drafts.data ?? []) {
    if (draft.created_by === email || draft.updated_at < since) continue;
    notices.push({
      key: `draft-${draft.id}`,
      text: `${name(draft.created_by)} prepared the email draft “${draft.subject.trim() || "Untitled draft"}” for you`,
      href: `/communications/${draft.id}`,
      at: draft.updated_at,
    });
  }
  notices.sort((a, b) => b.at.localeCompare(a.at));

  return {
    tasks: { available: tasksAvailable, items: tasks, unassignedOpen: tasksAvailable ? unassigned.count ?? 0 : 0 },
    attention,
    staleMore: Math.max(0, stale.length - 3),
    notices: notices.slice(0, 8),
    members,
  };
}
