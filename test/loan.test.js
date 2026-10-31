import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pmt,
  calculateLoan,
  validateApplication,
  validateCalculatorInputs,
  buildLoanApplicationPayload,
  getMaximumBalloonAmount,
  LOAN_AMOUNT_MIN,
  LOAN_AMOUNT_MAX,
  TERM_MONTHS_MIN,
  TERM_MONTHS_MAX,
  MAX_BALLOON_TERM_MONTHS,
  MAX_BALLOON_PRINCIPAL_RATIO,
  PRIME_SPREAD_MIN_PERCENT,
  PRIME_SPREAD_MAX_PERCENT,
  FIXED_RATE_MIN_PERCENT,
  FIXED_RATE_MAX_PERCENT,
  COMMISSION_RATE,
  COMMISSION_FIXED,
  VAT_RATE,
  REFERENCE_PRIME_BASE_RATE_PERCENT,
} from '../assets/js/loan.js';
import { postLoanApplication, readWorkflowResponse } from '../assets/js/workflow.js';

function closeTo(actual, expected, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

function validForm(overrides = {}) {
  return {
    amount: 100000,
    termMonths: 100,
    interestRateType: 'prime_margin',
    ratePercent: 5.5,
    balloonAmount: 0,
    agentFullName: 'ישראל ישראלי',
    agentAgencyName: 'סוכנות רכב בע״מ',
    agentPhone: '050-1234567',
    applicantFirstName: 'דניאל',
    applicantLastName: 'כהן',
    applicantPhone: '0521234567',
    ...overrides,
  };
}

test('matches reference default: 100,000 / 100 / P + 5.5% = 1,491 monthly', () => {
  const result = calculateLoan(validForm());
  closeTo(result.annualRate, 0.1025, 1e-12);
  closeTo(result.monthlyPaymentExact, 1491.17);
  assert.equal(result.monthlyPayment, 1491);
});

test('matches fixed indexed example: 100,000 / 100 / 5.5% = 1,249 monthly', () => {
  const result = calculateLoan(validForm({
    interestRateType: 'fixed_linked_to_cpi',
    ratePercent: 5.5,
  }));
  closeTo(result.annualRate, 0.055, 1e-12);
  closeTo(result.monthlyPaymentExact, 1248.86);
  assert.equal(result.monthlyPayment, 1249);
});

test('accepts user-entered decimal rates for both rate types', () => {
  const prime = calculateLoan(validForm({ ratePercent: 6.25 }));
  const fixed = calculateLoan(validForm({ interestRateType: 'fixed_linked_to_cpi', ratePercent: 6.25 }));
  const lowPrime = calculateLoan(validForm({ ratePercent: 0.21 }));
  const lowFixed = calculateLoan(validForm({ interestRateType: 'fixed_linked_to_cpi', ratePercent: 0.21 }));
  closeTo(prime.annualRate, 0.11, 1e-12);
  closeTo(fixed.annualRate, 0.0625, 1e-12);
  closeTo(lowPrime.annualRate, 0.0496, 1e-12);
  closeTo(lowFixed.annualRate, 0.0021, 1e-12);
  assert.deepEqual(validateCalculatorInputs(validForm({ ratePercent: 6.25 })), {});
  assert.deepEqual(validateCalculatorInputs(validForm({ interestRateType: 'fixed_linked_to_cpi', ratePercent: 6.25 })), {});
  assert.deepEqual(validateCalculatorInputs(validForm({ ratePercent: 0.21 })), {});
  assert.deepEqual(validateCalculatorInputs(validForm({ interestRateType: 'fixed_linked_to_cpi', ratePercent: 0.21 })), {});
  assert.equal(PRIME_SPREAD_MIN_PERCENT, 0);
  assert.equal(PRIME_SPREAD_MAX_PERCENT, 10.5);
  assert.equal(FIXED_RATE_MIN_PERCENT, 0);
  assert.equal(FIXED_RATE_MAX_PERCENT, 11);
});

test('matches reference amount scaling: 120,000 / 100 / fixed 5.5% = 1,499', () => {
  const result = calculateLoan(validForm({
    amount: 120000,
    interestRateType: 'fixed_linked_to_cpi',
    ratePercent: 5.5,
  }));
  assert.equal(result.monthlyPayment, 1499);
});

test('matches the balloon calculation: 120,000 / 60 / P + 5.5% / 30,000 balloon = 2,180', () => {
  const input = validForm({
    amount: 120000,
    termMonths: 60,
    balloonAmount: 30000,
  });
  const result = calculateLoan(input);
  closeTo(result.monthlyPaymentExact, 2179.57);
  assert.equal(result.monthlyPayment, 2180);
  assert.equal(result.totalScheduledRepayments, 160800);
});

test('monthly payment recalculates with an eligible balloon up to 65% of principal', () => {
  const noBalloon = calculateLoan(validForm({ amount: 100000, termMonths: 60 }));
  const withBalloon = calculateLoan(validForm({ amount: 100000, termMonths: 60, balloonAmount: 65000 }));
  assert.equal(withBalloon.monthlyPayment, 1303);
  assert.ok(withBalloon.monthlyPayment < noBalloon.monthlyPayment);
  assert.equal(withBalloon.totalScheduledRepayments, withBalloon.monthlyPayment * 60 + 65000);
});

test('matches reference 2022 term example: fixed 5.5%, 120,000 over 96 months = 1,548', () => {
  const result = calculateLoan(validForm({
    amount: 120000,
    termMonths: 96,
    interestRateType: 'fixed_linked_to_cpi',
    ratePercent: 5.5,
  }));
  assert.equal(result.monthlyPayment, 1548);
});

test('a zero-rate boundary is mathematically stable', () => {
  const result = calculateLoan(validForm({
    interestRateType: 'fixed_linked_to_cpi',
    ratePercent: 0,
    amount: 60000,
    termMonths: 24,
    balloonAmount: 12000,
  }));
  assert.equal(result.monthlyPayment, 2000);
});

test('pmt handles a zero rate and final balloon', () => {
  closeTo(pmt(0, 10, -1000, 200), 80, 1e-12);
});

test('balloon ceiling is 65% of original principal for terms up to 60 months', () => {
  assert.equal(getMaximumBalloonAmount({ termMonths: 60, amount: 120000 }), 78000);
  assert.equal(getMaximumBalloonAmount({ termMonths: 24, amount: 60000 }), 39000);
  assert.equal(getMaximumBalloonAmount({ termMonths: 61, amount: 120000 }), 0);
  assert.equal(getMaximumBalloonAmount({ termMonths: 60, amount: 0 }), 0);
  assert.equal(LOAN_AMOUNT_MIN, 30000);
  assert.equal(LOAN_AMOUNT_MAX, 1000000);
  assert.equal(TERM_MONTHS_MIN, 12);
  assert.equal(TERM_MONTHS_MAX, 100);
  assert.equal(MAX_BALLOON_TERM_MONTHS, 60);
  assert.equal(MAX_BALLOON_PRINCIPAL_RATIO, 0.65);
});

test('Pure Credit commission and VAT remain separate from financed principal', () => {
  const result = calculateLoan(validForm());
  assert.equal(result.commission, 1880);
  assert.equal(result.vat, 338.4);
  assert.equal(result.totalCommissionIncludingVat, 2218.4);
  assert.equal(result.totalScheduledRepayments, result.monthlyPayment * 100);
  assert.equal(result.totalEstimatedCost, result.totalScheduledRepayments + 2218.4);
  assert.equal(COMMISSION_RATE, 0.015);
  assert.equal(COMMISSION_FIXED, 380);
  assert.equal(VAT_RATE, 0.18);
  assert.equal(REFERENCE_PRIME_BASE_RATE_PERCENT, 4.75);
});

test('calculator rejects invalid ranges, out-of-range rates, and balloon outside its term/amount limit', () => {
  assert.ok(validateCalculatorInputs(validForm({ amount: 20000 })).amount);
  assert.ok(validateCalculatorInputs(validForm({ amount: 1000001 })).amount);
  assert.ok(validateCalculatorInputs(validForm({ termMonths: 101 })).termMonths);
  assert.ok(validateCalculatorInputs(validForm({ termMonths: 11 })).termMonths);
  assert.deepEqual(validateCalculatorInputs(validForm({ ratePercent: 5 })), {});
  assert.ok(validateCalculatorInputs(validForm({ ratePercent: 10.51 })).ratePercent);
  assert.ok(validateCalculatorInputs(validForm({ ratePercent: -0.01 })).ratePercent);
  assert.ok(validateCalculatorInputs(validForm({ interestRateType: 'fixed_linked_to_cpi', ratePercent: 11.01 })).ratePercent);
  assert.ok(validateCalculatorInputs(validForm({ interestRateType: 'fixed_linked_to_cpi', ratePercent: 6.255 })).ratePercent);
  assert.ok(validateCalculatorInputs(validForm({ termMonths: 60, balloonAmount: 65001 })).balloonAmount);
  assert.ok(validateCalculatorInputs(validForm({ termMonths: 61, balloonAmount: 1 })).balloonAmount);
});

test('calculator accepts maximum amount, term, and balloon boundaries', () => {
  assert.deepEqual(validateCalculatorInputs(validForm({
    amount: 1000000,
    termMonths: 60,
    interestRateType: 'fixed_linked_to_cpi',
    ratePercent: 11,
    balloonAmount: 650000,
  })), {});
  assert.deepEqual(validateCalculatorInputs(validForm({
    amount: 30000,
    termMonths: 100,
    balloonAmount: 0,
  })), {});
});

test('validates agent and applicant fields with the existing contact rules', () => {
  assert.deepEqual(validateApplication(validForm()), {});
  const errors = validateApplication(validForm({
    agentFullName: ' ',
    agentAgencyName: '',
    agentPhone: '123',
    applicantFirstName: '',
    applicantLastName: ' ',
    applicantPhone: 'x',
  }));
  for (const key of ['agentFullName', 'agentAgencyName', 'agentPhone', 'applicantFirstName', 'applicantLastName', 'applicantPhone']) {
    assert.ok(errors[key], `${key} should be rejected`);
  }
});

test('schema v2 keeps agent/applicant objects and supplies calculation inputs and rules', () => {
  const values = validForm({
    balloonAmount: 30000,
    amount: 120000,
    termMonths: 60,
  });
  const result = calculateLoan(values);
  const payload = buildLoanApplicationPayload(values, result);
  assert.equal(payload.schemaVersion, 2);
  assert.deepEqual(payload.agent, {
    fullName: 'ישראל ישראלי',
    agencyName: 'סוכנות רכב בע״מ',
    phone: '050-1234567',
  });
  assert.deepEqual(payload.applicant, {
    firstName: 'דניאל',
    lastName: 'כהן',
    phone: '0521234567',
  });
  assert.deepEqual(payload.loan, {
    amount: 120000,
    termMonths: 60,
    balloonAmount: 30000,
    interestRateType: 'prime_margin',
    ratePercent: 5.5,
    annualInterestRate: 0.1025,
    monthlyInterestRate: 0.1025 / 12,
    calculationMethod: 'monthly_annuity_with_end_of_term_balloon',
    balloonTiming: 'after_final_monthly_payment',
    monthlyPayment: 2180,
    monthlyPaymentExact: 2179.57,
    commissionRate: 0.015,
    commissionFixed: 380,
    commission: 2180,
    vatRate: 0.18,
    vat: 392.4,
    totalCommissionIncludingVat: 2572.4,
    totalScheduledRepayments: 160800,
    totalEstimatedCost: 163372.4,
    monthlyPaymentRounding: 'nearest_whole_ils',
    primeBaseRatePercent: 4.75,
    primeSpreadPercent: 5.5,
  });
});

test('fixed-rate payload identifies CPI indexation as excluded from the estimate', () => {
  const values = validForm({ interestRateType: 'fixed_linked_to_cpi', ratePercent: 5.5 });
  const payload = buildLoanApplicationPayload(values, calculateLoan(values));
  assert.equal(payload.loan.fixedInterestRatePercent, 5.5);
  assert.equal(payload.loan.inflationIndexationIncluded, false);
  assert.equal('primeSpreadPercent' in payload.loan, false);
});

test('workflow submission uses a mock fetch, JSON POST, and never calls the configured endpoint', async () => {
  const calls = [];
  const mockFetch = async (...args) => {
    calls.push(args);
    return { ok: true, status: 200 };
  };
  const payload = buildLoanApplicationPayload(validForm(), calculateLoan(validForm()));
  const response = await postLoanApplication('https://workflow.invalid/webhook/mock', payload, mockFetch);

  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://workflow.invalid/webhook/mock');
  assert.deepEqual(calls[0][1], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
});

test('mocked workflow responses preserve success:false and optional status behavior', async () => {
  const success = await readWorkflowResponse({
    ok: true,
    text: async () => JSON.stringify({ success: true, status: 'חדשה' }),
  });
  assert.deepEqual(success, { ok: true, message: '', status: 'חדשה' });

  const rejected = await readWorkflowResponse({
    ok: true,
    text: async () => JSON.stringify({ success: false, message: 'not recorded' }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.message, 'not recorded');

  const immediate = await readWorkflowResponse({ ok: true, text: async () => '' });
  assert.deepEqual(immediate, { ok: true, message: '', status: '' });

  const httpFailure = await readWorkflowResponse({ ok: false, text: async () => '{invalid' });
  assert.deepEqual(httpFailure, { ok: false, message: '', status: '' });
});
