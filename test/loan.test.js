/**
 * Tests for the loan logic. Run with: npm test
 *
 * No test framework is installed - this uses `node --test`, which is built
 * into Node itself. There are zero dependencies in this project.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pmt,
  calculateLoan,
  validateApplication,
  buildLoanApplicationPayload,
  COMMISSION_RATE,
  COMMISSION_FIXED,
  VAT_RATE,
} from '../assets/js/loan.js';

/** Asserts two floats are equal to within a tiny tolerance. */
function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

/** A complete, valid form. Individual tests override what they care about. */
function validForm(overrides = {}) {
  return {
    amount: 50000,
    termMonths: 60,
    annualInterestRatePercent: 8,
    balloonAmount: 20000,
    agentFullName: 'ישראל ישראלי',
    agentAgencyName: 'סוכנות רכב בעמ',
    agentPhone: '050-1234567',
    applicantFirstName: 'דניאל',
    applicantLastName: 'כהן',
    applicantPhone: '0521234567',
    ...overrides,
  };
}

/* ================================================================== *
 * The reference case, straight out of the spreadsheet.
 *
 * "סימולטור הלוואת רכב.xlsx" with E7=50000, E8=60, E9=0.08, E10=20000
 * holds these computed values:
 *   E13 (monthly payment)  741.62516198574281
 *   E16 (commission)       1130
 *   E17 (VAT)              203.4
 *   E18 (total incl. VAT)  1333.4
 * ================================================================== */

test('matches the Excel reference case exactly', () => {
  const result = calculateLoan({
    amount: 50000,
    termMonths: 60,
    annualInterestRatePercent: 8,
    balloonAmount: 20000,
  });

  closeTo(result.monthlyPayment, 741.62516198574281);
  closeTo(result.commission, 1130);
  closeTo(result.vat, 203.4);
  closeTo(result.totalCommissionIncludingVat, 1333.4);
  closeTo(result.annualRate, 0.08);
});

/* ================================================================== *
 * Monthly payment
 * ================================================================== */

test('with no balloon it matches the standard annuity formula', () => {
  const amount = 120000;
  const termMonths = 48;
  const annualInterestRatePercent = 6.5;

  const { monthlyPayment } = calculateLoan({
    amount,
    termMonths,
    annualInterestRatePercent,
    balloonAmount: 0,
  });

  // Derived independently, in a different algebraic form than pmt() uses.
  const r = annualInterestRatePercent / 100 / 12;
  const expected = (amount * r) / (1 - Math.pow(1 + r, -termMonths));

  closeTo(monthlyPayment, expected);
});

test('at 0% interest the balance is simply split across the months', () => {
  const { monthlyPayment } = calculateLoan({
    amount: 60000,
    termMonths: 24,
    annualInterestRatePercent: 0,
    balloonAmount: 12000,
  });

  // (60000 - 12000) / 24
  closeTo(monthlyPayment, 2000);
});

test('a bigger balloon lowers the monthly payment', () => {
  const base = { amount: 80000, termMonths: 36, annualInterestRatePercent: 7 };

  const noBalloon = calculateLoan({ ...base, balloonAmount: 0 }).monthlyPayment;
  const withBalloon = calculateLoan({ ...base, balloonAmount: 30000 }).monthlyPayment;

  assert.ok(withBalloon < noBalloon, 'balloon should reduce the monthly payment');
});

test('a higher rate raises the monthly payment', () => {
  const base = { amount: 80000, termMonths: 36, balloonAmount: 0 };

  const low = calculateLoan({ ...base, annualInterestRatePercent: 4 }).monthlyPayment;
  const high = calculateLoan({ ...base, annualInterestRatePercent: 9 }).monthlyPayment;

  assert.ok(high > low, 'a higher rate should cost more per month');
});

test('a longer term lowers the monthly payment', () => {
  const base = { amount: 80000, annualInterestRatePercent: 7, balloonAmount: 0 };

  const short = calculateLoan({ ...base, termMonths: 24 }).monthlyPayment;
  const long = calculateLoan({ ...base, termMonths: 72 }).monthlyPayment;

  assert.ok(long < short, 'spreading payments out should lower each one');
});

test('handles a very small and a very large loan', () => {
  const small = calculateLoan({
    amount: 1000,
    termMonths: 12,
    annualInterestRatePercent: 8,
    balloonAmount: 0,
  });
  const large = calculateLoan({
    amount: 2000000,
    termMonths: 120,
    annualInterestRatePercent: 8,
    balloonAmount: 0,
  });

  assert.ok(small.monthlyPayment > 0 && Number.isFinite(small.monthlyPayment));
  assert.ok(large.monthlyPayment > 0 && Number.isFinite(large.monthlyPayment));
});

test('a zero-month term does not blow up', () => {
  const { monthlyPayment } = calculateLoan({
    amount: 50000,
    termMonths: 0,
    annualInterestRatePercent: 8,
    balloonAmount: 0,
  });

  assert.equal(monthlyPayment, 0);
});

test('pmt returns the balance split evenly when the rate is zero', () => {
  closeTo(pmt(0, 10, -1000), 100);
});

/* ================================================================== *
 * Commission, VAT, total
 * ================================================================== */

test('commission is 1.5% of the loan plus the fixed fee', () => {
  const { commission } = calculateLoan({
    amount: 200000,
    termMonths: 60,
    annualInterestRatePercent: 8,
    balloonAmount: 0,
  });

  closeTo(commission, 200000 * COMMISSION_RATE + COMMISSION_FIXED); // 3380
  closeTo(commission, 3380);
});

