# PFIC Wholesale Checker

Coach uploads the student's .xlsx → Keepa UK checks → notes written to **Coach Notes** → download a new reviewed copy. Never approves a purchase.

## Deploy on Netlify
1. Put this folder in a GitHub repo (or use `netlify deploy --prod` from this folder). Netlify reads `netlify.toml`: site = `site/`, function = `netlify/functions/keepa.js`.
2. Site settings → Environment variables:
   - `KEEPA_API_KEY` = your Keepa key (stays server-side, never in the browser)
   - `APP_PASSWORD` = a shared password for coaches
3. Redeploy after adding the variables. Open the site, enter the password, upload a sheet.

## Sheet requirements
Header row (within the first 25 rows) with an **ASIN** column and a **Coach Notes** column. Optional columns it reads (by name): Product Name, Brand, Current Price, Supplier Name, Offered Unit Cost, Shipping, Landed Cost, Referral Fee, FBA Fee, MOQ, Seller Central Eligibility. Only Coach Notes is written; existing notes are kept and the new review is appended.

## Rules it follows (from the PFIC checklist)
- UNVERIFIED unless there is evidence; student-entered figures/PASS cells are never treated as verified.
- Score = verified points / available, never a provisional 10.
- Thresholds marked * in the UI (third-party Buy Box %, Amazon share %, returns allowance) are NOT in the checklist – tool defaults to calibrate.

## Keepa tokens
Standard run ≈ a few tokens per ASIN. "Deep seller data" adds offers and costs much more. Batches of 5 ASINs; if Keepa is out of tokens the page waits and retries.

## Test
`npm i exceljs && node test/test.js` (mock data – confirms formulas, formatting and non-notes cells are untouched).
