import type { EventRiskLevel } from "@soko/event-core";

export interface ToolDefinition<TInput extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  risk: EventRiskLevel;
  requiresConfirmation: boolean;
  validate(input: TInput): ValidationResult;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function valid(): ValidationResult {
  return { ok: true, errors: [] };
}

export function invalid(...errors: string[]): ValidationResult {
  return { ok: false, errors };
}
