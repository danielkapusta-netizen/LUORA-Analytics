'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireUser } from '@/server/auth';
import { retryFailedTrackingPushes } from '@/server/services/tracking';

export async function retryFailedTrackingAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const count = await retryFailedTrackingPushes();
    revalidatePath('/shipments');
    return `Sending tracking again for ${count} label(s). Refresh in a moment.`;
  });
}
