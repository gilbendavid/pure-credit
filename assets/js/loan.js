/**
 * Pure Credit - loan logic.
 *
 * Pure functions only: no DOM, no network. Everything here is unit-testable
 * with `npm test` (see test/loan.test.mjs).
 *
 * Every formula mirrors the spreadsheet "סימולטור הלוואת רכב.xlsx".
 * The original Excel cell is noted next to each one. Do not invent new
 * financial logic here - the spreadsheet is the source of truth.
 */

/* ------------------------------------------------------------------ *
 * Constants (from the spreadsheet)
 * ------------------------------------------------------------------ */

/** Commission is 1.5% of the loan amount plus a fixed fee. Excel: E16 */
export const COMMISSION_RATE = 0.015;
export const COMMISSION_FIXED = 380;

/** Israeli VAT. Excel: E17 */
export const VAT_RATE = 0.18;

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/**
 * The whole form as a flat object. Keys match the `id` of each input in
 * index.html, which is what lets app.js render errors generically.
 *
 * @typedef {Object} FormValues
 * @property {number} amount                     Excel E7
 * @property {number} termMonths                 Excel E8
 * @property {number} annualInterestRatePercent  Excel E9, but as 8 (not 0.08)
 * @property {number} balloonAmount              Excel E10
 * @property {string} agentFullName
 * @property {string} agentAgencyName
 * @property {string} agentPhone
 * @property {string} applicantFirstName
 * @property {string} applicantLastName
 * @property {string} applicantPhone
 */

/**
 * @typedef {Object} LoanResult
 * @property {number} annualRate                   0.08 for 8%
 * @property {number} monthlyRate                  annualRate / 12
 * @property {number} monthlyPayment               Excel E13
 * @property {number} commission                   Excel E16
 * @property {number} vat                          Excel E17
 * @property {number} totalCommissionIncludingVat  Excel E18
 */

/**
 * The exact shape POSTed to the webhook. All money is a number, never a
 * formatted string.
 *
 * @typedef {Object} LoanApplicationPayload
 * @property {{fullName: string, agencyName: string, phone: string}} agent
 * @property {{firstName: string, lastName: string, phone: string}} applicant
 * @property {{amount: number, termMonths: number, balloonAmount: number,
 *             annualInterestRate: number, monthlyPayment: number,
 *             commission: number, vat: number,
 *             totalCommissionIncludingVat: number}} loan
 */

/* ------------------------------------------------------------------ *
 * Calculation
 * ------------------------------------------------------------------ */

/**
 * Excel's PMT function: the fixed payment for a loan.
 *
 * @param {number} rate              interest rate per period
 * @param {number} numberOfPayments  total number of payments
 * @param {number} presentValue      loan value now (negative = money received)
 * @param {number} [futureValue]     balance left after the last payment
 * @returns {number} payment per period
 */
export function pmt(rate, numberOfPayments, presentValue, futureValue = 0) {
  if (!(numberOfPayments > 0)) return 0;

  // With no interest the balance is simply split across the payments.
  if (rate === 0) return -(presentValue + futureValue) / numberOfPayments;

  const growth = Math.pow(1 + rate, numberOfPayments);
  return (-(presentValue * growth + futureValue) * rate) / (growth - 1);
}

/**
 * The whole calculator, in one pure function.
 *
 * Excel E13: PMT(E9/12, E8, -(E7 - E10/(1+E9/12)^E8))
 *
 * Note how the balloon is handled: instead of passing it to PMT as a future
 * value, the spreadsheet discounts it back to today and subtracts it from the
 * loan amount. We reproduce that exactly.
 *
 * @param {Pick<FormValues, 'amount'|'termMonths'|'annualInterestRatePercent'|'balloonAmount'>} input
 * @returns {LoanResult}
 */
