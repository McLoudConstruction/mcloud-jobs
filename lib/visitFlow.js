// Rules for the tech's status buttons on a visit. Pure logic so it can be tested; the server
// route applies the result to the database.

export const MINUTE_CHOICES = [10, 20, 30, 40, 50, 60];

const ALLOWED_FROM = {
  on_the_way: ['scheduled', 'on_the_way'], // pressing again updates the ETA ("running late")
  started: ['scheduled', 'on_the_way'],
  finished: ['started'],
};

// Returns { error } or { visitPatch, jobPatch, eventKind, eventDetails }.
// othersActive: number of other visits on the job that are still scheduled / under way.
export const validMinutes = (m) => MINUTE_CHOICES.includes(Number(m)) || (Number.isInteger(Number(m)) && Number(m) >= 5 && Number(m) <= 120 && Number(m) % 5 === 0);

// restoration: a water job needs several visits, so finishing a visit does not complete the job (Complete job is its own step).
export function planTransition({ visit, action, minutes, live = false, othersActive = 0, restoration = false, now = new Date() }) {
  if (!ALLOWED_FROM[action]) return { error: 'Unknown action.' };
  if (!ALLOWED_FROM[action].includes(visit.status)) {
    return { error: `A visit that is ${visit.status.replace(/_/g, ' ')} cannot be set to ${action.replace(/_/g, ' ')}.` };
  }
  const ts = now.toISOString();

  if (action === 'on_the_way') {
    if (!validMinutes(minutes)) return { error: 'Choose a time from 5 to 120 minutes, in steps of 5.' };
    return {
      visitPatch: { status: 'on_the_way', minutes_out: Number(minutes), on_the_way_at: ts, eta_live: live === true },
      jobPatch: { status: 'on_the_way' },
      eventKind: 'visit_on_the_way',
      eventDetails: { visit_id: visit.id, minutes: Number(minutes), ...(live === true ? { live: true } : {}) },
    };
  }

  if (action === 'started') {
    return {
      visitPatch: { status: 'started', started_at: ts },
      jobPatch: { status: 'in_progress' },
      eventKind: 'visit_started',
      eventDetails: { visit_id: visit.id },
    };
  }

  // restoration: the visit is done and the job stays open until someone completes it
  if (restoration) {
    return {
      visitPatch: { status: 'finished', finished_at: ts },
      jobPatch: { status: othersActive === 0 ? 'in_progress' : 'booked' },
      eventKind: 'visit_finished',
      eventDetails: { visit_id: visit.id, job_completed: false },
      touchCustomerLastVisit: ts,
      keepOpen: true,
    };
  }

  // finished: the job is complete unless another visit is still planned (a return visit)
  const complete = othersActive === 0;
  return {
    visitPatch: { status: 'finished', finished_at: ts },
    jobPatch: complete ? { status: 'completed', completed_at: ts } : { status: 'booked' },
    eventKind: 'visit_finished',
    eventDetails: { visit_id: visit.id, job_completed: complete },
    touchCustomerLastVisit: ts,
  };
}
