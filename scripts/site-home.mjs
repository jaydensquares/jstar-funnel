// Homepage content (getjstarpro.com/). Built into software.html by scripts/build-site.mjs.
// Prices and limits must match lib/plan.js. Competitor prices are their published monthly prices.

export const STACK = [
  // [job, what most wholesalers use, typical cost, JStar Pro]
  ['Seller funnel', 'ClickFunnels, plus writing your own privacy, terms and SMS consent pages', '$97/mo', 'Live the day you sign up', 'seller-funnel'],
  ['Comps, ARV and owner lists', 'PropStream Essentials', '$99/mo', 'On every lead, plus list stacking', 'owner-lists'],
  ['Mortgage, equity and pre-foreclosure', 'PropStream, or digging through county deed records', 'Your time', 'Loan balance, equity, liens and foreclosure filings on every lead', 'deal-analyzer'],
  ['Driving for dollars', 'DealMachine', '$119/mo', 'GPS owner lookup from your phone', 'driving-for-dollars'],
  ['Skip tracing', 'A pay-per-record skip tracing service', 'Per record', 'Built in. No match, no charge', 'skip-tracing'],
  ['Deal analysis and MAO', 'DealCheck, or a spreadsheet you keep fixing', '$29/mo', 'Opening offer and max offer in about 10 seconds', 'deal-analyzer'],
  ['Repair estimate', 'FlipperForce, or waiting on a contractor walkthrough', '$79/mo', 'Line items from photos, plus an AI after-repair picture', 'photo-to-arv'],
  ['Pipeline and underwriting', 'Sticky notes and a Google Sheet', 'Your time', '70% rule, buyer profit, 18-point checklist', 'deal-pipeline'],
  ['Contracts and buyer blasts', 'A Word doc you edit by hand, then texting buyers one by one', 'Your time', 'Contracts filled in from the deal; every matching buyer in one tap', 'cash-buyers'],
  ['Offers and follow-up', 'Writing every text yourself, and forgetting the ones that go quiet', 'Your time', 'JStar AI writes offers and follows up for 30 days', 'jstar-ai'],
];
const STACK_TOTAL = 97 + 99 + 119 + 29 + 79; // $423

const TOUR = [
  { key: 'funnel', slug: 'seller-funnel', tab: 'Seller funnel', h: 'Your seller funnel, live the day you sign up.',
    p: 'A five-step "sell your house for cash" form under your business name, phone number and address. Sellers finish it in about a minute on their phone, and it works with your Google and Meta ads from day one.',
    li: ['<b>Compliance pages included:</b> privacy policy, terms and SMS consent language written for A2P 10DLC', '<b>Assignment disclosure</b> in plain English', '<b>Your own domain</b> on Pro and Team, or $19/mo on Starter'] },
  { key: 'inbox', slug: 'seller-funnel', tab: 'Lead inbox', h: 'Every lead arrives with the math done.',
    p: 'Before you pick up the phone, the lead has been run against recent sales near the property: after-repair value, repairs, your max offer and where to open, plus what the seller owes.',
    li: ['<b>Scored hot, warm or cold</b> on timeline, motivation, condition and asking price', '<b>Mortgage and equity</b> from recorded loans, plus pre-foreclosure, liens and auction dates', '<b>One tap</b> to call, text, skip trace or move it to deals'] },
  { key: 'run', slug: 'deal-analyzer', tab: 'Run any address', h: 'Any address. About ten seconds.',
    p: 'A call-in, a list lead, a house you drove past. Type the address and get comps with match scores, ARV, repairs, your offer range and a buyer pitch.',
    li: ['<b>Payoff check:</b> see if the mortgage is above your max offer before you call', '<b>Vacant lots</b> priced per acre', '<b>Batch:</b> paste 10 addresses and get every offer in one table'] },
  { key: 'photos', slug: 'photo-to-arv', tab: 'Photos to repairs and ARV', h: 'Photos in. Repair budget and the after picture out.',
    p: 'Upload up to 12 photos for a condition grade and line-by-line repairs. Then tap Show after repairs and the AI shows what the house could look like fixed up, to send to your buyers.',
    li: ['<b>Line items</b> with low and high ranges, tied to the photo they came from', '<b>Red flags</b> and questions for the walkthrough', '<b>Before and after</b> you can download, labeled as an AI concept'] },
  { key: 'deals', slug: 'deal-pipeline', tab: 'Underwriting & contracts', h: 'Check the numbers. Print the contract.',
    p: 'Each deal shows what your buyer pays and makes and whether it clears the 70% rule. Work the 18-point checklist and print the purchase agreement, assignment or JV agreement.',
    li: ['<b>Pipeline:</b> lead, offer sent, under contract, assigned, closed', '<b>Contracts filled in</b> from the deal, with the Texas wholesaler disclosures', '<b>Send to buyers</b> by email or text in one tap'] },
  { key: 'lists', slug: 'owner-lists', tab: 'Owner lists', h: 'Pull motivated owners by ZIP.',
    p: 'Pull every owner in a ZIP from public records, keep the ones most likely to sell, and stack lists to find owners who show up on several.',
    li: ['<b>Absentee, out-of-state, estates,</b> long-time owners and vacant lots', '<b>Stack lists</b>, including your driving-for-dollars list', '<b>CSV</b> ready to skip trace'] },
];

