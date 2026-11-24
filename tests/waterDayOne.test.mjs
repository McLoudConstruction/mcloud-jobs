import test from 'node:test';
import assert from 'node:assert/strict';
import { planTransition } from '../lib/visitFlow.js';
import { usesDayOneSteps, gateFor, nextDayOneStep, stepStatus, missingSafety, missingWalkthrough, missingDayOne, categoryOf, canCompleteJob, cleanSafety, SAFETY_CHECKS } from '../lib/waterDayOne.js';

const row = (kind, extra = {}, at = '2026-11-24T10:00:00Z') => ({ kind, created_at: at, data: {}, customer_absent: false, ...extra });
const allChecks = Object.fromEntries(SAFETY_CHECKS.map(([k]) => [k, true]));

test('restoration services use Day 1 steps; carpet does not; unknown follows job type', () => {
  for (const s of ['extraction', 'mitigation', 'remediation']) assert.equal(usesDayOneSteps(s), true);
  assert.equal(usesDayOneSteps('carpet'), false);
  assert.equal(usesDayOneSteps('', 'water_restoration'), true);
  assert.equal(usesDayOneSteps('', 'floor_cleaning'), false);
});

test('finishing a restoration visit keeps the job open; carpet still completes', () => {
  const v = { id: 'v1', status: 'started' };
  const now = new Date('2026-11-24T15:00:00Z');
  const wet = planTransition({ visit: v, action: 'finished', othersActive: 0, restoration: true, now });
  assert.equal(wet.visitPatch.status, 'finished');
  assert.equal(wet.jobPatch.status, 'in_progress');
  assert.equal(wet.eventDetails.job_completed, false);
  assert.equal(planTransition({ visit: v, action: 'finished', othersActive: 1, restoration: true, now }).jobPatch.status, 'booked');
  assert.equal(planTransition({ visit: v, action: 'finished', othersActive: 0, now }).jobPatch.status, 'completed');
});

test('complete job needs no visit planned or under way', () => {
  assert.equal(canCompleteJob({ jobStatus: 'in_progress', activeVisits: 0 }).ok, true);
  assert.equal(canCompleteJob({ jobStatus: 'in_progress', activeVisits: 1 }).ok, false);
  assert.equal(canCompleteJob({ jobStatus: 'completed', activeVisits: 0 }).ok, false);
});

test('equipment waits for safety and authorization; extraction and demo wait for safety and category', () => {
  assert.equal(gateFor('equipment', []).step, 'safety');
  assert.equal(gateFor('equipment', [row('safety')]).step, 'authorization');
  assert.equal(gateFor('equipment', [row('safety'), row('authorization')]).blocked, false);
  // customer not present counts: the e-sign follow-up is the office's task
  assert.equal(gateFor('equipment', [row('safety'), row('authorization', { customer_absent: true })]).blocked, false);
  assert.equal(gateFor('demo', [row('safety')]).step, 'walkthrough');
  assert.equal(gateFor('extraction', [row('safety'), row('walkthrough', { data: { category: 2 } })]).blocked, false);
  assert.equal(gateFor('sketch', []).blocked, false);
});

test('next step runs safety, authorization, walkthrough in order, then nothing', () => {
  assert.equal(nextDayOneStep([]).step, 'safety');
  assert.equal(nextDayOneStep([row('safety')]).step, 'authorization');
  assert.equal(nextDayOneStep([row('safety'), row('authorization')]).step, 'walkthrough');
  assert.equal(nextDayOneStep([row('safety'), row('authorization'), row('walkthrough')]), null);
});

test('forms need every check and a category with a reason', () => {
  assert.equal(missingSafety({ checks: allChecks, source_stopped: true }).length, 0);
  assert.ok(missingSafety({ checks: { power: true }, source_stopped: true }).length);
  assert.ok(missingSafety({ checks: allChecks }).length);
  assert.ok(missingSafety({ checks: allChecks, source_stopped: false }).length);
  assert.equal(missingSafety({ checks: allChecks, source_stopped: false, source_note: 'Plumber on the way' }).length, 0);
  assert.ok(missingWalkthrough({ category: 4, reason: 'x' }).length);
  assert.equal(missingWalkthrough({ category: 3, reason: 'Sewage backup' }).length, 0);
  assert.equal(cleanSafety({ checks: { power: true }, source_stopped: true }).checks.slip, false);
});

test('a later walkthrough raises the category; unsigned authorization is flagged for the office', () => {
  const rows = [row('walkthrough', { data: { category: 1 } }, '2026-11-24T10:00:00Z'), row('walkthrough', { data: { category: 3 } }, '2026-11-24T12:00:00Z')];
  assert.equal(categoryOf(rows), 3);
  assert.equal(stepStatus([row('authorization', { customer_absent: true })]).authorization, 'absent');
  assert.ok(missingDayOne([row('safety'), row('authorization', { customer_absent: true }), row('walkthrough')]).some((m) => /e-sign/.test(m)));
  assert.equal(missingDayOne([row('safety'), row('authorization'), row('walkthrough')]).length, 0);
});
