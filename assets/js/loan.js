/**
 * Pure Credit loan calculations. Pure functions only; no DOM or network.
 *
 * The repayment calculation follows observed examples from
 * https://calc.mimun-click.co.il/ (reviewed 2026-10-27). Prime was inferred as
 * 4.75% from the reference's displayed outputs for P + 5.5%; the reference
 * bundle was not directly inspectable. See README.md for the observations and
 * limitations. Pure Credit's own commission and VAT remain separate fees.
 */

export const COMMISSION_RATE = 0.015;
export const COMMISSION_FIXED = 380;
export const VAT_RATE = 0.18;
export const REFERENCE_PRIME_BASE_RATE_PERCENT = 4.75;
export const PRIME_SPREAD_MIN_PERCENT = 0;
export const PRIME_SPREAD_MAX_PERCENT = 10.5;
export const FIXED_RATE_MIN_PERCENT = 0;
export const FIXED_RATE_MAX_PERCENT = 11;
export const LOAN_AMOUNT_MIN = 30000;
export const LOAN_AMOUNT_MAX = 1000000;
export const TERM_MONTHS_MIN = 12;
export const TERM_MONTHS_MAX = 100;
export const MAX_BALLOON_TERM_MONTHS = 60;
export const MAX_BALLOON_PRINCIPAL_RATIO = 0.65;

/** @typedef {'prime_margin'|'fixed_linked_to_cpi'} InterestRateType */

/** @param {Pick<CalculatorInput, 'termMonths'|'amount'>} input */
export function getMaximumBalloonAmount(input) {
  if (!Number.isInteger(input.termMonths) || input.termMonths < 1 || input.termMonths > MAX_BALLOON_TERM_MONTHS || !Number.isFinite(input.amount) || input.amount <= 0) return 0;
  return Math.floor(input.amount * MAX_BALLOON_PRINCIPAL_RATIO + 1e-8);
}

/** @typedef {Object} CalculatorInput
 * @property {number} amount
 * @property {number} termMonths
 * @property {InterestRateType} interestRateType
 * @property {number} ratePercent  Prime spread or CPI-linked fixed nominal rate
 * @property {number} balloonAmount  Final payment at the end of the term
 */

/**
 * Effective nominal annual rate as a decimal. For the observed reference
 * default, P + 5.5% = 4.75% + 5.5% = 10.25%.
 * @param {CalculatorInput} input
 */
export function getAnnualInterestRate(input) {
  if (input.interestRateType === 'prime_margin') {
    return (REFERENCE_PRIME_BASE_RATE_PERCENT + input.ratePercent) / 100;
  }
  return input.ratePercent / 100;
}

/** Ordinary level-payment loan with a remaining balance (balloon) at month n. */
export function pmt(rate, numberOfPayments, presentValue, futureValue = 0) {
  if (!(numberOfPayments > 0)) return 0;
  if (rate === 0) return -(presentValue + futureValue) / numberOfPayments;
  const growth = Math.pow(1 + rate, numberOfPayments);
  return (-(presentValue * growth + futureValue) * rate) / (growth - 1);
}

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Calculates the monthly annuity payment with the balloon due after the final
 * monthly installment. The reference rounds its displayed payment to whole ILS.
 * @param {CalculatorInput} input
 */
export function calculateLoan(input) {
  const annualRate = getAnnualInterestRate(input);
  const monthlyRate = annualRate / 12;
  const monthlyPaymentExact = pmt(
    monthlyRate,
    input.termMonths,
    -input.amount,
    input.balloonAmount,
  );
  const monthlyPayment = Math.round(monthlyPaymentExact);
  const commission = round2(input.amount * COMMISSION_RATE + COMMISSION_FIXED);
  const vat = round2(commission * VAT_RATE);
  const totalCommissionIncludingVat = round2(commission + vat);
  const totalScheduledRepayments =
    monthlyPayment * input.termMonths + input.balloonAmount;

  return {
    annualRate,
    monthlyRate,
    monthlyPayment,
    monthlyPaymentExact: round2(monthlyPaymentExact),
    commission,
    vat,
    totalCommissionIncludingVat,
    totalScheduledRepayments: round2(totalScheduledRepayments),
    totalEstimatedCost: round2(totalScheduledRepayments + totalCommissionIncludingVat),
  };
}

const isPositiveNumber = (number) => Number.isFinite(number) && number > 0;
const isZeroOrMore = (number) => Number.isFinite(number) && number >= 0;
const isPositiveInteger = (number) => isPositiveNumber(number) && Number.isInteger(number);

/** Israeli phone numbers: 9 or 10 digits, ignoring dashes and spaces. */
export function isValidPhone(value) {
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 10;
}

