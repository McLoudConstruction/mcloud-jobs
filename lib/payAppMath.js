// AIA G702 / G703 arithmetic for pay applications, in integer cents so the
// totals on the PDF, the invoice that gets created, and the ledger always
// agree to the penny (floating-point dollars drift by a cent surprisingly
// often once percentages are involved).
//
// Column meanings (G703):
//   C  scheduled value          — pay_app_sov_lines.scheduled_value
//   D  work completed previously — sum of column E from earlier, non-void,
//                                  submitted applications
//   E  work completed this period — pay_app_lines.work_completed_this_period
//   F  materials presently stored (not in D or E)
//   G  total completed and stored to date = D + E + F
//   H  balance to finish = C - G
//
// G702 summary:
//   retainage = (D + E) × completed-work %  +  F × stored-material %
//   less any retainage already released to date (final billing)
//   total earned less retainage = (D + E + F) - retainage held
//   current payment due = that − previous certificates for payment

export function toCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Shift the decimal point in the string, not by multiplying, so 1.005
  // becomes 101 cents rather than 100 (1.005 * 100 = 100.49999999999999).
  const str = String(v).trim();
  if (/^-?\d*\.?\d+$/.test(str)) return Math.round(Number(str + 'e2'));
  return Math.round(n * 100);
}
export const fromCents = c => Math.round(Number(c) || 0) / 100;

export function fmtCents(c) {
  const n = (Number(c) || 0) / 100;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + s;
}

const pctOf = (cents, pct) => Math.round((cents * (Number(pct) || 0)) / 100);

// sovLines:        [{ id, sort_order, item_no, description, scheduled_value, kind }]
// thisLines:       { [sov_line_id]: { work_completed_this_period, materials_stored } }
// priorByLine:     { [sov_line_id]: cents of column E on earlier applications }
// previousCertificatesCents: sum of "current payment due" on earlier applications
// opts: { retainageCompletedPercent, retainageStoredPercent, releaseToDateCents }
export function computePayApp({ sovLines, thisLines = {}, priorByLine = {}, previousCertificatesCents = 0, opts = {} }) {
  const pctC = Number(opts.retainageCompletedPercent ?? 0);
  const pctS = Number(opts.retainageStoredPercent ?? 0);
  const releaseCents = Math.max(0, Math.round(Number(opts.releaseToDateCents) || 0));

  const rows = [...(sovLines || [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(l => {
      const c = toCents(l.scheduled_value);
      const d = Math.round(priorByLine[l.id] || 0);
      const cur = thisLines[l.id] || {};
      const e = toCents(cur.work_completed_this_period);
      const f = toCents(cur.materials_stored);
      const g = d + e + f;
      return {
        id: l.id, item_no: l.item_no || '', description: l.description, kind: l.kind || 'base',
        c, d, e, f, g, h: c - g,
        percent: c > 0 ? Math.round((g / c) * 1000) / 10 : 0,
        over: g > c,
      };
    });

  const sum = key => rows.reduce((s, r) => s + r[key], 0);
  const totals = { c: sum('c'), d: sum('d'), e: sum('e'), f: sum('f'), g: sum('g'), h: sum('h') };

  const workToDate = totals.d + totals.e;
  const retainageOnWork = pctOf(workToDate, pctC);
  const retainageOnStored = pctOf(totals.f, pctS);
  const retainageGross = retainageOnWork + retainageOnStored;
  const retainageHeld = Math.max(0, retainageGross - releaseCents);
  const earnedLessRetainage = totals.g - retainageHeld;
  const currentPaymentDue = earnedLessRetainage - Math.round(previousCertificatesCents || 0);

  const warnings = [];
  if (rows.some(r => r.over)) warnings.push('One or more lines are billed beyond their scheduled value.');
  if (currentPaymentDue < 0) warnings.push('Current payment due is negative — earlier certificates exceed the total earned less retainage.');
  if (releaseCents > retainageGross) warnings.push('Retainage released is more than the retainage withheld.');

  return {
    rows,
    totals,
    // G702 lines, numbered as on the form
    g702: {
      original_contract_sum: totals.c, // lines 1–3 are folded into the SOV (base + change-order lines)
      total_completed_and_stored: totals.g, // line 4
      retainage_on_work: retainageOnWork,
      retainage_on_stored: retainageOnStored,
      retainage_gross: retainageGross,
      retainage_released: Math.min(releaseCents, retainageGross),
      retainage_held: retainageHeld, // line 5 total
      earned_less_retainage: earnedLessRetainage, // line 6
      previous_certificates: Math.round(previousCertificatesCents || 0), // line 7
      current_payment_due: currentPaymentDue, // line 8
      balance_to_finish_incl_retainage: totals.c - earnedLessRetainage, // line 9
    },
    warnings,
  };
}

// Splits `total` across `weights` so the parts sum EXACTLY to `total`
// (largest-remainder). Used to seed the Schedule of Values from an estimate.
export function allocateCents(total, weights) {
  const sumW = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (!weights.length) return [];
  if (sumW <= 0) {
    const base = Math.floor(total / weights.length);
    const out = weights.map(() => base);
    out[out.length - 1] += total - base * weights.length;
    return out;
  }
  const raw = weights.map(w => (total * Math.max(0, w)) / sumW);
  const floors = raw.map(Math.floor);
  let left = total - floors.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => [r - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) floors[order[k][1]] += 1;
  return floors;
}
