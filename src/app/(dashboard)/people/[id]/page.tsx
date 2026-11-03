import { notFound, redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/access";

export default async function PersonProfileLink({ params }: {
  params: Promise<{ id: string }>;
}) {
  await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  redirect(`/people?contact=${id}`);
}
