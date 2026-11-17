// Stand-in for the planner model in the benchmarks: it is asked only when the engine stops, and each call is counted.
// It answers the way a model reading the stop report would: refuse a pop-up that is in the way, use the real name
// from `closest` when a label is worded differently, or point at the form's submit button.
export const ORACLE = async ({ step, failed }) => {
  const refusal = (failed.dialog?.buttons || []).find((b) => /^(no,? thanks|not now|close|dismiss|decline|reject all)$/i.test(b));
  if (refusal && (failed.status === 'blocked' || failed.status === 'interrupt')) return { first: [{ click: refusal }] };
  if (step.op === 'click') return { target: { css: 'form button[type=submit]' } };
  const want = String(step.target?.label ?? '').toLowerCase();
  const names = (failed.closest || []).map((c) => c.replace(/ \(\d\.\d+\)$/, ''));
  const pick = want && names.find((n) => n.toLowerCase().includes(want) || want.includes(n.toLowerCase()));
  return pick ? { target: { label: pick } } : null;
};
