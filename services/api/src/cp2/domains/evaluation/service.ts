import { performance } from "node:perf_hooks";
import { Cp2Error } from "../../cp2-error.js";
import { canonicalJson } from "../model-templates/manifest.js";
import type {
  EvaluationCaseRecord,
  JsonValue,
  JudgeEvaluator,
  ModelTemplateVersionRecord,
  TemplateExecutionResult,
  TemplateExecutor
} from "../model-templates/types.js";

export interface EvaluatedCase {
  caseId: string;
  passed: boolean;
  score: number;
  latencyMs: number;
  evaluatorType: EvaluationCaseRecord["matcher"]["type"];
  output: JsonValue;
  details: Record<string, JsonValue>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalContextTokens: number;
    peakMemoryBytes: number | null;
    estimatedCost: number | null;
  };
}

export interface EvaluationExecution {
  results: EvaluatedCase[];
  durationMs: number;
}

export class EvaluationService {
  constructor(private readonly judgeEvaluator?: JudgeEvaluator) {}

  async execute(input: {
    version: ModelTemplateVersionRecord;
    cases: EvaluationCaseRecord[];
    executor: TemplateExecutor;
  }): Promise<EvaluationExecution> {
    const startedAt = performance.now();
    const results: EvaluatedCase[] = [];
    for (const evaluationCase of input.cases) {
      const caseStartedAt = performance.now();
      try {
        const executed = await input.executor(input.version, evaluationCase.input, {
          context: evaluationCase.contextFixture,
          tools: evaluationCase.toolFixture
        });
        const assessed = await this.assess(evaluationCase, executed.output);
        results.push({
          caseId: evaluationCase.id,
          ...assessed,
          latencyMs: Math.max(0, performance.now() - caseStartedAt),
          evaluatorType: evaluationCase.matcher.type,
          output: executed.output,
          usage: usageFromExecution(executed, input.version.promptTokenEstimate)
        });
      } catch (error) {
        if (error instanceof Cp2Error && error.code === "JUDGE_EVALUATOR_UNAVAILABLE") {
          throw error;
        }
        results.push({
          caseId: evaluationCase.id,
          passed: false,
          score: 0,
          latencyMs: Math.max(0, performance.now() - caseStartedAt),
          evaluatorType: evaluationCase.matcher.type,
          output: null,
          details: {
            errorCode: error instanceof Cp2Error ? error.code : "TEMPLATE_EXECUTION_FAILED"
          },
          usage: usageFromExecution({}, input.version.promptTokenEstimate)
        });
      }
    }
    return { results, durationMs: Math.max(0, performance.now() - startedAt) };
  }

  private async assess(
    evaluationCase: EvaluationCaseRecord,
    output: JsonValue
  ): Promise<Pick<EvaluatedCase, "passed" | "score" | "details">> {
    const matcher = evaluationCase.matcher;
    if (matcher.type === "EXACT") {
      const passed = canonicalJson(output) === canonicalJson(matcher.expected);
      return { passed, score: passed ? 1 : 0, details: {} };
    }
    if (matcher.type === "CONTAINS") {
      const passed = containsJson(output, matcher.expected);
      return { passed, score: passed ? 1 : 0, details: {} };
    }
    if (matcher.type === "SCHEMA") {
      const errors = validateJsonSchema(output, matcher.schema);
      return {
        passed: errors.length === 0,
        score: errors.length === 0 ? 1 : 0,
        details: { validationErrors: errors }
      };
    }
    if (matcher.type === "CONSTRAINTS") {
      const missing = matcher.requiredPaths.filter((path) => readPath(output, path) === undefined);
      const prohibited = matcher.prohibitedPaths.filter(
        (path) => readPath(output, path) !== undefined
      );
      const outsideTolerance = matcher.numericTolerances.filter((item) => {
        const value = readPath(output, item.path);
        return typeof value !== "number" || Math.abs(value - item.expected) > item.tolerance;
      });
      const passed =
        missing.length === 0 && prohibited.length === 0 && outsideTolerance.length === 0;
      return {
        passed,
        score: passed ? 1 : 0,
        details: {
          missingPaths: missing,
          prohibitedPaths: prohibited,
          outsideTolerancePaths: outsideTolerance.map((item) => item.path)
        }
      };
    }
    if (matcher.type === "TOOL_CALL") {
      const tool = readPath(output, "tool");
      const args = readPath(output, "arguments");
      const passed =
        tool === matcher.tool && canonicalJson(args) === canonicalJson(matcher.arguments);
      return { passed, score: passed ? 1 : 0, details: {} };
    }
    if (this.judgeEvaluator === undefined) {
      throw new Cp2Error(
        422,
        "JUDGE_EVALUATOR_UNAVAILABLE",
        "This evaluation suite requires a configured judge evaluator."
      );
    }
    const judged = await this.judgeEvaluator({
      rubric: matcher.rubric,
      minimumScore: matcher.minimumScore,
      caseInput: evaluationCase.input,
      output
    });
    return {
      passed: judged.passed && judged.score >= matcher.minimumScore,
      score: judged.score,
      details: { reason: judged.reason }
    };
  }
}

