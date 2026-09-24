import type { Address, Carrier, LabelFormat, LabelSize, ParcelSpec, SenderSettings } from '../types';

export interface CarrierService {
  id: string;
  name: string;
  /** Needs a parcel locker / pickup point code. */
  requiresPickupPoint?: boolean;
}

export interface ShipmentRequest {
  /** Our shipment id, used as idempotency key where the carrier supports one. */
  shipmentId: string;
  service: string;
  sender: SenderSettings;
  receiver: Address;
  pickupPointId?: string | null;
  parcel: ParcelSpec;
  codAmount?: string | null;
  insuranceAmount?: string | null;
  currency: string;
  /** Printed on the label, usually the order number. */
  reference: string;
  /** Allegro Delivery: the buyer's delivery method from the order. */
  deliveryMethodId?: string | null;
  labelFormat: LabelFormat;
}

export interface ShipmentStatus {
  state: 'pending' | 'created' | 'failed';
  externalId: string;
  /** Allegro create-command id while the shipment is being created. */
  commandId?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  carrierCode?: string | null;
  error?: string | null;
  /** Seconds the carrier asked us to wait before polling again. */
  retryAfterSeconds?: number | null;
}

export type DeliveryStatus = 'in_transit' | 'ready_for_pickup' | 'delivered' | 'returned' | 'unknown';

export interface CarrierAdapter {
  readonly carrier: Carrier;
  services(): Promise<CarrierService[]>;
  createShipment(req: ShipmentRequest): Promise<ShipmentStatus>;
  /** Polls a shipment whose creation is still pending. */
  refreshShipment(ref: { externalId: string | null; commandId: string | null }): Promise<ShipmentStatus>;
  getLabels(externalIds: string[], options: { format: LabelFormat; size: LabelSize }): Promise<Buffer>;
  cancelShipment(externalId: string): Promise<void>;
  deliveryStatus?(ref: { trackingNumber: string; externalId: string | null; carrierCode: string | null }): Promise<DeliveryStatus>;
}

export function inpostTrackingUrl(trackingNumber: string): string {
  return `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(trackingNumber)}`;
}
