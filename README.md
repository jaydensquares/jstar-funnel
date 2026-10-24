# JStar Acquisitions — Lead Funnel + Deal Analyzer

Seller fills out the form → backend pulls comps and rent for that exact address → you get an email (and optional text) with three ways to do the deal, the number for each, and the reasoning.

## What happens on every lead

1. **Public record lookup.** Fills in sqft, year built, beds/baths if the seller skipped them, and flags it when the seller's sqft doesn't match the county.
2. **Comps.** Pulls up to 25 nearby sales/listings, filters out wrong size or type, then scores each 0–100% on distance, size, beds/baths, age, recency and RentCast's own match score. ARV uses the top 8, preferring off-market (sold) comps over active asking prices.
3. **Repairs.** Itemized: base scope from the condition they picked ($/sqft × age multiplier) plus a line for each issue they checked (roof, HVAC, foundation…).
4. **Rent.** Separate RentCast rent estimate, used for seller-finance cash flow.
5. **Three exits, each with numbers + reasoning:**
   - **Wholesale:** price to the cash buyer (70% rule), your MAO and opening offer, and the investor's projected profit so you can pitch it. Includes a copy-paste blurb for your buyers list.
   - **Fix & flip:** the max you can pay and still clear your profit target (solved exactly, with hard money, holding and selling costs), plus what you'd net if you kept the deal at the wholesale price.
   - **Seller finance:** the highest price the rent supports at your terms (down, rate, balloon) while keeping minimum cash flow, your monthly payment, cash-on-cash, balloon balance, and a wrap-resale option.
6. **The play.** Picks one, says why, and warns you when the seller's asking price is above every exit.
7. **Delivery.** Phone alert (ntfy app, free, no registration) and/or text (Twilio, needs A2P registration), email deal sheet (Resend), and the full JSON to a webhook (GoHighLevel / Zapier / Sheets). Turn on any combination by setting its env vars.

The seller only ever sees a thank-you screen.

## Wholesale-only mode (default)

`config.js` → `mode: 'wholesale'`. The deal sheet shows just the assignment deal: your max offer, opening offer, price to your cash buyer, their projected profit, and a call based on the seller's asking price (lock it up / negotiate / follow up / pass). It skips the rent lookup unless the house is rented, so it's 1 RentCast call per lead instead of 2.

Set `mode: 'all'` to add fix & flip and seller finance back.

## Rented houses

If the seller picks "Tenant," the form asks for rent, lease length and whether the tenant pays. Then:
- **Rent:** uses the actual rent (not the estimate) for seller finance and flags below-market rent as upside.
- **Flip:** adds the wait for the lease to end, minus rent collected meanwhile. Leases over 3 months assume cash-for-keys ($3k); a non-paying tenant assumes an eviction ($3.5k, 2 months).
- **Wholesale:** also prices it for a landlord buyer (rent ÷ 8% cap rate, after taxes and repairs) and pitches to whichever buyer pays more.
- **Score:** a non-paying tenant raises the motivation score.
- **Notes:** reminds you to get the lease, rent roll and deposit amount (the deposit transfers at closing) and to walk it with proper notice.

All of these are in `config.tenant`.

## Files

| File | What it does |
|---|---|
| `index.html` | Seller-facing funnel (5 steps, all 50 states) |
| `api/lead.js` | Form endpoint: validates, runs the analysis, sends notifications |
| `lib/pipeline.js` | Lead → comps → ARV → repairs → strategies → score |
| `lib/strategies.js` | Wholesale / flip / seller-finance math and reasoning |
| `lib/offer.js` | Comp ranking, ARV, repair breakdown, lead score |
| `lib/rentcast.js` | RentCast value + rent calls |
| `lib/notify.js` | Deal sheet email, SMS, webhook, Meta CAPI |
| `config.js` | **Every number you'd want to tune** |
| `scripts/analyze.js` | Run any address by hand |
| `scripts/dev.js` | Local test server (`npm run dev`) |

## Setup

1. Push to GitHub, import into Vercel (framework: Other, no build step).
2. Add env vars from `.env.example`. Minimum: `RENTCAST_API_KEY`, plus `RESEND_API_KEY` + `NOTIFY_EMAIL`. Add the Twilio vars for texts.
3. Edit the `SITE` block in `index.html` (phone, Meta Pixel, Google Ads).
4. `npm test` runs the whole pipeline on sample data (no API key needed). `npm test -- --html` writes `test/sample-deal-sheet.html`.

## Test it on your computer

```bash
RENTCAST_API_KEY=xxx npm run dev
```
Open http://localhost:3000 and fill out the form like a seller. Without email keys, each deal sheet saves to `leads/` and the text-alert version prints in the terminal. Same code Vercel runs.

## Run any address by hand

```bash
RENTCAST_API_KEY=xxx node scripts/analyze.js "123 Main St, Garland, TX 75040" \
  --condition heavy --issues roof,hvac --asking 180000 --owed free_clear --html deal.html
```
Add `--repair "Carpet=8000,Kitchen=30000,Cleaning=2000"` when you know the actual scope; it replaces the $/sqft estimate with your line items plus 10% contingency. Add `--send` to email/text it like a real lead. Handy for leads from calls, texts or driving for dollars.

## Tune before trusting the numbers

All in `config.js`:
- **Repairs:** `repairPerSqft` and `repairItems`. Get 2–3 contractor walkthroughs and adjust.
- **Wholesale:** `arvPercent` (70%) and `assignmentFee`. Ask your buyers what they actually pay.
- **Flip:** hard money terms, months per condition, `minProfit`.
- **Seller finance:** `rate`, `downPct`, `balloonYears`, `minCashflow`.
- **Per state:** `stateOverrides` for tax rate, repair multiplier, 70% rule, fee.

## Limits to know

- **Zillow/Redfin:** neither offers a public comps API, and scraping them breaks their terms. RentCast is a licensed data source with the same kind of data. Each deal sheet links to the address on Zillow and Redfin for a quick look.
- **Non-disclosure states** (TX, UT, ID, WY, NM, MS, and others): sold prices aren't public, so any automated ARV leans on list prices and estimates. Confirm with an agent's MLS pull before you sign.
- **Seller finance / wraps:** selling on terms to an owner-occupant falls under federal lending rules (Dodd-Frank, SAFE Act) and state rules like Texas Property Code ch. 5. Use an RMLO and an attorney.
- **Cost:** 2 RentCast calls per lead. The free tier is 50 calls/month (~25 leads), so move to a paid plan once ads are live.
