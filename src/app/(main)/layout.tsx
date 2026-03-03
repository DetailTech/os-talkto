import { AppSidebar } from "@/components/app-sidebar";
import { requireUser } from "@/lib/auth/server";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar userRole={user.role} />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
