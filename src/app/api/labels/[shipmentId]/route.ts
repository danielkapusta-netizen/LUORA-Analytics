import { currentUser } from '@/server/auth';
import { getLabel } from '@/server/services/shipping';

export async function GET(_request: Request, { params }: { params: Promise<{ shipmentId: string }> }) {
  if (!(await currentUser())) return new Response('Unauthorized', { status: 401 });
  const { shipmentId } = await params;
  const label = await getLabel(shipmentId);
  if (!label) return new Response('Label not found', { status: 404 });
  const pdf = label.format === 'pdf';
  return new Response(new Uint8Array(label.content), {
    headers: {
      'Content-Type': pdf ? 'application/pdf' : 'application/octet-stream',
      'Content-Disposition': `${pdf ? 'inline' : 'attachment'}; filename="label-${shipmentId.slice(0, 8)}.${label.format}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
