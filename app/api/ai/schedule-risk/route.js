import { guardAI, logAI, callClaude, parseJsonObject, untrusted, UNTRUSTED_RULE, failure } from '../../../../lib/aiClient';
import { getForecastForJob, WeatherConfigError } from '../../../../lib/integrations/weatherClient';
import { findPhaseWeatherFlag } from '../../../../lib/weatherRules';

// One-line risk narration for a job's upcoming schedule, combining signals
// that already exist separately (past delays on this job, forecasted
// weather against trade rules, and how reliable the subs assigned to the
// next couple weeks of work have been). Nothing here changes the schedule —
// it's a heads-up line for the crew board / job schedule tab.

const SYSTEM = `You write a single short heads-up line (max ~25 words, one sentence, plain language) about schedule risk on a construction job, from the signals given: past delays on this job, weather forecasted against trade rules for upcoming outdoor work, and reliability notes on assigned subs.
Only flag something if there's a real, specific reason — a repeat pattern, a forecasted weather conflict, or a sub with a real reliability concern. If nothing notable stands out, say so plainly rather than inventing a concern.
${UNTRUSTED_RULE}
Reply with ONLY a JSON object: {"risk_level": "none"|"low"|"medium"|"high", "note": "..."}. note is "" when risk_level is "none".`;

export async function POST(request) {
  const gate = await guardAI(request, 'schedule_risk');
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  let jobId = null;
  try {
    const body = await request.json();
    jobId = body.jobId;
    if (!jobId) return Response.json({ error: 'Missing job.' }, { status: 400 });
    const { admin } = gate;

    const today = new Date().toISOString().slice(0, 10);
    const twoWeeksOut = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    const [{ data: job }, { data: delays }, { data: phases }] = await Promise.all([
      admin.from('jobs').select('id, job_number, project_street, project_city, project_state, project_zip, site_lat, site_lng, stage').eq('id', jobId).single(),
      admin.from('schedule_delays').select('from_date, workdays_shifted, reason_category').eq('job_id', jobId).order('created_at', { ascending: false }).limit(10),
      admin.from('job_phases').select('id, label, trade, work_location, start_date, end_date').eq('job_id', jobId).eq('status', 'published').lte('start_date', twoWeeksOut).gte('end_date', today),
    ]);
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });

    const lines = [];
    if (delays?.length) {
      lines.push(`Past delays on this job (most recent first): ${delays.map(d => `${d.from_date} — ${d.reason_category}, shifted ${d.workdays_shifted} workday(s)`).join('; ')}`);
    } else {
      lines.push('No recorded delays on this job.');
    }

    const outdoorPhases = (phases || []).filter(p => p.trade && ['outdoor', 'mixed'].includes(p.work_location));
    if (outdoorPhases.length) {
      try {
        const { data: rules } = await admin.from('trade_weather_rules').select('*');
        const rulesByTrade = Object.fromEntries((rules || []).map(r => [r.trade, r]));
        const forecast = await getForecastForJob(job);
        const flags = outdoorPhases.map(p => findPhaseWeatherFlag(p, forecast?.daily || [], rulesByTrade)).filter(Boolean);
        lines.push(flags.length ? `Weather flags on upcoming outdoor phases: ${flags.map(f => `${f.date}: ${f.reasons.join(', ')}`).join('; ')}` : 'No weather flags on upcoming outdoor phases.');
      } catch (err) {
        if (!(err instanceof WeatherConfigError)) throw err;
        // Weather isn't configured — just leave that signal out.
      }
    }

    if (phases?.length) {
      const trades = [...new Set(phases.map(p => p.trade).filter(Boolean))];
      if (trades.length) {
        const { data: subs } = await admin
          .from('work_orders').select('trade, company_id, companies(company_name)')
          .eq('job_id', jobId).in('status', ['issued', 'accepted']).in('trade', trades);
        if (subs?.length) {
          const { data: scores } = await admin.rpc('sub_reliability_scores');
          const byCompany = Object.fromEntries((scores || []).map(s => [s.company_id, s]));
          const concerns = subs.map(s => byCompany[s.company_id]).filter(s => s && (s.score < 70 || s.punch_overdue > 0))
            .map(s => `${s.company_name}: score ${s.score}/100${s.punch_overdue ? `, ${s.punch_overdue} overdue punch item(s)` : ''}${s.decline_rate_pct ? `, ${s.decline_rate_pct}% work-order decline rate` : ''}`);
          if (concerns.length) lines.push(`Sub reliability notes for subs on this job's upcoming phases: ${concerns.join('; ')}`);
        }
      }
    }

    const text = untrusted('signals', lines.join('\n'));
    const result = await callClaude({ system: SYSTEM, content: text, maxTokens: 200, config: gate.config });
    const draft = parseJsonObject(result.text);
    const level = ['none', 'low', 'medium', 'high'].includes(draft.risk_level) ? draft.risk_level : 'none';
    await logAI(gate, { jobId, usage: result.usage });
    return Response.json({ risk_level: level, note: level === 'none' ? '' : String(draft.note || '') });
  } catch (err) {
    await logAI(gate, { jobId, ok: false });
    return failure(err, 'Could not check schedule risk.');
  }
}