/** Validates calculator-only fields so rendering and submission share rules. */
export function validateCalculatorInputs(values) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (!isPositiveNumber(values.amount) || values.amount < LOAN_AMOUNT_MIN || values.amount > LOAN_AMOUNT_MAX) {
    errors.amount = `סכום ההלוואה חייב להיות בין ${LOAN_AMOUNT_MIN.toLocaleString('he-IL')} ל־${LOAN_AMOUNT_MAX.toLocaleString('he-IL')} ₪`;
  }

  if (!isPositiveInteger(values.termMonths) || values.termMonths < TERM_MONTHS_MIN || values.termMonths > TERM_MONTHS_MAX) {
    errors.termMonths = `תקופת ההלוואה חייבת להיות בין ${TERM_MONTHS_MIN} ל־${TERM_MONTHS_MAX} חודשים`;
  }

  if (!['prime_margin', 'fixed_linked_to_cpi'].includes(values.interestRateType)) {
    errors.interestRateType = 'נא לבחור סוג ריבית';
  } else {
    const minRate = values.interestRateType === 'prime_margin' ? PRIME_SPREAD_MIN_PERCENT : FIXED_RATE_MIN_PERCENT;
    const maxRate = values.interestRateType === 'prime_margin' ? PRIME_SPREAD_MAX_PERCENT : FIXED_RATE_MAX_PERCENT;
    const cents = values.ratePercent * 100;
    if (!Number.isFinite(values.ratePercent) || values.ratePercent < minRate || values.ratePercent > maxRate || Math.abs(cents - Math.round(cents)) > 1e-8) {
      errors.ratePercent = `יש להזין ריבית בין ${minRate}% ל־${maxRate}% בדיוק של עד שתי ספרות אחרי הנקודה`;
    }
  }

  const maxBalloon = getMaximumBalloonAmount(values);
  if (!isZeroOrMore(values.balloonAmount) || values.balloonAmount > maxBalloon) {
    errors.balloonAmount = maxBalloon > 0
      ? `הבלון חייב להיות בין 0 ל־${maxBalloon.toLocaleString('he-IL')} ₪`
      : `בלון זמין רק לתקופה של עד ${MAX_BALLOON_TERM_MONTHS} חודשים`;
  }

  return errors;
}

/** Checks all application fields using the same calculator validation. */
export function validateApplication(values) {
  const errors = validateCalculatorInputs(values);
  if (!values.agentFullName.trim()) errors.agentFullName = 'נא להזין שם מלא';
  if (!values.agentAgencyName.trim()) errors.agentAgencyName = 'נא להזין שם סוכנות';
  if (!isValidPhone(values.agentPhone)) errors.agentPhone = 'נא להזין מספר טלפון תקין';
  if (!values.applicantFirstName.trim()) errors.applicantFirstName = 'נא להזין שם פרטי';
  if (!values.applicantLastName.trim()) errors.applicantLastName = 'נא להזין שם משפחה';
  if (!isValidPhone(values.applicantPhone)) errors.applicantPhone = 'נא להזין מספר טלפון תקין';
  return errors;
}

/**
 * Builds schemaVersion 2. Existing agent/applicant objects and compatible loan
 * keys keep their names; all sent currency values are numbers.
 */
export function buildLoanApplicationPayload(values, result) {
  const loan = {
    amount: values.amount,
    termMonths: values.termMonths,
    balloonAmount: values.balloonAmount,
    interestRateType: values.interestRateType,
    ratePercent: values.ratePercent,
    annualInterestRate: result.annualRate,
    monthlyInterestRate: result.monthlyRate,
    calculationMethod: 'monthly_annuity_with_end_of_term_balloon',
    balloonTiming: 'after_final_monthly_payment',
    monthlyPayment: result.monthlyPayment,
    monthlyPaymentExact: result.monthlyPaymentExact,
    commissionRate: COMMISSION_RATE,
    commissionFixed: COMMISSION_FIXED,
    commission: result.commission,
    vatRate: VAT_RATE,
    vat: result.vat,
    totalCommissionIncludingVat: result.totalCommissionIncludingVat,
    totalScheduledRepayments: result.totalScheduledRepayments,
    totalEstimatedCost: result.totalEstimatedCost,
    monthlyPaymentRounding: 'nearest_whole_ils',
  };

  if (values.interestRateType === 'prime_margin') {
    loan.primeBaseRatePercent = REFERENCE_PRIME_BASE_RATE_PERCENT;
    loan.primeSpreadPercent = values.ratePercent;
  } else {
    loan.fixedInterestRatePercent = values.ratePercent;
    loan.inflationIndexationIncluded = false;
  }

  return {
    schemaVersion: 2,
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
    loan,
  };
}