const FAQ = [
  ['Where do the numbers come from?', 'Property details and recent sales come from public records and listing data covering the U.S. After-repair value is based on the closest recent sales by distance, size, age and date. Repair estimates use cost per square foot by condition, adjusted for the age of the house and any problems the seller reports. Every number is an estimate, so check comps and walk the property before you sign.'],
  ['Can I see what the seller owes?', 'Yes. Every analysis pulls the recorded mortgages on the property: lender, original amount, rate and recording date, plus any liens, pre-foreclosure filings and auction dates. You get an estimated balance and equity, and a warning when the payoff is above your max offer. Confirm the payoff with the seller before you sign.'],
  ['How do offers get calculated?', 'Max offer = after-repair value × 70%, minus repairs, minus your assignment fee. Your opening offer starts 5% below that so you have room to negotiate. On any deal you can change the ARV, repairs, contract price and fee and see the effect on your buyer\'s profit.'],
  ['How does the free trial work?', 'Pick a plan and add a card. You get 3 days with every tool on, with trial limits of 25 deal analyses, 10 skip traces, 3 photo estimates, 3 AI after-repair renders and 60 JStar AI messages. Cancel before day 3 from Plan & account and you aren\'t charged. Otherwise your plan starts and the full monthly limits unlock. The trial is one per person and card.'],
  ['What is Photo to ARV?', 'Upload photos of the property and get a condition grade and line-item repair estimate. Then pick a photo and tap Show after repairs: the AI shows the same space fixed up with typical flip finishes, keeping the layout, windows and roofline. Every download is labeled as an AI concept, not the actual property.'],
  ['Does it work with GoHighLevel?', 'Yes. Connect your GHL sub-account with a Private Integration token and you can text every matching buyer at once from your A2P-registered number. JStar AI\'s follow-ups can also text sellers who agreed to texts on your funnel.'],
  ['What doesn\'t it do?', 'JStar Pro isn\'t a dialer, and it doesn\'t send cold text campaigns to seller lists. It texts your cash buyers, and follows up by text only with sellers who opted in on your funnel. Pre-foreclosure filings and liens show on each property you analyze; they aren\'t a list you can pull yet.'],
  ['Do I need my own website or domain?', 'No. Your funnel is live at your own link as soon as you sign up. On Pro and Team, or with the $19 add-on on Starter, you can connect a domain you own with two DNS records.'],
  ['Are the contracts legally ready to use?', 'They\'re templates with the disclosures Texas requires for wholesalers, filled in from your deal, including a JV agreement. Laws vary by state, so have a real estate attorney in your state review them once before you use them.'],
  ['What happens if I hit my monthly limit?', 'Your funnel keeps taking leads, just without the automatic analysis, until you add a pack, upgrade or the month resets. Packs never expire: +100 deal analyses $25, +25 photo estimates $15, +5,000 list records $25, +100 skip traces $25.'],
  ['Can I cancel?', 'Yes, anytime, from Plan & account → Manage billing. You keep access until the end of the period you paid for.'],
];

