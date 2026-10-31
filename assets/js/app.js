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
  getMaximumBalloonAmount,
  PRIME_SPREAD_MIN_PERCENT,
  PRIME_SPREAD_MAX_PERCENT,
  FIXED_RATE_MIN_PERCENT,
  FIXED_RATE_MAX_PERCENT,
  REFERENCE_PRIME_BASE_RATE_PERCENT,
  LOAN_AMOUNT_MIN,
  LOAN_AMOUNT_MAX,
  TERM_MONTHS_MIN,
  TERM_MONTHS_MAX,
  MAX_BALLOON_TERM_MONTHS,
  MAX_BALLOON_PRINCIPAL_RATIO,
  validateApplication,
  validateCalculatorInputs,
  buildLoanApplicationPayload,
} from "./loan.js?v=6";
import { WEBHOOK_URL } from "./config.js";
import { postLoanApplication, readWorkflowResponse } from "./workflow.js?v=2";

/* ------------------------------------------------------------------ *
 * Webhook address
 * ------------------------------------------------------------------ */

/**
 * The address this page posts to.
 *
 * config.js always holds the production n8n url. Loading the page with
 * ?webhook=test rewrites /webhook/ to /webhook-test/ on the same host, which is
 * how you point a real submission at the n8n editor while building the
 * workflow. Only the path is swapped - the host always comes from config.js, so
 * a query string can never redirect applicant data somewhere else.
 */
function resolveWebhookUrl() {
  if (!WEBHOOK_URL) return "";
  const wantsTest =
    new URLSearchParams(window.location.search).get("webhook") === "test";
  if (!wantsTest) return WEBHOOK_URL;
  return WEBHOOK_URL.replace("/webhook/", "/webhook-test/");
}

const webhookUrl = resolveWebhookUrl();

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

const shekelWhole = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

/** Strips thousands-separator commas so "50,000" reads as "50000". */
function stripCommas(value) {
  return value.replace(/,/g, "");
}

/** Reads a numeric input, returning NaN for blanks so validation can catch it. */
function readNumber(id) {
  const raw = stripCommas(document.getElementById(id).value.trim());
  if (raw === "") return NaN;
  return Number(raw);
}

/** Formats a digits-only string with thousands separators: "50000" -> "50,000". */
function formatThousands(digits) {
  return digits === "" ? "" : Number(digits).toLocaleString("en-US");
}

