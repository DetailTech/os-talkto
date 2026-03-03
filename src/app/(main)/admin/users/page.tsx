import { requireAdmin } from "@/lib/auth/server";
import { UsersAdmin } from "@/components/admin/users-admin";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireAdmin();

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
          <p className="text-muted-foreground mt-1">Manage local users and authentication mode.</p>
        </div>
        <UsersAdmin />
      </div>
    </div>
  );
}
