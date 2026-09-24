// Picks a carrier, service and parcel size for an order from the shipping rules.
// Pure functions so the rules are easy to test.
import type { RuleConditions } from '../db/schema';
import type { Marketplace } from '../integrations/types';

export interface RoutableOrder {
  marketplace: Marketplace;
  deliveryMethodName: string | null;
  pickupPointId: string | null;
  codAmount: string | null;
}

export interface RuleLike {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  carrierAccountId: string;
  service: string;
  packagePresetId: string | null;
}

export interface CarrierLike {
  id: string;
  type: 'inpost' | 'allegro_shipping';
  enabled: boolean;
}

export interface RouteDecision {
  ruleId: string;
  ruleName: string;
  carrierAccountId: string;
  service: string;
  packagePresetId: string | null;
}

export function matchesRule(order: RoutableOrder, conditions: RuleConditions): boolean {
  if (conditions.marketplaces?.length && !conditions.marketplaces.includes(order.marketplace)) return false;
  if (conditions.deliveryMethodContains) {
    const needle = conditions.deliveryMethodContains.toLowerCase();
    if (!(order.deliveryMethodName ?? '').toLowerCase().includes(needle)) return false;
  }
  if (conditions.hasPickupPoint !== undefined && conditions.hasPickupPoint !== Boolean(order.pickupPointId)) return false;
  if (conditions.cod !== undefined && conditions.cod !== (Number(order.codAmount ?? 0) > 0)) return false;
  return true;
}

/** Allegro Delivery can only ship orders that were bought on Allegro. */
export function carrierSupportsOrder(carrier: CarrierLike, order: RoutableOrder): boolean {
  return carrier.type !== 'allegro_shipping' || order.marketplace === 'allegro';
}

export function chooseRoute(order: RoutableOrder, rules: RuleLike[], carriers: CarrierLike[]): RouteDecision | null {
  const byId = new Map(carriers.map((c) => [c.id, c]));
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const rule of sorted) {
    if (!rule.enabled) continue;
    const carrier = byId.get(rule.carrierAccountId);
    if (!carrier?.enabled || !carrierSupportsOrder(carrier, order)) continue;
    if (!matchesRule(order, rule.conditions)) continue;
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      carrierAccountId: rule.carrierAccountId,
      service: rule.service,
      packagePresetId: rule.packagePresetId,
    };
  }
  return null;
}

export function describeConditions(c: RuleConditions): string {
  const parts: string[] = [];
  if (c.marketplaces?.length) parts.push(`marketplace is ${c.marketplaces.join(' or ')}`);
  if (c.deliveryMethodContains) parts.push(`delivery method contains "${c.deliveryMethodContains}"`);
  if (c.hasPickupPoint !== undefined) parts.push(c.hasPickupPoint ? 'has a pickup point' : 'has no pickup point');
  if (c.cod !== undefined) parts.push(c.cod ? 'is cash on delivery' : 'is prepaid');
  return parts.length ? parts.join(', ') : 'every order';
}
