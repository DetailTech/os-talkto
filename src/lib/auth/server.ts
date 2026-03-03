import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { findUserById } from "./local-users";
import type { LocalUser } from "./types";

export async function getCurrentUser(): Promise<LocalUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await findUserById(payload.sub);
  if (!user) return null;

  return user;
}

export async function requireUser(): Promise<LocalUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<LocalUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
