import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { currentPeriodKeys } from '@/lib/periods';
import { GoalsClient } from '@/components/goals/GoalsClient';

export const dynamic = 'force-dynamic';

export default async function GoalsPage({ params }: { params: { wid: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  return (
    <GoalsClient
      workspaceId={params.wid}
      initialPeriods={currentPeriodKeys(new Date(), user.timezone)}
    />
  );
}
