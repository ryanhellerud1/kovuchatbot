import { cookies } from 'next/headers';

import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { auth } from '../(auth)/auth';
import Script from 'next/script';

export const experimental_ppr = true;

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const isOpen = cookieStore.get('sidebar:state')?.value === 'true';
  const hasVisited = cookieStore.has('sidebar:state');
  
  // Default to open for new users, respect saved preference for returning users
  const defaultOpen = hasVisited ? isOpen : true;

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="beforeInteractive"
      />
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar user={session?.user} />
        <SidebarInset className="bg-transparent">{children}</SidebarInset>
      </SidebarProvider>
    </>
  );
}
