// Plans = what a planner model emits in ONE call after reading the task (human-level targets, no selectors).
// Foresight resolves targets itself, so the same plan survives layout changes.
import fs from 'node:fs';
const tasks = JSON.parse(fs.readFileSync(new URL('../tasks/tasks.json', import.meta.url), 'utf8'));
const DONE = { text: 'Completed and validated', timeout: 6000 };

const fills = (d, keys) => keys.map((k) => ({ fill: k, value: d[k] }));

export const plans = {
  'long-form': (() => {
    const d = tasks['long-form'].data;
    return { id: 'long-form', path: '/long-form.html', steps: [
      ...fills(d, ['First name', 'Last name', 'Email', 'Phone', 'Username', 'Company', 'Job title', 'Date of birth', 'Street address', 'City']),
      { select: 'State', value: d.State },
      { fill: 'ZIP code', value: d['ZIP code'] },
      { select: 'Country', value: d.Country },
      { radio: 'Preferred contact', value: d['Preferred contact'] },
      { fill: 'Short bio', value: d['Short bio'] },
      { check: 'I agree to the terms of service' },
      { click: 'Create account', risk: 'irreversible', expect: DONE },
    ] };
  })(),

  autocomplete: (() => {
    const d = tasks.autocomplete.data;
    return { id: 'autocomplete', path: '/autocomplete.html', steps: [
      { fill: 'Passenger name', value: d['Passenger name'] },
      { pick: 'From', value: d.From, typeText: 'Amm' },
      { pick: 'To', value: d.To, typeText: 'Istanbul' },
      { fill: 'Departure date', value: d['Departure date'] },
      { fill: 'Passengers', value: d.Passengers },
      { select: 'Cabin', value: d.Cabin },
      { click: 'Search flights', expect: DONE },
    ] };
  })(),

  'late-modal': (() => {
    const d = tasks['late-modal'].data;
    return { id: 'late-modal', path: '/late-modal.html', steps: [
      ...fills(d, ['Your name', 'Email', 'Order number']),
      { select: 'Topic', value: d.Topic },
      { fill: 'Message', value: d.Message },
      { check: 'Send me a copy' },
      { click: 'Send request', risk: 'irreversible', expect: DONE },
    ] };
  })(),

  wizard: (() => {
    const d = tasks.wizard.data;
    return { id: 'wizard', path: '/wizard.html', steps: [
      ...fills(d, ['Full name', 'Address', 'City', 'Postal code']),
      { click: 'Continue to delivery', expect: { label: 'Delivery note', timeout: 4000 } },
      { radio: 'Delivery speed', value: d['Delivery speed'] },
      { check: 'Add gift wrap' },
      { fill: 'Delivery note', value: d['Delivery note'] },
      { click: 'Continue to review', expect: { label: 'PO number', timeout: 4000 } },
      { select: 'Payment method', value: d['Payment method'] },
      { fill: 'PO number', value: d['PO number'] },
      { check: 'I confirm this order' },
      { click: 'Place order', risk: 'irreversible', expect: DONE },
    ] };
  })(),

  drift: (() => {
    const d = tasks.drift.data;
    return { id: 'drift', path: '/drift.html', steps: [
      ...fills(d, ['Display name', 'Email address', 'Phone', 'Website']),
      { select: 'Time zone', value: d['Time zone'] },
      { select: 'Language', value: d.Language },
      { check: 'Two-factor authentication' },
      { click: 'Save changes', expect: DONE },
    ] };
  })(),

  grid: (() => {
    const d = tasks.grid.data;
    const steps = [];
    for (const [sku, cols] of Object.entries(d)) for (const [col, v] of Object.entries(cols)) steps.push({ fill: { row: sku, col }, value: v });
    steps.push({ click: 'Save inventory', expect: DONE });
    return { id: 'grid', path: '/grid.html', steps };
  })(),
};
