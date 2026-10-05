"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { googleClient, GoogleError, resourceId, type GoogleClient } from "@/lib/google/client";
import { header } from "@/lib/google/mail-format";
import type { GmailMessage } from "@/lib/google/mail-types";
import { detectCompanies, registrableDomain, websiteDomain, type ScoutMessage } from "@/lib/scouting/detect";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; message?: string } | { ok: false; message: string };
export type ContactMode = "request" | "skip" | "auto";

const WINDOW_DAYS = 30;
const MESSAGE_CAP = 500;
const AUTO_SCAN_HOURS = 6;

async function scoutingSession() {
  const access = await getAccess();
  if (access.status !== "member") return null;
  const supabase = await createClient();
  // member_permissions RLS returns only the caller's own rows.
  const { data } = await supabase
    .from("member_permissions")
    .select("permission")
    .eq("email", access.email)
    .eq("permission", "email_scouting")
    .maybeSingle();
  return { email: access.email, supabase, allowed: Boolean(data) };
}
type Session = NonNullable<Awaited<ReturnType<typeof scoutingSession>>>;

async function mailboxMessages(client: GoogleClient, since: Date) {
  const query = [
    `after:${Math.floor(since.getTime() / 1000)}`,
    "-in:spam -in:trash -in:chats",
    "-category:promotions -category:social -category:forums -category:updates",
  ].join(" ");
  const ids: { id: string; threadId: string }[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ maxResults: "100", q: query });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await client.request<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(
      "gmail",
      `/messages?${params}`,
    );
    ids.push(...(page.messages ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && ids.length < MESSAGE_CAP);

  const messages: ScoutMessage[] = [];
  const wanted = ids.slice(0, MESSAGE_CAP);
  for (let start = 0; start < wanted.length; start += 5) {
    const group = await Promise.all(
      wanted.slice(start, start + 5).map(async ({ id }) => {
        try {
          return await client.request<GmailMessage>(
            "gmail",
            `/messages/${resourceId(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
          );
        } catch (error) {
          if (error instanceof GoogleError && error.code === "not_found") return null;
          throw error;
        }
      }),
    );
    for (const message of group) {
      if (!message?.internalDate) continue;
      messages.push({
        threadId: message.threadId,
        at: new Date(Number(message.internalDate)).toISOString(),
        from: header(message.payload, "From"),
        to: header(message.payload, "To"),
        cc: header(message.payload, "Cc"),
      });
    }
  }
  return { messages, capped: ids.length >= MESSAGE_CAP };
}

async function runScan(session: Session): Promise<Result> {
  if (!session.allowed) return { ok: false, message: "Email scouting isn't enabled for your account." };
  const startedAt = new Date();

  const [ignored, companies, emails, existing] = await Promise.all([
    session.supabase.rpc("scouting_ignored_domains") as unknown as Promise<{ data: string[] | null }>,
    session.supabase.from("companies").select("website").is("deleted_at", null) as unknown as Promise<{
      data: { website: string | null }[] | null;
    }>,
    session.supabase.from("person_emails").select("email,person:people(primary_organization_id)") as unknown as Promise<{
      data: { email: string; person: { primary_organization_id: string | null } | null }[] | null;
    }>,
    session.supabase.from("company_suggestions").select("id,domain,status") as unknown as Promise<{
      data: { id: string; domain: string; status: string }[] | null;
    }>,
  ]);

  const excluded = new Set<string>((ignored.data ?? []).map((domain) => domain.toLowerCase()));
  for (const row of companies.data ?? []) {
    const domain = websiteDomain(row.website);
    if (domain) excluded.add(domain);
  }
  const knownEmails = new Set<string>();
  for (const row of emails.data ?? []) {
    const email = row.email.toLowerCase();
    knownEmails.add(email);
    // A contact already linked to a company means that domain is covered.
    if (row.person?.primary_organization_id) excluded.add(registrableDomain(email.split("@")[1] ?? ""));
  }

  let client: GoogleClient;
  try {
    client = await googleClient();
  } catch (error) {
    return { ok: false, message: error instanceof GoogleError ? error.message : "Could not reach Google." };
  }
  if (!client.scopes.some((scope) => scope.endsWith("/gmail.readonly") || scope.endsWith("/gmail.modify"))) {
    return { ok: false, message: "Reconnect Google in Settings to allow reading your mailbox." };
  }

  let scan: Awaited<ReturnType<typeof mailboxMessages>>;
  try {
    scan = await mailboxMessages(client, new Date(startedAt.getTime() - WINDOW_DAYS * 86400000));
  } catch (error) {
    return { ok: false, message: error instanceof GoogleError ? error.message : "Gmail could not be read. Try again later." };
  }

  const found = detectCompanies(scan.messages, { ownEmail: session.email, excludedDomains: excluded, knownEmails });
  const byDomain = new Map((existing.data ?? []).map((row) => [row.domain, row]));
  let added = 0;
  for (const company of found) {
    const values = {
      thread_count: company.threadCount,
      two_way: company.twoWay,
      last_seen_at: company.lastSeen,
      contacts: company.contacts,
      updated_at: startedAt.toISOString(),
    };
    const previous = byDomain.get(company.domain);
    if (!previous) {
      const { error } = await session.supabase.from("company_suggestions").insert({
        ...values,
        member_email: session.email,
        domain: company.domain,
        suggested_name: company.suggestedName,
        first_seen_at: company.firstSeen,
      });
      if (!error) added += 1;
    } else if (previous.status === "open") {
      await session.supabase.from("company_suggestions").update(values).eq("id", previous.id);
    }
    // Accepted or dismissed suggestions are never reopened.
  }

  await session.supabase
    .from("scouting_settings")
    .upsert({ member_email: session.email, last_scanned_at: startedAt.toISOString(), updated_at: startedAt.toISOString() }, { onConflict: "member_email" });
  revalidatePath("/review");
  return {
    ok: true,
    message: `${added} new suggestion${added === 1 ? "" : "s"}${scan.capped ? ` (read the newest ${MESSAGE_CAP} emails of the last ${WINDOW_DAYS} days)` : ""}.`,
  };
}

export async function scanMailboxNow(): Promise<Result> {
  const session = await scoutingSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  const result = await runScan(session);
  revalidatePath("/settings");
  return result;
}

// Called quietly from the workspace; scans at most every few hours.
export async function maybeScanMailbox(): Promise<{ scanned: boolean }> {
  const session = await scoutingSession();
  if (!session?.allowed) return { scanned: false };
  const { data } = await session.supabase
    .from("scouting_settings")
    .select("last_scanned_at")
    .eq("member_email", session.email)
    .maybeSingle();
  const last = (data as { last_scanned_at: string | null } | null)?.last_scanned_at;
  if (last && Date.now() - Date.parse(last) < AUTO_SCAN_HOURS * 3600000) return { scanned: false };
  const result = await runScan(session);
  return { scanned: result.ok };
}

export async function setContactMode(mode: ContactMode): Promise<Result> {
  const session = await scoutingSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  if (!["request", "skip", "auto"].includes(mode)) return { ok: false, message: "Unknown option." };
  const { error } = await session.supabase
    .from("scouting_settings")
    .upsert({ member_email: session.email, contact_mode: mode, updated_at: new Date().toISOString() }, { onConflict: "member_email" });
  if (error) return { ok: false, message: "Could not save the setting." };
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

export async function acceptSuggestion(id: string, name: string): Promise<Result> {
  const session = await scoutingSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  const { error } = await session.supabase.rpc("accept_company_suggestion", { p_id: id, p_name: name });
  if (error) return { ok: false, message: error.message.startsWith("Enter") || error.message.startsWith("This") ? error.message : "Could not create the company." };
  revalidatePath("/review");
  revalidatePath("/companies");
  revalidatePath("/people");
  return { ok: true, message: "Company created." };
}

export async function dismissSuggestion(id: string): Promise<Result> {
  const session = await scoutingSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  const { data, error } = await session.supabase
    .from("company_suggestions")
    .update({ status: "dismissed", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "Could not dismiss the suggestion." };
  revalidatePath("/review");
  return { ok: true };
}

export async function decideContactRequest(id: string, accept: boolean): Promise<Result> {
  const session = await scoutingSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  if (accept) {
    const { error } = await session.supabase.rpc("accept_contact_request", { p_id: id });
    if (error) return { ok: false, message: "Could not add this contact." };
  } else {
    const { data, error } = await session.supabase
      .from("contact_requests")
      .update({ status: "declined", decided_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error || !data?.length) return { ok: false, message: "Could not decline this contact." };
  }
  revalidatePath("/review");
  revalidatePath("/people");
  return { ok: true };
}
