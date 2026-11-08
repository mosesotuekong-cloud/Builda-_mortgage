import { calculateImpact } from './impact';

// Business case (Phase 4). Four kinds of value, kept apart on purpose:
//   time recovered  — staff hours that may become available (capacity, not cash)
//   cash savings    — only expenditure the firm itself says it can reduce
//   capacity        — extra cases the recovered time could handle, using the firm's own hours per case
//   revenue         — only when the firm confirms demand exists and supplies revenue per case
// Every input carries its source; unknown inputs stay unknown and are listed; nothing is estimated.
export type InputSource = 'employee_reported' | 'firm_provided' | 'measured' | 'assumption';
export interface CaseInput { value: number | null; source: InputSource | null; note?: string }
export type BusinessCaseInputKey = 'monthlyVolume' | 'minutesPerOccurrence' | 'reductionPct' | 'loadedHourlyCostGBP'
  | 'implementationCostGBP' | 'monthlyCashSavingGBP' | 'staffHoursPerCase' | 'revenuePerCaseGBP';
export type BusinessCaseInputs = Record<BusinessCaseInputKey, CaseInput> & { demandConfirmed: boolean };
export interface BusinessCase {
  timeRecovered: { monthlyHoursSpent: number | null; monthlyHoursRecovered: number | null; valueAtStatedCostGBP: number | null; method: string };
  cashSavings: { monthlyGBP: number | null; basis: string | null; method: string };
  capacity: { additionalCasesPerMonth: number | null; method: string };
  revenue: { monthlyPotentialGBP: number | null; method: string };
  payback: { months: number | null; reason: string };
  inputs: Record<BusinessCaseInputKey, CaseInput & { label: string }>;
  demandConfirmed: boolean;
  missing: string[];
  complete: boolean;
}

export const BUSINESS_CASE_LABELS: Record<BusinessCaseInputKey, string> = {
  monthlyVolume: 'How often it happens (per month)', minutesPerOccurrence: 'Minutes of staff time each time', reductionPct: 'Share of that time that could be removed',
  loadedHourlyCostGBP: 'Hourly staff cost', implementationCostGBP: 'Implementation cost', monthlyCashSavingGBP: 'Spending the firm can actually reduce (per month)',
  staffHoursPerCase: 'Staff hours one additional case needs', revenuePerCaseGBP: 'Revenue per additional case',
};

const gbp = (n: number) => `£${n.toLocaleString('en-GB')}`;

export function businessCase(i: BusinessCaseInputs): BusinessCase {
  const v = (k: BusinessCaseInputKey) => i[k].value;
  const time = calculateImpact({ monthlyVolume: v('monthlyVolume'), minutesPerOccurrence: v('minutesPerOccurrence'), reductionPct: v('reductionPct'),
    loadedHourlyCostGBP: v('loadedHourlyCostGBP'), implementationCostGBP: null });
  const missing: string[] = [];
  for (const k of ['monthlyVolume', 'minutesPerOccurrence', 'reductionPct'] as const) if (v(k) === null) missing.push(BUSINESS_CASE_LABELS[k]);

  const cash = v('monthlyCashSavingGBP');
  const hrsPerCase = v('staffHoursPerCase');
  const additionalCases = time.monthlyHoursRecovered !== null && hrsPerCase !== null && hrsPerCase > 0
    ? Math.floor((time.monthlyHoursRecovered / hrsPerCase) * 10) / 10 : null;
  const perCase = v('revenuePerCaseGBP');
  const revenue = additionalCases !== null && perCase !== null && i.demandConfirmed ? Math.round(additionalCases * perCase) : null;
  if (cash === null && revenue === null) {
    missing.push('A financial return: either spending the firm can reduce, or hours per case, revenue per case and confirmed demand for more cases');
  }
  const cost = v('implementationCostGBP');
  if (cost === null) missing.push(BUSINESS_CASE_LABELS.implementationCostGBP);

  let payback: BusinessCase['payback'];
  if (cost === null) payback = { months: null, reason: 'Not calculated: implementation cost is not yet known.' };
  else if (cash === null || cash <= 0) payback = { months: null, reason: 'Not calculated: no spending that the firm can reduce has been identified. Recovered time is capacity, not cash.' };
  else payback = { months: Math.round((cost / cash) * 10) / 10, reason: `${gbp(cost)} implementation cost ÷ ${gbp(cash)} a month of cash savings.` };

  return {
    timeRecovered: {
      monthlyHoursSpent: time.monthlyHoursSpent, monthlyHoursRecovered: time.monthlyHoursRecovered, valueAtStatedCostGBP: time.monthlyCapacityValueGBP,
      method: 'Times a month × minutes each time ÷ 60 = hours spent; × share that could be removed = hours recovered. Valued at the firm’s stated hourly cost only to show scale: it is not a saving.',
    },
    cashSavings: {
      monthlyGBP: cash, basis: i.monthlyCashSavingGBP.note ?? null,
      method: cash === null ? 'None identified. Only spending the firm says it will actually reduce (for example overtime, temporary staff or a planned hire) counts.' : 'Stated by the firm.',
    },
    capacity: {
      additionalCasesPerMonth: additionalCases,
      method: additionalCases === null ? 'Needs hours recovered and the firm’s own staff hours per case.' : 'Hours recovered ÷ staff hours per case, rounded down.',
    },
    revenue: {
      monthlyPotentialGBP: revenue,
      method: revenue !== null ? 'Additional cases × revenue per case. Potential only: it assumes demand exists and the recovered time is used for new cases.'
        : !i.demandConfirmed ? 'Not calculated: the firm hasn’t confirmed there is demand for more cases. Capacity does not become revenue on its own.'
          : 'Needs additional cases and revenue per case.',
    },
    payback,
    inputs: Object.fromEntries((Object.keys(BUSINESS_CASE_LABELS) as BusinessCaseInputKey[]).map((k) => [k, { ...i[k], label: BUSINESS_CASE_LABELS[k] }])) as BusinessCase['inputs'],
    demandConfirmed: i.demandConfirmed,
    missing: [...new Set(missing)],
    complete: time.monthlyHoursRecovered !== null && cost !== null && (cash !== null || revenue !== null),
  };
}
