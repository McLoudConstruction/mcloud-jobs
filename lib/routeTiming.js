// Time estimates for a sales route: drive time between stops (from the road
// route legs) plus the time planned at each stop, and an arrival time for
// every stop that is still ahead.
//
// A stop carries its own optional dwell_minutes. When it does not, the
// route-wide default applies. Skipped stops are off the route entirely: no
// drive leg, no time on site, no arrival.

export const DEFAULT_DWELL_MINUTES = 15;

export function isSkipped(stop) {
  return !!stop.skipped_at;
}

export function isPending(stop) {
  return !stop.visited_at && !stop.skipped_at;
}

export function dwellFor(stop, defaultDwell) {
  const own = stop.dwell_minutes;
  if (own != null && own !== '' && Number.isFinite(Number(own)) && Number(own) >= 0) return Number(own);
  return Number.isFinite(Number(defaultDwell)) ? Number(defaultDwell) : DEFAULT_DWELL_MINUTES;
}

function hasCoords(s) {
  return s.property_lat != null && s.property_lng != null;
}

// The route points sent to the road router: the start, then every stop that
// is not skipped and has a location, in order.
export function routeStopsOf(stops) {
  return stops.filter(s => !s.skipped_at && hasCoords(s));
}

// Lines the road route legs up with the stops list. legs[k] is the leg that
// arrives at the k-th routed stop (start first, or first stop first when
// there is no start). Returns an array the same length as `stops`, with
// null for skipped stops, stops without a location, and a stop that is the
// first point of a route with no start (nothing to arrive from).
export function legsByStop(stops, legs, hasStart) {
  const result = stops.map(() => null);
  if (!legs) return result;
  let routedIndex = 0;
  stops.forEach((s, i) => {
    if (s.skipped_at || !hasCoords(s)) return;
    const legIndex = hasStart ? routedIndex : routedIndex - 1;
    routedIndex += 1;
    if (legIndex >= 0 && legIndex < legs.length) result[i] = legs[legIndex];
  });
  return result;
}

// Builds the schedule. Options:
//   stops         the route's stops in order
//   legs          road route legs aligned with the routed points, or null
//   hasStart      whether the route has a start point (legs begin there)
//   defaultDwell  minutes planned at a stop with no dwell of its own
//   departAt      Date the route leaves the start (used before any stop
//                 is visited)
//   now           Date used as the baseline when a stop was just visited
//                 but its visit time is missing
//
// Returns {
//   rows:  per stop { arrive: Date|null, leave: Date|null, driveSeconds,
//                     dwellMinutes, pending, skipped }
//   driveSeconds, dwellMinutes, totalMinutes: for stops still ahead
//   finishAt: Date|null  when the last pending stop is done
//   nextArrival: Date|null  when the next pending stop is reached
// }
export function buildTimeline({ stops, legs, hasStart, defaultDwell, departAt, now = new Date() }) {
  const legFor = legsByStop(stops, legs, hasStart);

  // Baseline: leaving the last visited stop when the route is under way,
  // otherwise the planned departure.
  let clock = departAt ? new Date(departAt) : null;
  const lastVisited = [...stops].reverse().find(s => s.visited_at);
  if (lastVisited) {
    const left = new Date(lastVisited.visited_at);
    // Time on site at the stop just visited is already behind us.
    clock = Number.isNaN(left.getTime()) ? new Date(now) : left;
  }

  let driveSeconds = 0;
  let dwellMinutes = 0;
  let finishAt = null;
  let nextArrival = null;
  let known = !!clock;
  // With no start point, the first routed stop is where the day begins, so
  // there is no drive to it.
  const firstRouted = stops.findIndex(s => !s.skipped_at && hasCoords(s));

  const rows = stops.map((s, i) => {
    const pending = isPending(s);
    const skipped = isSkipped(s);
    const dwell = dwellFor(s, defaultDwell);
    const row = { arrive: null, leave: null, driveSeconds: null, dwellMinutes: dwell, pending, skipped };
    if (!pending) return row;

    const leg = legFor[i];
    let legSeconds = leg && leg.seconds != null ? leg.seconds : null;
    if (legSeconds == null && !hasStart && i === firstRouted && !lastVisited) legSeconds = 0;
    row.driveSeconds = legSeconds;
    if (legSeconds != null) driveSeconds += legSeconds;
    dwellMinutes += dwell;

    if (known && clock && (legSeconds != null || !hasCoords(s))) {
      const arrive = new Date(clock.getTime() + (legSeconds || 0) * 1000);
      const leave = new Date(arrive.getTime() + dwell * 60000);
      row.arrive = arrive;
      row.leave = leave;
      clock = leave;
      finishAt = leave;
      if (!nextArrival) nextArrival = arrive;
    } else {
      // A gap in the legs (a stop with no location) means later times
      // would be guesses, so stop producing them.
      known = false;
    }
    return row;
  });

  const totalMinutes = Math.round(driveSeconds / 60) + dwellMinutes;
  return { rows, driveSeconds, dwellMinutes, totalMinutes, finishAt, nextArrival };
}

export function formatClock(date) {
  if (!date) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

// 'HH:MM' (from a time input or a Postgres time column) to a Date today.
export function timeStringToToday(value, base = new Date()) {
  if (!value) return null;
  const [h, m] = String(value).split(':');
  const hours = Number(h);
  const minutes = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export function dateToTimeString(date) {
  if (!date) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
