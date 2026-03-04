import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { AppRole, LocalUser } from "./types";
import { ensureDefaultUserSettings } from "@/lib/db/user-settings";

const DATA_DIR = path.join(process.cwd(), ".data");
const USERS_PATH = path.join(DATA_DIR, "users.json");

interface UserStore {
  users: LocalUser[];
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashed] = stored.split(":");
  if (!salt || !hashed) return false;
  const attempt = scryptSync(password, salt, 64);
  const target = Buffer.from(hashed, "hex");
  return target.length === attempt.length && timingSafeEqual(target, attempt);
}

async function readStore(): Promise<UserStore> {
  if (!existsSync(USERS_PATH)) {
    return { users: [] };
  }
  try {
    const raw = await readFile(USERS_PATH, "utf8");
    const parsed = JSON.parse(raw) as UserStore;
    return { users: Array.isArray(parsed.users) ? parsed.users : [] };
  } catch {
    return { users: [] };
  }
}

async function writeStore(store: UserStore): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(USERS_PATH, JSON.stringify(store, null, 2));
}

async function allocateUserId(email: string, password: string): Promise<string> {
  void email;
  void password;
  return randomUUID();
}

export async function ensureBootstrapAdmin(): Promise<void> {
  const store = await readStore();
  if (store.users.length > 0) return;

  const email = process.env.LOCAL_ADMIN_EMAIL;
  const password = process.env.LOCAL_ADMIN_PASSWORD;
  if (!email || !password) return;
  const createdUser = await createUser({
    email: email.toLowerCase(),
    password,
    role: "admin",
  });
  try {
    await ensureDefaultUserSettings(createdUser.id);
  } catch (error) {
    // Avoid blocking auth bootstrap if Oracle settings provisioning is temporarily unavailable.
    console.error("Bootstrap user settings provisioning failed", error);
  }
}

export async function listUsers(): Promise<LocalUser[]> {
  await ensureBootstrapAdmin();
  const store = await readStore();
  return store.users.sort((a, b) => a.email.localeCompare(b.email));
}

export async function findUserByEmail(email: string): Promise<LocalUser | null> {
  await ensureBootstrapAdmin();
  const store = await readStore();
  return store.users.find((u) => u.email === email.toLowerCase()) || null;
}

export async function findUserById(id: string): Promise<LocalUser | null> {
  await ensureBootstrapAdmin();
  const store = await readStore();
  return store.users.find((u) => u.id === id) || null;
}

export async function createUser(input: {
  email: string;
  password: string;
  role?: AppRole;
}): Promise<LocalUser> {
  const store = await readStore();
  const normalizedEmail = input.email.toLowerCase();
  const exists = store.users.some((u) => u.email === normalizedEmail);
  if (exists) {
    throw new Error("A user with this email already exists");
  }

  const userId = await allocateUserId(normalizedEmail, input.password);

  const now = new Date().toISOString();
  const user: LocalUser = {
    id: userId,
    email: normalizedEmail,
    password_hash: hashPassword(input.password),
    role: input.role || "user",
    created_at: now,
    updated_at: now,
  };

  store.users.push(user);
  await writeStore(store);
  return user;
}

export async function upsertOidcUser(email: string): Promise<LocalUser> {
  const normalizedEmail = email.toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) return existing;

  const adminEmails = (process.env.OCI_ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const existingUsers = await listUsers();
  const role: AppRole =
    existingUsers.length === 0 || adminEmails.includes(normalizedEmail) ? "admin" : "user";
  const randomPassword = randomBytes(32).toString("base64url");

  return createUser({
    email: normalizedEmail,
    password: randomPassword,
    role,
  });
}

export async function authenticateUser(email: string, password: string): Promise<LocalUser | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  return verifyPassword(password, user.password_hash) ? user : null;
}

export async function updateUserRole(id: string, role: AppRole): Promise<void> {
  const store = await readStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) {
    throw new Error("User not found");
  }
  const adminCount = store.users.filter((u) => u.role === "admin").length;
  if (user.role === "admin" && role !== "admin" && adminCount <= 1) {
    throw new Error("At least one admin is required");
  }
  user.role = role;
  user.updated_at = new Date().toISOString();
  await writeStore(store);
}

export async function updateUserPassword(id: string, password: string): Promise<void> {
  const store = await readStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) {
    throw new Error("User not found");
  }
  user.password_hash = hashPassword(password);
  user.updated_at = new Date().toISOString();
  await writeStore(store);
}

export async function deleteUser(id: string): Promise<void> {
  const store = await readStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) return;
  const adminCount = store.users.filter((u) => u.role === "admin").length;
  if (user.role === "admin" && adminCount <= 1) {
    throw new Error("At least one admin is required");
  }

  store.users = store.users.filter((u) => u.id !== id);
  await writeStore(store);
}
