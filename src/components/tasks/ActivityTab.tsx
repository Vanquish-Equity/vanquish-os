import type { ReactNode } from "react";
import Link from "next/link";
import LocalTime from "@/components/LocalTime";
import { can, type AccessState } from "@/lib/auth/permissions";
import { loadDirectory } from "@/lib/chat/queries";
import { formatDay } from "@/lib/format-datetime";
import { loadNotifications } from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";
import {
  contactRequestHref,
  documentHref,
  interactionHref,
  LANE_HREFS,
  openTaskHref,
  proposalHref,
  reviewItemHref,
  suggestionHref,
} from "@/lib/tasks/activity-links";

type Member = Extract<AccessState, { status: "member" }>;

type Lane = {
  title: string;
  href: string;
  items: { id: string; label: string; href: string; detail: ReactNode; anchor?: string }[];
};

// Tasks > Activity (the former Action center at /inbox). Runs only when this
// tab is the active one. Email and meeting activity, documents, notifications
// and decisions in one place; mailbox content stays private (only the subject
// and date of CRM-matched events are read). The Documents lane is read only
// for members with the Documents permission, as before.
export default async function ActivityTab({ access }: { access: Member }) {
  const db = await createClient();
  const canDocuments = can(access, "documents");
  const [directory, tasks, proposals, reviews, scouting, contacts, activity, documents] = await Promise.all([
    loadDirectory(db),
    db.from("tasks").select("id,title,due_at,company_id,deal_id").eq("status", "open").is("archived_at", null).order("due_at", { nullsFirst: false }).limit(100),
    db.from("change_proposals").select("id,field_name,created_at").eq("status", "pending").order("created_at").limit(100),
    db.from("review_items").select("id,review_type,created_at").eq("status", "open").order("created_at").limit(100),
    db.from("company_suggestions").select("id,suggested_name,created_at").eq("status", "open").limit(100),
    db.from("contact_requests").select("id,email,created_at").eq("status", "pending").limit(100),
    db.from("interactions").select("id,type,subject,occurred_at,company_id,deal_id").not("source_event_id", "is", null).is("archived_at", null).order("occurred_at", { ascending: false }).limit(50),
    canDocuments
      ? db.from("document_analysis").select("document_id,document:documents(name)").eq("status", "pending").limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const notifications = await loadNotifications(db, access.email, directory, { limit: 50 });

  const lanes: Lane[] = [
    {
      title: "Email & meeting activity",
      href: LANE_HREFS.activity,
      items: (activity.data ?? []).map((item) => ({
        id: item.id,
        label: item.subject ?? `${item.type} activity`,
        href: interactionHref(item),
        detail: <LocalTime date={item.occurred_at} mode="day" />,
        anchor: `interaction:${item.id}`,
      })),
    },
    ...(canDocuments
      ? [
          {
            title: "Documents to review",
            href: LANE_HREFS.documents,
            items: (documents.data ?? []).map((item) => ({
              id: item.document_id,
              label: (item.document as unknown as { name: string } | null)?.name ?? "Document review",
              href: documentHref(item.document_id),
              detail: "Metadata needs approval",
              anchor: `document:${item.document_id}`,
            })),
          },
        ]
      : []),
    {
      title: "Notifications",
      href: LANE_HREFS.notifications,
      items: (notifications ?? []).map((item) => ({
        id: item.id,
        label: item.title,
        href: item.href ?? "/notifications",
        detail: "Open notification",
      })),
    },
    {
      title: "Open tasks",
      href: LANE_HREFS.tasks,
      items: (tasks.data ?? []).map((item) => ({
        id: item.id,
        label: item.title,
        href: openTaskHref(item.id),
        detail: item.due_at ? `Due ${formatDay(item.due_at.slice(0, 10))}` : "No due date",
      })),
    },
    {
      title: "Changes to approve",
      href: LANE_HREFS.changes,
      items: (proposals.data ?? []).map((item) => ({
        id: item.id,
        label: `Change to ${item.field_name}`,
        href: proposalHref(item.id),
        detail: "Pending decision",
      })),
    },
    {
      title: "Review & scouting",
      href: LANE_HREFS.review,
      items: [
        ...(reviews.data ?? []).map((item) => ({
          id: item.id,
          label: item.review_type.replaceAll("_", " "),
          href: reviewItemHref(item.id),
          detail: "Import review",
        })),
        ...(scouting.data ?? []).map((item) => ({
          id: item.id,
          label: item.suggested_name,
          href: suggestionHref(item.id),
          detail: "Company suggestion",
        })),
        ...(contacts.data ?? []).map((item) => ({
          id: item.id,
          label: item.email,
          href: contactRequestHref(item.id),
          detail: "Contact approval",
        })),
      ],
    },
  ];

  const failed = [tasks, proposals, reviews, scouting, contacts, activity, documents].some((result) => result.error);

  return (
    <div className="min-w-0">
      <p className="mb-4 text-[12.5px] text-neutral-500">
        Email and meeting activity, documents, notifications and decisions in one place. Mailbox content stays private.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        {lanes.map((lane) => (
          <section key={lane.title} className="vq-card-static min-w-0 rounded-[14px] bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-ink">
                {lane.title} <span className="ml-1 text-neutral-400">{lane.items.length}</span>
              </h2>
              <Link href={lane.href} className="shrink-0 text-[12px] font-semibold text-cyan-800">
                Open
              </Link>
            </div>
            <div className="mt-3 divide-y divide-neutral-100">
              {lane.items.length === 0 && <p className="py-4 text-[12px] text-neutral-400">All caught up.</p>}
              {lane.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  data-comment-anchor={item.anchor}
                  data-comment-label={item.label}
                  data-comment-value={item.label}
                  className="flex justify-between gap-3 rounded-lg py-3 text-[13px] hover:bg-cyan-50"
                >
                  <span className="min-w-0 break-words font-medium text-ink">{item.label}</span>
                  <span className="shrink-0 text-[11px] text-neutral-400">{item.detail}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
      {failed && (
        <p role="status" className="mt-4 text-[12px] text-neutral-500">
          Some items couldn’t be loaded. Open the matching section to check them.
        </p>
      )}
    </div>
  );
}
