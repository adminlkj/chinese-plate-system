// Decimal Utility — Safe conversion from Prisma Decimal to JavaScript number
// Prisma returns Decimal objects for Decimal fields, but our business logic uses number
// This module provides consistent, safe conversion helpers

import { Prisma } from '@prisma/client';

/**
 * Convert a Prisma Decimal value (or null/undefined) to a JavaScript number.
 * Returns 0 for null/undefined inputs (safe default for financial calculations).
 */
export function toNumber(val: Prisma.Decimal | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

/**
 * Convert a Prisma Decimal value to number, returning null for null inputs.
 * Use this when 0 is not a safe default (e.g., optional amounts).
 */
export function toNumberOrNull(val: Prisma.Decimal | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  return Number(val);
}

/**
 * Round a number to 2 decimal places (standard for financial calculations).
 * Uses the "round half away from zero" method.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Round a number to 4 decimal places (for unit prices and percentages).
 */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
