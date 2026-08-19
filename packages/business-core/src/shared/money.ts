export function isValidQuantity(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function isPositiveQuantity(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function isValidMoney(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function isPositiveMoney(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function isValidTaxRate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
