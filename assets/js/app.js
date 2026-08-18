/**
 * Pure Credit - browser wiring.
 *
 * This is the only file that touches the DOM. All the maths and rules live in
 * loan.js as pure functions; here we just read inputs, render results, and
 * send the form. Keeping it split this way is what lets loan.js be tested in
 * Node with no browser.
 */

import {
  calculateLoan,
  validateApplication,
  buildLoanApplicationPayload,
} from './loan.js';
import { WEBHOOK_URL } from './config.js';

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

const shekelWhole = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});

const shekelPrecise = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Strips thousands-separator commas so "50,000" reads as "50000". */
function stripCommas(value) {
  return value.replace(/,/g, '');
}

/** Reads a numeric input, returning NaN for blanks so validation can catch it. */
function readNumber(id) {
  const raw = stripCommas(document.getElementById(id).value.trim());
  if (raw === '') return NaN;
  return Number(raw);
}

/** Formats a digits-only string with thousands separators: "50000" -> "50,000". */
function formatThousands(digits) {
  return digits === '' ? '' : Number(digits).toLocaleString('en-US');
}

/** Live-formats a text input with thousands separators as the user types. */
function wireThousandsFormatting(input) {
  input.addEventListener('input', () => {
    const cursorPos = input.selectionStart;
    const digitsBeforeCursor = input.value.slice(0, cursorPos).replace(/\D/g, '').length;
    input.value = formatThousands(input.value.replace(/\D/g, ''));

    // Restore the cursor after the same digit it followed before formatting.
    let seen = 0;
    let pos = 0;
    while (pos < input.value.length && seen < digitsBeforeCursor) {
      if (/\d/.test(input.value[pos])) seen++;
      pos++;
    }
    input.setSelectionRange(pos, pos);
  });
}

/* ------------------------------------------------------------------ *
 * The calculator: live results
 * ------------------------------------------------------------------ */

const calcFields = ['amount', 'termMonths', 'annualInterestRatePercent', 'balloonAmount'];

