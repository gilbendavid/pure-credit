# Pure Credit

Landing page and car-loan calculator for Pure Credit — financing solutions for
private and business customers.

A plain static site: HTML, CSS and vanilla JavaScript (ES modules). **No build
step and no dependencies.** It is deployed as-is to GitHub Pages.

## Layout

```
index.html              the whole page
about.html              אודות
accessibility.html      הצהרת נגישות
privacy.html            מדיניות פרטיות
assets/css/styles.css   all styling (RTL, mobile-first)
assets/js/loan.js       pure logic: calculation, validation, payload
assets/js/app.js        DOM wiring: live results + form submission
assets/js/config.js     webhook URL (empty in the repo; injected on deploy)
assets/js/workflow.js   JSON POST helper (mockable for tests)
assets/img/             logo + favicons
test/loan.test.js       tests for loan.js
```

The calculator follows the observed inputs and outputs at
`https://calc.mimun-click.co.il/` as reviewed on 2026-10-27. Pure Credit's
commission and VAT rules remain business-specific and separate from the loan
principal. The reference site's public JavaScript bundle could not be opened
directly in the browser; its calculations and limits were checked through the
live interface using multiple input combinations.

## Tests

```
npm test
```

Uses Node's built-in test runner (Node 18+), no packages to install. The suite
checks calculator examples, balloon limits, fees, validation,
payload mapping, and a mocked POST. The mock never contacts the configured
workflow URL.

## The webhook

On submit, the form sends a JSON `POST` to a webhook. The address is **not**
stored in this (public) repo. Instead:

1. `assets/js/config.js` ships with `WEBHOOK_URL = ''`.
2. The deploy workflow rewrites that file from a GitHub Actions secret named
   `LOAN_APPLICATION_WEBHOOK_URL` (Settings → Secrets and variables → Actions).

Until the secret is set, the form validates normally and shows a friendly
"unavailable" message instead of sending.

Note: because this is a static site, the address is still visible in the
browser's network tab. If abuse becomes a problem, route submissions through a
small serverless function (e.g. a Cloudflare Worker) that keeps the URL server
-side — the front end would change by one line.

### Calculator reference behavior

The reference calculator uses a monthly annuity with a possible remaining
balloon balance due after the last monthly payment. With `L` as the requested
principal, `B` as the final balloon, `r` as the annual nominal rate divided by
12, and `n` as the number of months:

```text
monthly payment = (L - B / (1 + r)^n) * r / (1 - (1 + r)^-n)
```

At 0% interest, the formula is `(L - B) / n`. The calculator displays the
monthly payment rounded to the nearest shekel. For prime options, examples
imply a 4.75% prime base plus the selected margin; this base is inferred from
the displayed outputs, not shown as a separate input on the reference. Fixed
rates are CPI-linked; the estimate uses the selected nominal rate and does not
model future CPI changes. A changing prime rate or index may change actual
payments.

Calculator inputs and ranges:

- Requested loan: default ₪100,000; ₪30,000–₪1,000,000.
- Interest type: prime margin or fixed CPI-linked. Users enter a rate from 0%
  through the type-specific maximum, with up to two decimal places. Prime
  margins range up to 10.5%; fixed rates range up to 11%. Default is prime +
  5.5%.
- Term: 12–100 months. An optional balloon is available for terms up to and
  including 60 months, capped at 65% of the original loan principal.

Reference interface examples (monthly amounts are displayed whole shekels):

| Year and terms | Inputs | Observed monthly |
| --- | --- | ---: |
| 2026, 100 months | ₪100,000, prime + 5.5% | ₪1,491 |
| 2026, 100 months | ₪100,000, fixed 5.5% | ₪1,249 |
| 2026, 100 months | ₪120,000, fixed 5.5% | ₪1,499 |
| 60 months | ₪120,000, prime + 5.5%, ₪30,000 final balloon | ₪2,180 |
| 96 months | ₪120,000, fixed 5.5% | ₪1,548 |

