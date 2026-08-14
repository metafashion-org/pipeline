import { AdminSidebar } from "@/components/layout/AdminSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <AdminSidebar />
      <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}
