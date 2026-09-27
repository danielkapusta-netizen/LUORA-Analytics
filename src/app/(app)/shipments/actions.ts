'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireUser } from '@/server/auth';
import { setPacked } from '@/server/services/shipping';
import { retryFailedTrackingPushes } from '@/server/services/tracking';

export async function retryFailedTrackingAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const count = await retryFailedTrackingPushes();
    revalidatePath('/shipments');
    return `Sending tracking again for ${count} label(s). Refresh in a moment.`;
  });
}

export async function setPackedAction(shipmentId: string, packed: boolean): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await setPacked(shipmentId, packed, user.id);
    revalidatePath('/shipments', 'layout');
    return packed ? 'Packed' : 'Not packed';
  });
}
