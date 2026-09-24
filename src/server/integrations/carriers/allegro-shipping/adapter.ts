// "Wysyłam z Allegro" (Allegro Delivery): buys labels at Allegro's rates for
// Allegro orders, using the delivery method the buyer chose at checkout.
import { randomUUID } from 'node:crypto';
import type { CarrierSettings } from '../../../db/schema';
import { parseRetryAfter } from '../../../http';
import type { AllegroClient } from '../../marketplaces/allegro/client';
import type { LabelFormat, LabelSize } from '../../types';
import { inpostTrackingUrl, type CarrierAdapter, type CarrierService, type DeliveryStatus, type ShipmentRequest, type ShipmentStatus } from '../types';

/** Service id meaning "use the delivery method from the Allegro order". */
export const BUYER_CHOICE = 'buyer_choice';

interface CreateCommandStatus {
  commandId: string;
  status: 'IN_PROGRESS' | 'SUCCESS' | 'ERROR';
  errors?: { code?: string; message?: string; userMessage?: string }[];
  shipmentId?: string | null;
}

interface AllegroShipment {
  id: string;
  carrier?: string | null;
  packages: { waybill?: string | null; transportingInfo?: { carrierId?: string; carrierWaybill?: string }[] }[];
}

function contact(a: { name: string; company?: string | null; street: string; postalCode: string; city: string; countryCode: string; email?: string | null; phone?: string | null }) {
  return {
    name: a.name,
    company: a.company || undefined,
    street: a.street,
    postalCode: a.postalCode,
    city: a.city,
    countryCode: a.countryCode,
    email: a.email || undefined,
    phone: a.phone || undefined,
  };
}

export function buildCreateCommand(req: ShipmentRequest, settings: CarrierSettings, commandId: string) {
  const deliveryMethodId = req.service === BUYER_CHOICE ? req.deliveryMethodId : req.service;
  if (!deliveryMethodId) throw new Error('The Allegro order has no delivery method to ship with');
  const dim = (value: number) => ({ value, unit: 'CENTIMETER' });

  return {
    commandId,
    input: {
      deliveryMethodId,
      sender: contact(req.sender),
      receiver: { ...contact(req.receiver), point: req.pickupPointId || undefined },
      referenceNumber: req.reference.slice(0, 100),
      packages: [
        {
          type: 'PACKAGE',
          length: dim(req.parcel.lengthCm),
          width: dim(req.parcel.widthCm),
          height: dim(req.parcel.heightCm),
          weight: { value: req.parcel.weightKg, unit: 'KILOGRAMS' },
          textOnLabel: req.reference.slice(0, 50),
        },
      ],
      insurance: req.insuranceAmount ? { amount: req.insuranceAmount, currency: req.currency } : undefined,
      cashOnDelivery: req.codAmount
        ? { amount: req.codAmount, currency: req.currency, ownerName: settings.codOwnerName, iban: settings.codIban }
        : undefined,
      labelFormat: req.labelFormat === 'zpl' ? 'ZPL' : 'PDF',
    },
  };
}

const TRACKING_CODES: Record<string, DeliveryStatus> = {
  DELIVERED: 'delivered',
  AVAILABLE_FOR_PICKUP: 'ready_for_pickup',
  RETURNED: 'returned',
};

export class AllegroShippingAdapter implements CarrierAdapter {
  readonly carrier = 'allegro_shipping' as const;

  constructor(
    private readonly client: AllegroClient,
    private readonly settings: CarrierSettings = {},
  ) {}

  async services(): Promise<CarrierService[]> {
    const data = await this.client.call<{ services: { id: { deliveryMethodId: string }; name: string }[] }>(
      'GET',
      '/shipment-management/delivery-services',
    );
    return [
      { id: BUYER_CHOICE, name: "Buyer's delivery method" },
      ...data.services.map((s) => ({ id: s.id.deliveryMethodId, name: s.name })),
    ];
  }