test('commission does not depend on term, rate or balloon', () => {
  const a = calculateLoan({
    amount: 90000,
    termMonths: 12,
    annualInterestRatePercent: 3,
    balloonAmount: 0,
  });
  const b = calculateLoan({
    amount: 90000,
    termMonths: 96,
    annualInterestRatePercent: 15,
    balloonAmount: 40000,
  });

  closeTo(a.commission, b.commission);
  closeTo(a.vat, b.vat);
});

test('VAT is 18% of the commission and the total is their sum', () => {
  const { commission, vat, totalCommissionIncludingVat } = calculateLoan({
    amount: 75000,
    termMonths: 48,
    annualInterestRatePercent: 5,
    balloonAmount: 0,
  });

  closeTo(vat, commission * VAT_RATE);
  closeTo(totalCommissionIncludingVat, commission + vat);
});

/* ================================================================== *
 * Validation
 * ================================================================== */

test('a fully filled form passes', () => {
  assert.deepEqual(validateApplication(validForm()), {});
});

test('an empty balloon (0) is allowed', () => {
  assert.deepEqual(validateApplication(validForm({ balloonAmount: 0 })), {});
});

test('a 0% rate is allowed', () => {
  assert.deepEqual(validateApplication(validForm({ annualInterestRatePercent: 0 })), {});
});

test('rejects a missing or non-positive loan amount', () => {
  for (const amount of [NaN, 0, -5000]) {
    const errors = validateApplication(validForm({ amount }));
    assert.ok(errors.amount, `amount ${amount} should be rejected`);
  }
});

test('rejects a fractional or non-positive term', () => {
  for (const termMonths of [NaN, 0, -12, 24.5]) {
    const errors = validateApplication(validForm({ termMonths }));
    assert.ok(errors.termMonths, `term ${termMonths} should be rejected`);
  }
});

test('rejects a negative rate but not zero', () => {
  assert.ok(validateApplication(validForm({ annualInterestRatePercent: -1 })).annualInterestRatePercent);
  assert.ok(validateApplication(validForm({ annualInterestRatePercent: NaN })).annualInterestRatePercent);
  assert.ok(!validateApplication(validForm({ annualInterestRatePercent: 0 })).annualInterestRatePercent);
});

test('rejects a balloon that is not smaller than the loan amount', () => {
  assert.ok(validateApplication(validForm({ amount: 50000, balloonAmount: 50000 })).balloonAmount);
  assert.ok(validateApplication(validForm({ amount: 50000, balloonAmount: 60000 })).balloonAmount);
  assert.ok(validateApplication(validForm({ amount: 50000, balloonAmount: -1 })).balloonAmount);
  assert.ok(!validateApplication(validForm({ amount: 50000, balloonAmount: 49999 })).balloonAmount);
});

test('rejects blank text fields, including whitespace only', () => {
  const errors = validateApplication(
    validForm({
      agentFullName: '',
      agentAgencyName: '   ',
      applicantFirstName: '',
      applicantLastName: ' ',
    })
  );

  assert.ok(errors.agentFullName);
  assert.ok(errors.agentAgencyName);
  assert.ok(errors.applicantFirstName);
  assert.ok(errors.applicantLastName);
});

test('accepts real phone formats and rejects bad ones', () => {
  for (const phone of ['0501234567', '050-123-4567', '03 1234567', '021234567']) {
    assert.ok(!validateApplication(validForm({ agentPhone: phone })).agentPhone, `${phone} should pass`);
  }
  for (const phone of ['', '12345', '05012345678901']) {
    assert.ok(validateApplication(validForm({ agentPhone: phone })).agentPhone, `${phone} should fail`);
  }
});

test('reports every problem at once, not just the first', () => {
  const errors = validateApplication(
    validForm({ amount: NaN, termMonths: NaN, agentFullName: '', applicantPhone: 'x' })
  );

  assert.equal(Object.keys(errors).length, 4);
});

/* ================================================================== *
 * Webhook payload
 * ================================================================== */

test('builds the payload with the agreed shape', () => {
  const values = validForm();
  const payload = buildLoanApplicationPayload(values, calculateLoan(values));

  assert.deepEqual(payload, {
    agent: {
      fullName: 'ישראל ישראלי',
      agencyName: 'סוכנות רכב בעמ',
      phone: '050-1234567',
    },
    applicant: {
      firstName: 'דניאל',
      lastName: 'כהן',
      phone: '0521234567',
    },
    loan: {
      amount: 50000,
      termMonths: 60,
      balloonAmount: 20000,
      annualInterestRate: 0.08,
      monthlyPayment: 741.63,
      commission: 1130,
      vat: 203.4,
      totalCommissionIncludingVat: 1333.4,
    },
  });
});

test('every money field is a number, never a formatted string', () => {
  const values = validForm();
  const { loan } = buildLoanApplicationPayload(values, calculateLoan(values));

  for (const [key, value] of Object.entries(loan)) {
    assert.equal(typeof value, 'number', `loan.${key} should be a number`);
    assert.ok(Number.isFinite(value), `loan.${key} should be finite`);
  }
});

test('trims whitespace out of the text fields', () => {
  const values = validForm({
    agentFullName: '  ישראל ישראלי  ',
    applicantFirstName: ' דניאל ',
    applicantPhone: ' 0521234567 ',
  });

  const payload = buildLoanApplicationPayload(values, calculateLoan(values));

  assert.equal(payload.agent.fullName, 'ישראל ישראלי');
  assert.equal(payload.applicant.firstName, 'דניאל');
  assert.equal(payload.applicant.phone, '0521234567');
});

test('the payload survives a JSON round trip unchanged', () => {
  const values = validForm();
  const payload = buildLoanApplicationPayload(values, calculateLoan(values));

  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
});
