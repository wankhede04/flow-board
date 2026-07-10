import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { currentPeriodKeys } from '@/lib/periods';
import { ScheduleClient } from '@/components/schedule/ScheduleClient';

export const dynamic = 'force-dynamic';

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: { wid: string };
  searchParams?: { cal_error?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  return (
    <ScheduleClient
      workspaceId={params.wid}
      initialPeriods={currentPeriodKeys(new Date(), user.timezone)}
      calError={searchParams?.cal_error ?? null}
    />
  );
}