const PLANS = [
  { k: 'starter', nm: 'Starter', for: 'For getting your first deals under contract.', m: 89, rows: [['Deal analyses', '100 / mo'], ['Photo repair estimates', '10 / mo'], ['AI after-repair renders', '10 / mo'], ['Owner list records', '4,000 / mo'], ['Skip traces', '25 / mo'], ['JStar AI messages', '300 / mo'], ['Custom domain', '$19 / mo add-on', 'x']] },
  { k: 'pro', nm: 'Pro', pick: true, for: 'For wholesalers running ads every month.', m: 149, rows: [['Deal analyses', '300 / mo'], ['Photo repair estimates', '30 / mo'], ['AI after-repair renders', '30 / mo'], ['Owner list records', '12,000 / mo'], ['Skip traces', '100 / mo'], ['JStar AI messages', '1,000 / mo'], ['Custom domain', 'Included']] },
  { k: 'team', nm: 'Team', for: 'For high-volume operators and acquisition teams.', m: 299, rows: [['Deal analyses', '800 / mo'], ['Photo repair estimates', '80 / mo'], ['AI after-repair renders', '80 / mo'], ['Owner list records', '30,000 / mo'], ['Skip traces', '300 / mo'], ['JStar AI messages', '3,000 / mo'], ['Custom domain', 'Included']] },
];

export function home({ ICON, TRIAL, url, visual, finalCta, FEATURES, GROUPS, esc }) {
  const faqLd = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) })}</script>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'JStar Pro', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', offers: PLANS.map(p => ({ '@type': 'Offer', name: p.nm, price: p.m, priceCurrency: 'USD' })) })}</script>
`;
  const body = `
<section class="hero"><div class="w">
  <div>
    <h1>Find, run and assign more <em>wholesale deals</em> from one login.</h1>
    <p class="lead">Seller funnel, owner lists, bulk offers to listing agents, skip tracing, comps and max offers, photo repair estimates, contracts and buyer blasts, plus an AI assistant that writes your offers and follows up for you.</p>
    <div class="ctas"><a class="btn go lg" href="${TRIAL}">Start my 3-day free trial</a><a class="btn ghost lg" href="#vsl-vsl" data-watch="vsl-vsl">Watch the 2½-min demo</a></div>
    <ul class="checks"><li>${ICON.check}3 days free</li><li>${ICON.check}From $89/mo after</li><li>${ICON.check}Cancel anytime</li><li>${ICON.check}Every tool on every plan</li></ul>
  </div>
  <div>${visual({ type: 'vsl', src: '/media/vsl.mp4', poster: '/media/vsl.jpg', cap: 'The full walkthrough, in 2½ minutes', sub: 'Sound on. Every tool, start to finish.' }, true)}</div>
</div></section>

<section class="facts" aria-label="At a glance"><div class="w">
  <div><b>12 tools</b><span>in one login</span></div>
  <div><b>~10 sec</b><span>from address to max offer</span></div>
  <div><b>$${STACK_TOTAL}/mo</b><span>of separate tools replaced</span></div>
  <div><b>AI included</b><span>offers, replies and follow-up</span></div>
</div></section>

<section class="s"><div class="w">
  <h2>Everything from the first lead to the assignment fee.</h2>
  <p class="intro">Every tool shares the same lead and deal, so you never retype an address. Pick any one to see how it works.</p>
  <div class="hub">${GROUPS.map((g, i) => `<div><div class="stage"><i>${String(i + 1).padStart(2, '0')}</i><b>${esc(g.name)}</b></div>${g.items.map(s => `<a href="${url(s)}"><b>${esc(FEATURES[s].name)}${FEATURES[s].isNew ? '<span class="newtag">New</span>' : ''}</b><span>${esc(FEATURES[s].short)}</span></a>`).join('')}</div>`).join('')}</div>
</div></section>