  async createShipment(req: ShipmentRequest): Promise<ShipmentStatus> {
    if (req.codAmount && !this.settings.codIban) {
      return { state: 'failed', externalId: '', error: 'Cash on delivery needs a bank account (IBAN) in the Allegro Delivery settings' };
    }
    // Our shipment id doubles as the command id, so a retried request can't create a second shipment.
    const body = buildCreateCommand(req, this.settings, req.shipmentId);
    const response = await this.client.callWithHeaders('POST', '/shipment-management/shipments/create-commands', { body });
    return {
      state: 'pending',
      externalId: '',
      commandId: body.commandId,
      retryAfterSeconds: (parseRetryAfter(response.headers.get('retry-after')) ?? 2000) / 1000,
    };
  }

  async refreshShipment(ref: { externalId: string | null; commandId: string | null }): Promise<ShipmentStatus> {
    let shipmentId = ref.externalId;
    if (!shipmentId) {
      if (!ref.commandId) throw new Error('Allegro shipment has neither a shipment id nor a command id');
      const response = await this.client.callWithHeaders<CreateCommandStatus>(
        'GET',
        `/shipment-management/shipments/create-commands/${ref.commandId}`,
      );
      const command = response.data;
      if (command.status === 'ERROR') {
        const error = command.errors?.map((e) => e.userMessage ?? e.message ?? e.code).join('; ') || 'Allegro rejected the shipment';
        return { state: 'failed', externalId: '', commandId: ref.commandId, error };
      }
      if (command.status !== 'SUCCESS' || !command.shipmentId) {
        return {
          state: 'pending',
          externalId: '',
          commandId: ref.commandId,
          retryAfterSeconds: (parseRetryAfter(response.headers.get('retry-after')) ?? 2000) / 1000,
        };
      }
      shipmentId = command.shipmentId;
    }

    const shipment = await this.client.call<AllegroShipment>('GET', `/shipment-management/shipments/${shipmentId}`);
    const pkg = shipment.packages[0];
    const carrierCode = pkg?.transportingInfo?.[0]?.carrierId ?? shipment.carrier ?? 'ALLEGRO';
    const waybill = pkg?.waybill ?? pkg?.transportingInfo?.[0]?.carrierWaybill;
    if (!waybill) return { state: 'pending', externalId: shipmentId, commandId: ref.commandId, retryAfterSeconds: 3 };
    return {
      state: 'created',
      externalId: shipmentId,
      commandId: ref.commandId,
      trackingNumber: waybill,
      trackingUrl: carrierCode === 'INPOST' ? inpostTrackingUrl(waybill) : null,
      carrierCode,
    };
  }

  async getLabels(externalIds: string[], options: { format: LabelFormat; size: LabelSize }): Promise<Buffer> {
    return this.client.call<Buffer>('POST', '/shipment-management/label', {
      body: { shipmentIds: externalIds, pageSize: options.size, cutLine: false },
      headers: { Accept: 'application/octet-stream' },
      responseType: 'buffer',
    });
  }

  async cancelShipment(externalId: string): Promise<void> {
    await this.client.call('POST', '/shipment-management/shipments/cancel-commands', {
      body: { commandId: randomUUID(), input: { shipmentId: externalId } },
    });
  }

  async deliveryStatus(ref: { trackingNumber: string; carrierCode: string | null }): Promise<DeliveryStatus> {
    const data = await this.client.call<{
      waybills: { waybill: string; trackingDetails?: { statuses?: { code: string; occurredAt: string }[] } | null }[];
    }>('GET', `/order/carriers/${ref.carrierCode ?? 'ALLEGRO'}/tracking`, { query: { waybill: ref.trackingNumber } });
    const statuses = data.waybills[0]?.trackingDetails?.statuses ?? [];
    const latest = [...statuses].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1);
    if (!latest) return 'unknown';
    return TRACKING_CODES[latest.code] ?? 'in_transit';
  }
}