/** Live-formats a text input with thousands separators as the user types. */
function wireThousandsFormatting(input) {
  input.addEventListener("input", () => {
    const cursorPos = input.selectionStart;
    const digitsBeforeCursor = input.value
      .slice(0, cursorPos)
      .replace(/\D/g, "").length;
    input.value = formatThousands(input.value.replace(/\D/g, ""));

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

const calcFields = [
  "amount",
  "termMonths",
  "interestRateType",
  "ratePercent",
  "balloonAmount",
];

/** Current calculator inputs as numbers. Balloon defaults to 0 when blank. */
function readCalcInputs() {
  const balloon = readNumber("balloonAmount");
  return {
    amount: readNumber("amount"),
    termMonths: readNumber("termMonths"),
    interestRateType: document.getElementById("interestRateType").value,
    ratePercent: readNumber("ratePercent"),
    balloonAmount: Number.isNaN(balloon) ? 0 : balloon,
  };
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function getSlider(fieldId) {
  return document.querySelector(`[data-slider-for="${fieldId}"]`);
}

function renderRateOptions() {
  const type = document.getElementById("interestRateType").value;
  const rateInput = document.getElementById("ratePercent");
  const prime = type === "prime_margin";
  const minRate = prime ? PRIME_SPREAD_MIN_PERCENT : FIXED_RATE_MIN_PERCENT;
  const maxRate = prime ? PRIME_SPREAD_MAX_PERCENT : FIXED_RATE_MAX_PERCENT;
  const currentRate = readNumber("ratePercent");
  rateInput.min = String(minRate);
  rateInput.max = String(maxRate);
  rateInput.step = "0.01";
  if (
    !Number.isFinite(currentRate) ||
    currentRate < minRate ||
    currentRate > maxRate
  ) {
    rateInput.value = String(minRate);
  }
  document.getElementById("ratePercentLabel").textContent = prime
    ? "מרווח מעל ריבית הפריים"
    : "ריבית קבועה צמודה למדד";
}

/** Updates the amount and balloon limits and keeps their sliders in sync. */
function syncDynamicLimits() {
  const input = readCalcInputs();
  const amountSlider = getSlider("amount");
  const termSlider = getSlider("termMonths");
  const balloonSlider = getSlider("balloonAmount");
  const balloonField = document.getElementById("balloonField");

  amountSlider.min = String(LOAN_AMOUNT_MIN);
  amountSlider.max = String(LOAN_AMOUNT_MAX);
  document.getElementById("termMonths").min = String(TERM_MONTHS_MIN);
  document.getElementById("termMonths").max = String(TERM_MONTHS_MAX);
  termSlider.min = String(TERM_MONTHS_MIN);
  termSlider.max = String(TERM_MONTHS_MAX);

  const balloonEnabled =
    Number.isInteger(input.termMonths) &&
    input.termMonths >= TERM_MONTHS_MIN &&
    input.termMonths <= MAX_BALLOON_TERM_MONTHS &&
    Number.isFinite(input.amount) &&
    input.amount > 0;
  balloonField.hidden = !balloonEnabled;
  const maxBalloon = getMaximumBalloonAmount(input);
  balloonSlider.min = "0";
  balloonSlider.max = String(maxBalloon);
  const balloonInput = document.getElementById("balloonAmount");
  const currentBalloon = readNumber("balloonAmount");
  if (!balloonEnabled) {
    balloonInput.value = "0";
    balloonSlider.value = "0";
  } else if (Number.isFinite(currentBalloon)) {
    const clampedBalloon = Math.min(Math.max(currentBalloon, 0), maxBalloon);
    balloonInput.value = formatThousands(String(clampedBalloon));
    balloonSlider.value = String(clampedBalloon);
  }

  const amountValue = readNumber("amount");
  if (Number.isFinite(amountValue)) {
    amountSlider.value = String(
      Math.min(
        Math.max(amountValue, Number(amountSlider.min)),
        Number(amountSlider.max),
      ),
    );
  }
  const termValue = readNumber("termMonths");
  if (Number.isFinite(termValue)) {
    termSlider.value = String(
      Math.min(
        Math.max(termValue, Number(termSlider.min)),
        Number(termSlider.max),
      ),
    );
  }
}

function renderCalculatorErrors(errors) {
  for (const id of calcFields) {
    if (errors[id]) showFieldError(id, errors[id]);
    else clearFieldError(id);
  }
}

/** Recalculates and repaints the results. Runs on every input change. */
function renderResults() {
  syncDynamicLimits();
  const input = readCalcInputs();
  const errors = validateCalculatorInputs(input);
  renderCalculatorErrors(errors);

  const outputIds = [
    "amount",
    "termMonths",
    "balloonAmount",
    "interestRateLabel",
    "annualInterestRate",
  ];
  if (Object.keys(errors).length) {
    setText("out-monthlyPayment", "—");
    setText("apply-monthlyPayment", "—");
    for (const id of outputIds) setText("out-" + id, "—");
    return;
  }

  const result = calculateLoan(input);
  const rateLabel =
    input.interestRateType === "prime_margin"
      ? `פריים + ${input.ratePercent}%`
      : `קבועה צמודה ${input.ratePercent}%`;
  const effectiveRateText = `${(result.annualRate * 100).toLocaleString("he-IL", { maximumFractionDigits: 2 })}%`;

  setText("out-monthlyPayment", shekelWhole.format(result.monthlyPayment));
  setText("apply-monthlyPayment", shekelWhole.format(result.monthlyPayment));
  setText("out-amount", shekelWhole.format(input.amount));
  setText("out-termMonths", input.termMonths + " חודשים");
  setText("out-balloonAmount", shekelWhole.format(input.balloonAmount));
  setText("out-interestRateLabel", rateLabel);
  setText("out-annualInterestRate", effectiveRateText);
}

/** Keeps each range slider and its matching typed input synchronized. */
function wireSliders() {
  for (const slider of document.querySelectorAll(".slider")) {
    const target = document.getElementById(slider.dataset.sliderFor);
    slider.addEventListener("input", () => {
      target.value = formatThousands(slider.value);
      syncDynamicLimits();
      renderResults();
    });
    target.addEventListener("input", () => {
      const n = Number(stripCommas(target.value));
      if (Number.isFinite(n)) {
        slider.value = String(
          Math.min(Math.max(n, Number(slider.min)), Number(slider.max)),
        );
      }
      syncDynamicLimits();
      renderResults();
    });
  }

  document.getElementById("interestRateType").addEventListener("change", () => {
    renderRateOptions();
    renderResults();
  });
  document
    .getElementById("ratePercent")
    .addEventListener("input", renderResults);
}

/* ------------------------------------------------------------------ *
 * Error display (shared by the apply form)
 * ------------------------------------------------------------------ */

function showFieldError(fieldId, message) {
  const field = document.querySelector(`[data-field="${fieldId}"]`);
  if (!field) return;
  field.classList.add("invalid");
  const err = field.querySelector(".err");
  if (err) err.textContent = message;
}

function clearFieldError(fieldId) {
  const field = document.querySelector(`[data-field="${fieldId}"]`);
  if (!field) return;
  field.classList.remove("invalid");
  const err = field.querySelector(".err");
  if (err) err.textContent = "";
}

/* ------------------------------------------------------------------ *
 * The apply form: validate, submit, handle success / failure
 * ------------------------------------------------------------------ */

const applyForm = document.getElementById("applyForm");
const submitBtn = document.getElementById("submitBtn");
const applyError = document.getElementById("applyError");
const applySuccess = document.getElementById("applySuccess");
const applyStatus = document.getElementById("applyStatus");
const applyStatusValue = document.getElementById("applyStatusValue");
const newRequestBtn = document.getElementById("newRequestBtn");

/** Every field validation can mark, in the order they appear on the page. */
const allFieldIds = [
  ...calcFields,
  "agentFullName",
  "agentAgencyName",
  "agentPhone",
  "applicantFirstName",
  "applicantLastName",
  "applicantPhone",
];

// Guards against a double submit even if the button state lags (e.g. double Enter).
let isSubmitting = false;

/** Reads every field the payload needs, straight off the form. */
function readAllValues() {
  const text = (id) => document.getElementById(id).value;
  const calc = readCalcInputs();
  return {
    ...calc,
    agentFullName: text("agentFullName"),
    agentAgencyName: text("agentAgencyName"),
    agentPhone: text("agentPhone"),
    applicantFirstName: text("applicantFirstName"),
    applicantLastName: text("applicantLastName"),
    applicantPhone: text("applicantPhone"),
  };
}

function setSubmitting(active) {
  isSubmitting = active;
  submitBtn.disabled = active;
  submitBtn.textContent = active ? "שולח בקשה..." : "שלח בקשה להלוואה";
}

function showFormError(message) {
  applyError.textContent = message;
  applyError.classList.add("show");
}

/** Shows the confirmation screen, with the webhook's status when it sent one. */
function showSuccess(status) {
  if (status) {
    applyStatusValue.textContent = status;
    applyStatus.hidden = false;
  } else {
    applyStatus.hidden = true;
  }
  // Put the button back to "send" while it is out of sight, so the form is
  // ready to use the moment "הגש בקשה חדשה" brings it back.
  setSubmitting(false);
  applyForm.hidden = true;
  applySuccess.hidden = false;
  applySuccess.scrollIntoView({ block: "center" });
}

/**
 * Clears the confirmation screen and hands back an empty form.
 *
 * Only the agent and applicant details are wiped - form.reset() reaches exactly
 * the fields inside <form id="applyForm">. The loan amount, term, rate and
 * balloon live in the calculator section above and are deliberately left as the
 * user set them, which is usually what a second application for the same deal
 * needs. renderResults() repaints the mirrored monthly payment either way.
 */
function startNewRequest() {
  applyForm.reset();
  for (const id of allFieldIds) clearFieldError(id);
  applyError.textContent = "";
  applyError.classList.remove("show");
  applyStatus.hidden = true;

  applySuccess.hidden = true;
  applyForm.hidden = false;
  renderResults();

  applyForm.scrollIntoView({ block: "start" });
  document.getElementById("agentFullName").focus();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isSubmitting) return;

  applyError.classList.remove("show");

  // Silently drop bot submissions that fill the honeypot.
  if (document.getElementById("company").value !== "") return;

  const values = readAllValues();

  // Validate everything and paint the errors.
  const errors = validateApplication(values);
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

  if (!webhookUrl) {
    // Nothing to send to yet. Fail visibly but keep the form intact.
    console.warn("WEBHOOK_URL is not set - the application was not sent.");
    showFormError("שליחת הבקשה אינה זמינה כרגע. נסו שוב מאוחר יותר.");
    return;
  }

  const payload = buildLoanApplicationPayload(values, calculateLoan(values));

  setSubmitting(true);
  try {
    const response = await postLoanApplication(webhookUrl, payload);

    const result = await readWorkflowResponse(response);

    if (!result.ok) {
      // A 200 carrying success:false is a rejection, not a transport failure -
      // say so in the log so it is not mistaken for a network problem.
      throw new Error(
        response.ok
          ? "webhook returned success:false" +
              (result.message ? " - " + result.message : "")
          : "HTTP " + response.status,
      );
    }

    showSuccess(result.status);
  } catch (err) {
    // Keep every value the user typed; just let them try again.
    //
    // A TypeError here means fetch never got a readable response: almost always
    // the CORS preflight. The browser reports it as a generic network failure
    // and only prints the blocked-by-CORS line in the console, so spell out the
    // fix rather than leaving a bare "Failed to fetch".
    if (err instanceof TypeError) {
      console.error(
        "Submission blocked before it reached n8n (CORS or network). Open the " +
          'Webhook node in n8n > Options > "Allowed Origins (CORS)" and set it ' +
          "to " +
          window.location.origin +
          " (or *). Target was: " +
          webhookUrl,
        err,
      );
    } else {
      console.error("Submission failed:", err);
    }
    showFormError("לא הצלחנו לשלוח את הבקשה. אנא נסו שוב.");
    setSubmitting(false);
  }
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

wireThousandsFormatting(document.getElementById("amount"));
wireThousandsFormatting(document.getElementById("balloonAmount"));
renderRateOptions();
wireSliders();
syncDynamicLimits();
renderResults();
applyForm.addEventListener("submit", handleSubmit);
newRequestBtn.addEventListener("click", startNewRequest);
