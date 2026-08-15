# Pure Credit

Landing page and car-loan calculator for Pure Credit — financing solutions for
private and business customers.

A plain static site: HTML, CSS and vanilla JavaScript (ES modules). **No build
step and no dependencies.** It is deployed as-is to GitHub Pages.

## Layout

```
index.html              the whole page
terms.html              תנאי שימוש (skeleton)
privacy.html            מדיניות פרטיות (skeleton)
assets/css/styles.css   all styling (RTL, mobile-first)
assets/js/loan.js       pure logic: calculation, validation, payload
assets/js/app.js        DOM wiring: live results + form submission
assets/js/config.js     webhook URL (empty in the repo; injected on deploy)
assets/img/             logo + favicons
test/loan.test.js       tests for loan.js
```

The calculator formulas come from `סימולטור הלוואת רכב.xlsx` and are the source
of truth. `loan.js` notes the original Excel cell next to each formula.

## Tests

```
npm test
```

Uses Node's built-in test runner (Node 18+), no packages to install. The suite
checks the calculation against the spreadsheet's reference case
(50,000 / 60 months / 8% / balloon 20,000 → 741.62 monthly).

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

### Payload shape

```json
{
  "agent":     { "fullName": "", "agencyName": "", "phone": "" },
  "applicant": { "firstName": "", "lastName": "", "phone": "" },
  "loan": {
    "amount": 50000,
    "termMonths": 60,
    "balloonAmount": 20000,
    "annualInterestRate": 0.08,
    "monthlyPayment": 741.63,
    "commission": 1130,
    "vat": 203.4,
    "totalCommissionIncludingVat": 1333.4
  }
}
```

`annualInterestRate` is a decimal (`0.08`), matching the spreadsheet. All money
values are numbers, never formatted strings.

## Editing the site

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

After changing CSS or JS, bump the `?v=1` query in `index.html` so returning
visitors don't get a cached copy.