<section class="s alt" id="tour"><div class="w">
  <h2>See it work. Every clip is the real app.</h2>
  <p class="intro">Pick a step or let it play.</p>
  <div class="tour" id="slide">
    <ol class="steps" id="tabs" role="tablist">${TOUR.map((s, i) => `<li><button type="button" role="tab" data-i="${i}" data-key="${s.key}"><span class="i">${String(i + 1).padStart(2, '0')}</span><span>${esc(s.tab)}</span></button><div class="body"><h3>${esc(s.h)}</h3><p>${esc(s.p)}</p><ul>${s.li.map(x => `<li>${x}</li>`).join('')}</ul><a class="arrow" href="${url(s.slug)}">More on ${esc(FEATURES[s.slug].name.toLowerCase())}</a></div></li>`).join('')}</ol>
    <div class="stage2"><div class="phone"><video id="tv" muted playsinline preload="none" poster="/media/funnel.jpg" aria-label="Screen recording of the step you picked"></video></div><div class="prog"><i id="tp"></i></div></div>
  </div>
</div></section>

<section class="s dark" id="ai"><div class="w split">
  <div>
    <p class="lbl">JStar AI</p>
    <h2>An AI acquisitions assistant, built in.</h2>
    <p class="intro">It runs the numbers, writes the offer, answers pushback and follows up, so no lead goes cold while you're out looking at houses.</p>
    <ul class="bul">
      <li><b>Ask it anything.</b> "Run this address and tell me what to offer."</li>
      <li><b>Writes your offer</b> by text or email, never above your max offer.</li>
      <li><b>Handles pushback.</b> Paste what the seller said and get replies that hold your number.</li>
      <li><b>Follows up for 30 days.</b> Five check-ins that stop the moment you take over.</li>
    </ul>
    <div class="rowlinks"><a class="btn go" href="${TRIAL}">Try JStar AI free</a><a class="arrow" href="${url('jstar-ai')}">How JStar AI works</a></div>
  </div>
  <div>${visual({ type: 'vsl', src: '/media/ai-vsl.mp4', poster: '/media/ai-vsl.jpg', cap: 'See JStar AI work a lead', sub: '1 minute. Real app, no actors.' })}</div>
</div></section>

<section class="s"><div class="w split flip">
  <div>
    <p class="lbl">Dispo</p>
    <h2>Send the deal to every buyer it fits, in one tap.</h2>
    <p class="intro">Every buyer has a buy box. Open a deal, hit Send to buyers, and everyone it fits is already checked.</p>
    <ul class="bul">
      <li><b>Import your buyers</b> from Salesforce or a spreadsheet, or find cash buyers by ZIP.</li>
      <li><b>Email them all</b>, or text each one from your phone with their name filled in.</li>
      <li><b>On GoHighLevel?</b> Text every match at once from your A2P number.</li>
    </ul>
    <div class="rowlinks"><a class="btn go" href="${TRIAL}">Start free trial</a><a class="arrow" href="${url('cash-buyers')}">How deal blasts work</a></div>
  </div>
  <div>${visual({ type: 'phone-video', ratio: '916', src: '/media/dispo.mp4', poster: '/media/dispo.jpg' })}</div>
</div></section>