The reference mentions its own ₪500 setup fee and 1% fee. Pure Credit keeps its
existing commission of 1.5% of the loan plus ₪380, and 18% VAT on that
commission. Those charges are calculated separately and do not increase the
principal or monthly installment.

### Payload shape (schema version 2)

```json
{
  "schemaVersion": 2,
  "agent": {
    "fullName": "דוגמה דוגמה",
    "agencyName": "סוכנות לדוגמה בע״מ",
    "phone": "050-1111111"
  },
  "applicant": {
    "firstName": "נועם",
    "lastName": "ישראלי",
    "phone": "052-2222222"
  },
  "loan": {
    "amount": 120000,
    "termMonths": 60,
    "balloonAmount": 30000,
    "interestRateType": "prime_margin",
    "ratePercent": 5.5,
    "annualInterestRate": 0.1025,
    "monthlyInterestRate": 0.008541666666666666,
    "calculationMethod": "monthly_annuity_with_end_of_term_balloon",
    "balloonTiming": "after_final_monthly_payment",
    "monthlyPayment": 2180,
    "monthlyPaymentExact": 2179.57,
    "commissionRate": 0.015,
    "commissionFixed": 380,
    "commission": 2180,
    "vatRate": 0.18,
    "vat": 392.4,
    "totalCommissionIncludingVat": 2572.4,
    "totalScheduledRepayments": 160800,
    "totalEstimatedCost": 163372.4,
    "monthlyPaymentRounding": "nearest_whole_ils",
    "primeBaseRatePercent": 4.75,
    "primeSpreadPercent": 5.5
  }
}
```

For fixed CPI-linked loans, the selected rate remains in `ratePercent` and is
also repeated as `fixedInterestRatePercent`; `inflationIndexationIncluded` is
`false`, and the two prime fields are omitted. `annualInterestRate` is always
the effective nominal rate as a decimal (`0.1025` means 10.25%). Money, rates,
and durations are JSON numbers.

#### Old-to-new field mapping

- `agent` and `applicant`: unchanged, including all six nested keys.
- `loan.amount`, `loan.termMonths`, `loan.balloonAmount`,
  `loan.annualInterestRate`, `loan.monthlyPayment`, `loan.commission`,
  `loan.vat`, and `loan.totalCommissionIncludingVat`: retained. Monthly
  payment is now rounded to the displayed whole-shekel estimate.
- `schemaVersion: 2`: new top-level contract version.
- `loan.interestRateType`, `loan.ratePercent`, `loan.monthlyInterestRate`,
  `loan.calculationMethod`,
  `loan.balloonTiming`, `loan.monthlyPaymentExact`,
  `loan.commissionRate`, `loan.commissionFixed`, `loan.vatRate`,
  `loan.totalScheduledRepayments`, `loan.totalEstimatedCost`, and
  `loan.monthlyPaymentRounding`: new fields.
- Prime-rate submissions add `primeBaseRatePercent` and `primeSpreadPercent`.
  Fixed CPI-linked submissions add `fixedInterestRatePercent` and
  `inflationIndexationIncluded`.
- The UI's old `annualInterestRatePercent` input is replaced with the rate type
  and rate option inputs. The existing submitted `annualInterestRate` key
  remains a decimal.

#### Backend migration

1. Accept `schemaVersion: 2` and read all existing agent/applicant fields as
   before.
2. Use `loan.annualInterestRate` as a decimal annual nominal rate, then divide
   by 12. Recompute the level payment with `loan.amount`, `loan.termMonths`,
   and `loan.balloonAmount` as a balance due after the final monthly payment.
3. Round the displayed installment to the nearest whole shekel. Compare with
   both `monthlyPayment` (display value) and `monthlyPaymentExact` (two decimal
   places) within an agreed tolerance.
4. Recompute Pure Credit fees using `commissionRate`, `commissionFixed`, and
   `vatRate`; they are not financed into the principal.
5. Use `totalScheduledRepayments` and `totalEstimatedCost` as estimates only;
   fixed CPI-linked calculations exclude future index changes.

## Editing the site

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

After changing CSS or JS, bump the stylesheet query and `app.js` query in
`index.html` so returning visitors don't use cached copies.