export function calculateLoan(input) {
  const { amount, termMonths, annualInterestRatePercent, balloonAmount } = input;

  const annualRate = annualInterestRatePercent / 100; // 8 -> 0.08   (Excel E9)
  const monthlyRate = annualRate / 12; //                            (Excel E9/12)

  // The balloon is discounted to its value today, then removed from the
  // amount the monthly payments have to cover.
  const balloonPresentValue = balloonAmount / Math.pow(1 + monthlyRate, termMonths);
  const financedNow = amount - balloonPresentValue;

  const monthlyPayment = pmt(monthlyRate, termMonths, -financedNow); // E13
  const commission = amount * COMMISSION_RATE + COMMISSION_FIXED; //  E16
  const vat = commission * VAT_RATE; //                               E17

  return {
    annualRate,
    monthlyRate,
    monthlyPayment,
    commission,
    vat,
    totalCommissionIncludingVat: commission + vat, //                 E18
  };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const isPositiveNumber = (n) => Number.isFinite(n) && n > 0;
const isZeroOrMore = (n) => Number.isFinite(n) && n >= 0;
const isPositiveInteger = (n) => isPositiveNumber(n) && Number.isInteger(n);

/** Israeli phone numbers: 9 or 10 digits, ignoring dashes and spaces. */
export function isValidPhone(value) {
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 10;
}

/**
 * Checks the whole form.
 *
 * @param {FormValues} values
 * @returns {Record<string, string>} field id -> Hebrew error message.
 *                                   Empty object means the form is valid.
 */
export function validateApplication(values) {
  /** @type {Record<string, string>} */
  const errors = {};

  // --- loan details ---
  if (!isPositiveNumber(values.amount)) {
    errors.amount = 'נא להזין סכום הלוואה חיובי';
  }

  if (!isPositiveInteger(values.termMonths)) {
    errors.termMonths = 'נא להזין מספר חודשים שלם וחיובי';
  }

  if (!isZeroOrMore(values.annualInterestRatePercent)) {
    errors.annualInterestRatePercent = 'נא להזין ריבית שנתית של 0 או יותר';
  }

  // The balloon is optional, so an empty field arrives here as 0.
  if (!isZeroOrMore(values.balloonAmount)) {
    errors.balloonAmount = 'סכום הבלון חייב להיות 0 או יותר';
  } else if (isPositiveNumber(values.amount) && values.balloonAmount >= values.amount) {
    // Not an Excel rule, but a balloon at or above the loan amount leaves
    // nothing for the monthly payments to cover, so the result is meaningless.
    errors.balloonAmount = 'סכום הבלון חייב להיות קטן מסכום ההלוואה';
  }

  // --- agent details ---
  if (!values.agentFullName.trim()) errors.agentFullName = 'נא להזין שם מלא';
  if (!values.agentAgencyName.trim()) errors.agentAgencyName = 'נא להזין שם סוכנות';
  if (!isValidPhone(values.agentPhone)) errors.agentPhone = 'נא להזין מספר טלפון תקין';

  // --- applicant details ---
  if (!values.applicantFirstName.trim()) errors.applicantFirstName = 'נא להזין שם פרטי';
  if (!values.applicantLastName.trim()) errors.applicantLastName = 'נא להזין שם משפחה';
  if (!isValidPhone(values.applicantPhone)) errors.applicantPhone = 'נא להזין מספר טלפון תקין';

  return errors;
}

/* ------------------------------------------------------------------ *
 * Webhook payload
 * ------------------------------------------------------------------ */

/** Money is sent with 2 decimals at most, so we never leak float noise. */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Builds the JSON body sent to the webhook.
 *
 * @param {FormValues} values
 * @param {LoanResult} result
 * @returns {LoanApplicationPayload}
 */
export function buildLoanApplicationPayload(values, result) {
  return {
    agent: {
      fullName: values.agentFullName.trim(),
      agencyName: values.agentAgencyName.trim(),
      phone: values.agentPhone.trim(),
    },
    applicant: {
      firstName: values.applicantFirstName.trim(),
      lastName: values.applicantLastName.trim(),
      phone: values.applicantPhone.trim(),
    },
    loan: {
      amount: values.amount,
      termMonths: values.termMonths,
      balloonAmount: values.balloonAmount,
      // Sent as a decimal (0.08), matching Excel cell E9.
      annualInterestRate: result.annualRate,
      monthlyPayment: round2(result.monthlyPayment),
      commission: round2(result.commission),
      vat: round2(result.vat),
      totalCommissionIncludingVat: round2(result.totalCommissionIncludingVat),
    },
  };
}
