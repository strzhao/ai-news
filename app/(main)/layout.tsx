import AppShell from "@/app/components/app-shell";

export default function MainLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return <AppShell>{children}</AppShell>;
}
