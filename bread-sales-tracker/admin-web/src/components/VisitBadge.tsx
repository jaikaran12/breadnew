import { metres } from '../routeOrder';
import type { VisitStatus } from '../types';
import { Badge } from './ui';

/** Location verdict of a visit as a coloured badge. */
export function VisitBadge(props: { status: VisitStatus | null | undefined; distanceM?: number | null; accuracyM?: number | null }) {
  if (!props.status) return null;
  const acc = props.accuracyM ? ` (GPS ±${Math.round(props.accuracyM)} m)` : '';
  if (props.status === 'ok') return <Badge tone="green" title={`At the shop${acc}`}>at shop{props.distanceM !== null && props.distanceM !== undefined ? ` · ${metres(props.distanceM)}` : ''}</Badge>;
  if (props.status === 'far') return <Badge tone="red" title={`Too far from the shop's saved location${acc}`}>far · {metres(props.distanceM ?? 0)}</Badge>;
  if (props.status === 'no_gps') return <Badge tone="amber" title="The phone gave no location (GPS off or not allowed)">no GPS</Badge>;
  return <Badge tone="gray" title="The shop has no saved location, so this could not be checked">shop location not saved</Badge>;
}

