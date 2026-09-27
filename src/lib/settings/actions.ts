"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };
const BUCKET = "member-avatars";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

async function memberClient() {
  const access = await getAccess();
  if (access.status !== "member") return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  return { access, supabase, uid: claims.claims.sub };
}

export async function changeDisplayName(name: string): Promise<Result> {
  const member = await memberClient();
  if (!member) return { ok: false, message: "Sign in to continue." };
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 80 || /[\x00-\x1f\x7f]/.test(cleaned)) {
    return { ok: false, message: "Enter a name of up to 80 characters." };
  }
  const { error } = await member.supabase.rpc("set_my_display_name", { p_name: cleaned });
  if (error) return { ok: false, message: "Could not save your name. Try again." };
  revalidatePath("/", "layout");
  return { ok: true };
}

function validImage(bytes: Uint8Array, type: string) {
  if (type === "image/png")
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/webp")
    return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function changeAvatar(file: File | null): Promise<Result> {
  const member = await memberClient();
  if (!member) return { ok: false, message: "Sign in to continue." };
  const { supabase, access, uid } = member;
  const { data: profile, error: readError } = await supabase.from("app_members")
    .select("avatar_path").eq("email", access.email).single();
  if (readError) return { ok: false, message: "Could not load your profile." };

  let path: string | null = null;
  if (file) {
    if (file.size === 0 || file.size > MAX_AVATAR_BYTES) {
      return { ok: false, message: "Choose an image under 2 MB." };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validImage(bytes, file.type)) {
      return { ok: false, message: "Choose a PNG, JPEG or WebP image." };
    }
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
    path = `${uid}/avatar-${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (error) return { ok: false, message: "Could not upload the image. Try again." };
  }

  const { error } = await supabase.rpc("set_my_avatar", { p_path: path });
  if (error) {
    if (path) await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, message: "Could not save your photo. Try again." };
  }
  if (profile?.avatar_path && profile.avatar_path.startsWith(`${uid}/`)) {
    await supabase.storage.from(BUCKET).remove([profile.avatar_path]);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
