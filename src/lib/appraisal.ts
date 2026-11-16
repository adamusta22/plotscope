import type { Appraisal } from './store';

export const DEFAULT_APPRAISAL: Appraisal = {
  units: 10, avgSize: 90, salePsf: 400, buildPsm: 2000, externalPct: 12, feesPct: 10, contingencyPct: 5,
  financePct: 8, profitPct: 20, affordablePct: 0, affordableDiscountPct: 45, s106PerUnit: 15000, buildMonths: 18,
};

/** Non-residential / mixed SDLT bands (England). */
export function sdlt(price: number) {
  let t = 0;
  if (price > 150000) t += (Math.min(price, 250000) - 150000) * 0.02;
  if (price > 250000) t += (price - 250000) * 0.05;
  return t;
}

export interface AppraisalResult {
  giaSqm: number; nsaSqft: number; gdv: number; build: number; external: number; fees: number; contingency: number;
  s106: number; finance: number; disposal: number; profit: number; residual: number; rlv: number; sdlt: number; acqFees: number;
  totalCost: number; profitOnCost: number;
}

export function runAppraisal(a: Appraisal): AppraisalResult {
  const giaSqm = a.units * a.avgSize;
  const nsaSqft = giaSqm * 10.7639;
  const aff = Math.min(Math.max(a.affordablePct, 0), 100) / 100;
  const gdv = nsaSqft * a.salePsf * (1 - aff) + nsaSqft * a.salePsf * aff * (1 - a.affordableDiscountPct / 100);
  const build = giaSqm * a.buildPsm;
  const external = build * (a.externalPct / 100);
  const fees = (build + external) * (a.feesPct / 100);
  const contingency = (build + external) * (a.contingencyPct / 100);
  const s106 = a.units * a.s106PerUnit;
  // average 50% drawdown over the build period, plus a 6-month sales tail
  const finance = (build + external + fees + contingency) * (a.financePct / 100) * ((a.buildMonths + 6) / 12) * 0.5;
  const disposal = gdv * 0.025;
  const profit = gdv * (a.profitPct / 100);
  const residual = gdv - build - external - fees - contingency - s106 - finance - disposal - profit;

  // Solve land value net of SDLT + 1.75% acquisition fees
  let rlv = residual;
  for (let i = 0; i < 30; i++) rlv = residual - sdlt(Math.max(rlv, 0)) - Math.max(rlv, 0) * 0.0175;
  rlv = Math.max(Math.min(rlv, residual), residual < 0 ? residual : 0);
  const sd = sdlt(Math.max(rlv, 0));
  const acqFees = Math.max(rlv, 0) * 0.0175;
  const totalCost = build + external + fees + contingency + s106 + finance + disposal + Math.max(rlv, 0) + sd + acqFees;
  return { giaSqm, nsaSqft, gdv, build, external, fees, contingency, s106, finance, disposal, profit, residual, rlv, sdlt: sd, acqFees, totalCost, profitOnCost: profit / totalCost };
}