/** Current calculator inputs as numbers. Balloon defaults to 0 when blank. */
function readCalcInputs() {
  const balloon = readNumber('balloonAmount');
  return {
    amount: readNumber('amount'),
    termMonths: readNumber('termMonths'),
    annualInterestRatePercent: readNumber('annualInterestRatePercent'),
    balloonAmount: Number.isNaN(balloon) ? 0 : balloon,
  };
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

/** Recalculates and repaints the results. Runs on every input change. */
function renderResults() {
  const input = readCalcInputs();

  // Only compute when the required numbers make sense; otherwise show a dash.
  const ready =
    input.amount > 0 &&
    Number.isInteger(input.termMonths) &&
    input.termMonths > 0 &&
    input.annualInterestRatePercent >= 0 &&
    input.balloonAmount >= 0 &&
    input.balloonAmount < input.amount;

  if (!ready) {
    setText('out-monthlyPayment', '—');
    setText('apply-monthlyPayment', '—');
    for (const id of ['amount', 'termMonths', 'balloonAmount',
                      'annualInterestRatePercent', 'commission', 'vat',
                      'totalCommissionIncludingVat']) {
      setText('out-' + id, '—');
    }
    return;
  }

  const r = calculateLoan(input);

  setText('out-monthlyPayment', shekelWhole.format(r.monthlyPayment));
  setText('apply-monthlyPayment', shekelWhole.format(r.monthlyPayment));

  setText('out-amount', shekelWhole.format(input.amount));
  setText('out-termMonths', input.termMonths + ' חודשים');
  setText('out-balloonAmount', shekelWhole.format(input.balloonAmount));
  setText('out-annualInterestRatePercent', input.annualInterestRatePercent + '%');
  setText('out-commission', shekelPrecise.format(r.commission));
  setText('out-vat', shekelPrecise.format(r.vat));
  setText('out-totalCommissionIncludingVat', shekelPrecise.format(r.totalCommissionIncludingVat));
}

/** Keeps each range slider and its number input in step with each other. */
function wireSliders() {
  for (const slider of document.querySelectorAll('.slider')) {
    const target = document.getElementById(slider.dataset.sliderFor);

    slider.addEventListener('input', () => {
      target.value = formatThousands(slider.value);
      renderResults();
    });

    target.addEventListener('input', () => {
      // Mirror typed values onto the slider, clamped to its range.
      const n = Number(stripCommas(target.value));
      if (Number.isFinite(n)) {
        slider.value = Math.min(Math.max(n, Number(slider.min)), Number(slider.max));
      }
      renderResults();
    });
  }
}

/* ------------------------------------------------------------------ *
 * Error display (shared by the apply form)
 * ------------------------------------------------------------------ */

function showFieldError(fieldId, message) {
  const field = document.querySelector(`[data-field="${fieldId}"]`);
  if (!field) return;
  field.classList.add('invalid');
  const err = field.querySelector('.err');
  if (err) err.textContent = message;
}

function clearFieldError(fieldId) {
  const field = document.querySelector(`[data-field="${fieldId}"]`);
  if (!field) return;
  field.classList.remove('invalid');
  const err = field.querySelector('.err');
  if (err) err.textContent = '';
}

/* ------------------------------------------------------------------ *
 * The apply form: validate, submit, handle success / failure
 * ------------------------------------------------------------------ */

const applyForm = document.getElementById('applyForm');
const submitBtn = document.getElementById('submitBtn');
const applyError = document.getElementById('applyError');
const applySuccess = document.getElementById('applySuccess');

// Guards against a double submit even if the button state lags (e.g. double Enter).
let isSubmitting = false;

/** Reads every field the payload needs, straight off the form. */
function readAllValues() {
  const text = (id) => document.getElementById(id).value;
  const calc = readCalcInputs();
  return {
    ...calc,
    agentFullName: text('agentFullName'),
    agentAgencyName: text('agentAgencyName'),
    agentPhone: text('agentPhone'),
    applicantFirstName: text('applicantFirstName'),
    applicantLastName: text('applicantLastName'),
    applicantPhone: text('applicantPhone'),
  };
}

function setSubmitting(active) {
  isSubmitting = active;
  submitBtn.disabled = active;
  submitBtn.textContent = active ? 'שולח בקשה...' : 'שלח בקשה להלוואה';
}

function showFormError(message) {
  applyError.textContent = message;
  applyError.classList.add('show');
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isSubmitting) return;

  applyError.classList.remove('show');

  // Silently drop bot submissions that fill the honeypot.
  if (document.getElementById('company').value !== '') return;

  const values = readAllValues();

  // Validate everything and paint the errors.
  const errors = validateApplication(values);
  const allFieldIds = [
    ...calcFields,
    'agentFullName', 'agentAgencyName', 'agentPhone',
    'applicantFirstName', 'applicantLastName', 'applicantPhone',
  ];
  for (const id of allFieldIds) {
    if (errors[id]) showFieldError(id, errors[id]);
    else clearFieldError(id);
  }
  if (Object.keys(errors).length > 0) {
    // Jump to the first field with a problem.
    const first = allFieldIds.find((id) => errors[id]);
    document.getElementById(first)?.focus();
    return;
  }

  if (!WEBHOOK_URL) {
    // Nothing to send to yet. Fail visibly but keep the form intact.
    console.warn('WEBHOOK_URL is not set - the application was not sent.');
    showFormError('שליחת הבקשה אינה זמינה כרגע. נסו שוב מאוחר יותר.');
    return;
  }

  const payload = buildLoanApplicationPayload(values, calculateLoan(values));

  setSubmitting(true);
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);

    // Success: swap the form for the confirmation screen.
    applyForm.hidden = true;
    applySuccess.hidden = false;
    applySuccess.scrollIntoView({ block: 'center' });
  } catch (err) {
    // Keep every value the user typed; just let them try again.
    console.error('Submission failed:', err);
    showFormError('לא הצלחנו לשלוח את הבקשה. אנא נסו שוב.');
    setSubmitting(false);
  }
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

wireSliders();
wireThousandsFormatting(document.getElementById('amount'));
wireThousandsFormatting(document.getElementById('balloonAmount'));
renderResults();
applyForm.addEventListener('submit', handleSubmit);