function usageFromExecution(
  execution: Partial<TemplateExecutionResult>,
  defaultPromptTokens: number
): EvaluatedCase["usage"] {
  return {
    promptTokens: execution.promptTokens ?? defaultPromptTokens,
    completionTokens: execution.completionTokens ?? 0,
    totalContextTokens:
      execution.totalContextTokens ?? execution.promptTokens ?? defaultPromptTokens,
    peakMemoryBytes: execution.peakMemoryBytes ?? null,
    estimatedCost: execution.estimatedCost ?? null
  };
}

function containsJson(actual: JsonValue, expected: JsonValue): boolean {
  if (expected === null || typeof expected !== "object") return actual === expected;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.every((expectedItem) => actual.some((item) => containsJson(item, expectedItem)))
    );
  }
  if (actual === null || Array.isArray(actual) || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) =>
    Object.hasOwn(actual, key) ? containsJson(actual[key]!, value) : false
  );
}

function readPath(value: JsonValue, path: string): JsonValue | undefined {
  if (path.trim().length === 0) return value;
  let current: JsonValue | undefined = value;
  for (const segment of path.split(".")) {
    if (
      current === null ||
      Array.isArray(current) ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function validateJsonSchema(value: JsonValue, schema: Record<string, JsonValue>): string[] {
  const errors: string[] = [];
  validateSchemaNode(value, schema, "$", errors);
  return errors;
}

function validateSchemaNode(
  value: JsonValue,
  schema: Record<string, JsonValue>,
  path: string,
  errors: string[]
): void {
  const expectedType = schema.type;
  if (typeof expectedType === "string" && !matchesType(value, expectedType)) {
    errors.push(`${path} must be ${expectedType}.`);
    return;
  }
  if (
    Array.isArray(schema.required) &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value === "object"
  ) {
    for (const required of schema.required) {
      if (typeof required === "string" && !Object.hasOwn(value, required)) {
        errors.push(`${path}.${required} is required.`);
      }
    }
  }
  const properties = schema.properties;
  if (
    properties !== null &&
    !Array.isArray(properties) &&
    typeof properties === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value === "object"
  ) {
    for (const [key, childSchema] of Object.entries(properties)) {
      if (
        Object.hasOwn(value, key) &&
        childSchema !== null &&
        !Array.isArray(childSchema) &&
        typeof childSchema === "object"
      ) {
        validateSchemaNode(value[key]!, childSchema, `${path}.${key}`, errors);
      }
    }
  }
}

function matchesType(value: JsonValue, expectedType: string): boolean {
  if (expectedType === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "integer") return typeof value === "number" && Number.isInteger(value);
  if (expectedType === "number") return typeof value === "number";
  if (expectedType === "string") return typeof value === "string";
  if (expectedType === "boolean") return typeof value === "boolean";
  if (expectedType === "null") return value === null;
  return false;
}

export const createEvaluationService = (judgeEvaluator?: JudgeEvaluator) =>
  new EvaluationService(judgeEvaluator);
