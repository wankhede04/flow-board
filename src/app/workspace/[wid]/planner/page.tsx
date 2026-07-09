import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { PlannerClient } from '@/components/planner/PlannerClient';

export const dynamic = 'force-dynamic';

export default async function PlannerPage({ params }: { params: { wid: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  return <PlannerClient workspaceId={params.wid} />;
}
