export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return <>{children}</>;
}