<section class="s alt" id="compare"><div class="w">
  <h2>You're paying for a stack of tools that don't talk to each other.</h2>
  <p class="intro">A seller fills out your form. You copy the address into your comps tool, guess at repairs, run numbers in a spreadsheet, retype it all into a contract, then text buyers one by one. Meanwhile the seller is on the phone with the next wholesaler.</p>
  <div class="cmpw"><table class="cmp">
    <thead><tr><th>The job</th><th>What most wholesalers use</th><th class="r">Typical cost</th><th class="us">JStar Pro</th></tr></thead>
    <tbody>${STACK.map(([a, b, c, d, s]) => `<tr><td><b><a href="${url(s)}" style="text-decoration:none">${esc(a)}</a></b></td><td>${esc(b)}</td><td class="r">${esc(c)}</td><td class="us">${esc(d)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="2"><b>Total</b></td><td class="r"><b>$${STACK_TOTAL}/mo</b> + per-record fees + hours</td><td class="us"><b>From $89/mo</b>, all of it</td></tr></tfoot>
  </table></div>
</div></section>

<section class="s" id="pricing"><div class="w">
  <h2>Every tool on every plan.</h2>
  <p class="intro">Pick by how many deals you work each month. Every plan starts with <b>3 days free</b>: card up front, cancel before day 3 and you pay nothing.</p>
  <div class="bill" id="billTog" role="group" aria-label="Billing"><button type="button" class="on" data-i="month" aria-pressed="true">Monthly</button><button type="button" data-i="year" aria-pressed="false">Yearly <em>2 months free</em></button></div>
  <div class="plans">${PLANS.map(p => `
    <div class="plan${p.pick ? ' pick' : ''}">
      <div class="nm">${p.nm}</div>
      <div class="for">${p.for}</div>
      <div class="pr" data-m="${p.m}">$${p.m}<span> / month</span></div>
      <ul>${p.rows.map(([a, b, x]) => `<li${x ? ' class="x"' : ''}><span>${a}</span><b>${b}</b></li>`).join('')}</ul>
      <a class="btn ${p.pick ? 'go' : 'ghost'}" href="/signup?plan=${p.k}" data-plan="${p.k}">Try ${p.nm} free</a>
    </div>`).join('')}
  </div>
  <p class="planhelp">Not sure which plan fits? <a href="/support?topic=call">Talk to the founder for 15 minutes</a>. You can switch plans any time.</p>
  <div class="agency"><div><b>Agency</b><span>Custom pricing</span></div><p>For brokerages and acquisition teams: 2,000 deal analyses a month, 5 team logins, 200 photo estimates and renders, 750 skip traces and 80,000 list records, plus help setting up your funnel and ads.</p><a class="btn ghost" href="/support?topic=agency">Book a call</a></div>
  <p class="small"><b>Every plan includes</b> your seller funnel, lead inbox, JStar AI, Run an address, mortgage and equity data, batch analysis, photo repair estimates, AI after-repair renders, owner lists and stacking, driving for dollars, skip tracing, pipeline, underwriting, the checklist, purchase, assignment and JV contracts, cash buyers and deal blasts, GoHighLevel and ad tracking.</p>
  <p class="small mute"><b>Usage:</b> plan limits reset on the 1st of each month and unused usage doesn't roll over. Need more mid-month? Add-on packs that never expire: +100 deal analyses $25, +25 photo estimates $15, +5,000 list records $25, +100 skip traces $25. Skip traces with no match are free.</p>
</div></section>

<section class="s alt" id="savings"><div class="w">
  <h2>See what you'd save.</h2>
  <p class="intro">Tick what you use and change any price to what you actually pay. Defaults are each tool's published monthly price. The last two do more than JStar Pro, so they start unticked.</p>
  <div class="calc">
    <div>
      <div class="tools" id="tools"></div>
      <p class="small"><b>What JStar Pro doesn't do:</b> it isn't a dialer and it doesn't send cold text campaigns to seller lists. Keep the tools you use for those.</p>
    </div>
    <aside class="result" aria-live="polite">
      <div class="row"><span>You pay now</span><b id="now">$0</b></div>
      <div class="row"><span>JStar Pro <select id="planSel" aria-label="Plan"><option value="89">Starter</option><option value="149" selected>Pro</option><option value="299">Team</option></select></span><b id="ours">$149</b></div>
      <div class="save"><small id="saveLbl">You'd save each year</small><b id="save">$0</b></div>
      <p class="note" style="color:var(--on-navy2)">Doesn't count the hours you spend moving addresses between tools.</p>
      <a class="btn go" href="${TRIAL}">Start my free trial</a>
    </aside>
  </div>
</div></section>

<section class="s" id="faq"><div class="w faqgrid">
  <div><h2>Before you sign up</h2><p class="intro" style="font-size:16px">Where the numbers come from, what it won't do, and how billing works.</p>
    <div class="askcall"><b>Still have questions?</b><span>Talk to the founder for 15 minutes. We'll walk through your market and the plan that fits.</span><a class="btn" href="/support?topic=call">Hop on a call</a></div></div>
  <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
</div></section>

${finalCta('Get your funnel live today.', 'Sign up, add your business name and phone, and share the link. Your next seller lead comes in with the offer already worked out. 3 days free, cancel anytime.')}

<div class="offer" id="offer" hidden role="dialog" aria-modal="true" aria-labelledby="offerH">
  <div class="box">
    <button type="button" class="x" id="offerX" aria-label="Close">&times;</button>
    <form id="offerForm" novalidate>
      <h2 id="offerH">Get <b>25% off</b> your first month</h2>
      <p>Tell us where to send it. It's tied to your email and comes off your first paid month, after your 3-day free trial, on any monthly plan.</p>
      <label class="f" for="ofName">Your name</label><input type="text" id="ofName" autocomplete="name" required>
      <label class="f" for="ofEmail">Email</label><input type="text" id="ofEmail" inputmode="email" autocomplete="email" required>
      <label class="f" for="ofPhone">Phone</label><input type="tel" id="ofPhone" autocomplete="tel" inputmode="tel" required>
      <input type="text" class="hp" id="ofWeb" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="agree"><input type="checkbox" id="ofAgree"><span>I agree that JStar Pro may call or text me at this number about my account and this offer, including with automated technology. Consent isn't required to buy. Message and data rates may apply. Reply STOP to opt out. <a href="/legal/privacy">Privacy</a></span></label>
      <p class="err" id="ofErr" role="alert"></p>
      <button class="btn go" id="ofGo">Claim my 25% off</button>
      <button type="button" class="no" id="offerNo">No thanks</button>
    </form>
    <div id="offerDone" hidden>
      <h2>You're in. <b>25% off</b> is saved.</h2>
      <p>Sign up with <b id="ofShow"></b> and pick a monthly plan. You still get 3 days free, and the 25% comes off your first paid month.</p>
      <a class="btn go" href="${TRIAL}">Start my free trial</a>
    </div>
  </div>
</div>`;
  return {
    title: 'JStar Pro | Wholesaling software: leads, comps, contracts and AI in one login',
    desc: 'Seller funnel, owner lists, bulk offers to listing agents, skip tracing, comps and max offers, photo repair estimates with AI after-repair renders, contracts and buyer blasts, plus an AI assistant. 3 days free, from $89/mo.',
    image: '/media/vsl.jpg',
    extraHead: faqLd + `<style>
  .offer[hidden] { display:none; }
  .offer { position:fixed; inset:0; z-index:60; display:grid; place-items:center; padding:20px; background:rgba(17,17,17,.62); }
  .offer .box { position:relative; width:100%; max-width:440px; max-height:calc(100vh - 40px); overflow:auto; background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:12px; padding:28px 24px 22px; box-shadow:0 24px 60px rgba(0,0,0,.35); }
  .offer h2 { font-size:28px; } .offer h2 b { color:var(--brand); }
  .offer p { margin:8px 0 16px; color:var(--muted); font-size:15px; }
  .offer label.f { display:block; font-size:13px; font-weight:700; margin:12px 0 4px; }
  .offer input[type=text], .offer input[type=tel] { width:100%; font:16px var(--font); padding:11px 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg2); color:var(--ink); }
  .offer .agree { display:flex; gap:10px; align-items:flex-start; margin:14px 0 4px; font-size:12.5px; line-height:1.45; color:var(--muted); }
  .offer .agree input { width:18px; height:18px; margin-top:1px; flex:none; accent-color:var(--brand); }
  .offer .btn { width:100%; margin-top:14px; font-size:16px; }
  .offer .x { position:absolute; top:8px; right:8px; width:40px; height:40px; border:0; background:transparent; color:var(--muted); font-size:24px; line-height:1; cursor:pointer; border-radius:8px; }
  .offer .err { color:#e5484d; font-size:14px; margin:10px 0 0; }
  .offer .no { display:block; margin:12px auto 0; background:none; border:0; color:var(--muted); font:13px var(--font); text-decoration:underline; cursor:pointer; }
  .offer .hp { position:absolute; left:-9999px; }
</style>
`,
    body,
    scripts: `<script src="/home.js?v=${Date.now().toString(36)}" defer></script>\n`,
  };
}
