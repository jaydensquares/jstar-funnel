#!/usr/bin/env node
// Run the full deal analysis on any address from your terminal.
//
//   RENTCAST_API_KEY=xxx node scripts/analyze.js "123 Main St, Garland, TX 75040" \
//     --condition heavy --issues roof,hvac --sqft 1650 --beds 3 --baths 2 --asking 180000 --owed free_clear
//
// Add --send to also email/text/webhook it like a real lead. Add --html deal.html to save the deal sheet.
import fs from 'node:fs';
import { analyzeLead } from '../lib/pipeline.js';
import { dealSheetHtml, smsText, sendEmail, sendSms, sendWebhook } from '../lib/notify.js';

const args = process.argv.slice(2);
const address = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = k => args.includes(`--${k}`);

if (!address) {
  console.log('Usage: node scripts/analyze.js "street, city, ST zip" [--condition turnkey|cosmetic|moderate|heavy|gut] [--issues roof,hvac] [--sqft N] [--beds N] [--baths N] [--year N] [--asking N] [--owed free_clear|mortgage] [--occupancy tenant --rent 1650 --lease mtm|lt3|3to6|6to12|gt12 --paying yes|late|behind] [--repair "Kitchen=30000,Carpet=8000"] [--html out.html] [--send]');
  process.exit(1);
}

const m = address.match(/,\s*([A-Za-z]{2})\s+(\d{5})/);
const n = v => (v ? Number(v) : null);
const lead = {
  address, street: address.split(',')[0], city: address.split(',')[1]?.trim(), state: m?.[1]?.toUpperCase() || '', zip: m?.[2] || '',
  propertyType: opt('type') || 'single_family', propertyTypeLabel: 'Single family',
  bedrooms: n(opt('beds')), bathrooms: n(opt('baths')), sqft: n(opt('sqft')), yearBuilt: n(opt('year')),
  condition: opt('condition') || 'moderate', issues: (opt('issues') || '').split(',').filter(Boolean),
  timeline: opt('timeline') || 'asap', reason: opt('reason') || '', occupancy: opt('occupancy') || '', owed: opt('owed') || '',
  asking: opt('asking') || '', currentRent: n(opt('rent')), leaseEnd: opt('lease') || '', tenantPaying: opt('paying') || '', reasonDetail: '', firstName: 'Manual', lastName: 'run', phone: '', email: '', tracking: { utm_source: 'manual' },
};

// --repair "Carpet=8000,Kitchen=30000,Cleaning=2000" → itemized repairs instead of the $/sqft estimate
if (opt('repair')) lead.customRepairs = opt('repair').split(',').map(s => { const [item, cost] = s.split('='); return { item: item.trim(), cost: Number(cost) }; });

const p = await analyzeLead(lead);
console.log('\n' + smsText(p) + '\n');
if (p.analysis) {
  for (const s of p.analysis.strategies) {
    console.log(`── ${s.name}${s.key === p.analysis.recommended ? '  ★ RECOMMENDED' : ''}`);
    s.reasoning.forEach(r => console.log('  • ' + r));
    console.log();
  }
}
if (opt('html')) { fs.writeFileSync(opt('html'), dealSheetHtml(p)); console.log('Saved deal sheet →', opt('html')); }
if (flag('send')) console.log(await Promise.allSettled([sendEmail(p), sendSms(p), sendWebhook(p)]));
