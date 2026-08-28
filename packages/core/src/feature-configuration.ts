export interface FeatureConfigurationIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
}

export type FeatureConfigurationParseResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      issues: readonly FeatureConfigurationIssue[];
    }>;

declare const configurationTypeBrand: unique symbol;
export interface FeatureConfigurationProvider<T> {
  readonly [configurationTypeBrand]: T;
}

export interface DefineFeatureConfigurationOptions<T> {
  readonly defaultValue: () => unknown;
  readonly parse: (input: unknown) => FeatureConfigurationParseResult<T>;
}

interface ConfigurationDefinition<T> {
  readonly defaultValue: () => unknown;
  readonly parse: (input: unknown) => FeatureConfigurationParseResult<T>;
}

const configurationDefinitions = new WeakMap<
  object,
  ConfigurationDefinition<unknown>
>();

export function defineFeatureConfiguration<T>(
  options: DefineFeatureConfigurationOptions<T>,
): FeatureConfigurationProvider<T> {
  if (
    typeof options !== "object" ||
    options === null ||
    Object.keys(options).sort().join("|") !== "defaultValue|parse" ||
    typeof options.defaultValue !== "function" ||
    typeof options.parse !== "function"
  ) {
    throw new TypeError("Feature configuration options are invalid");
  }
  const provider = Object.freeze(
    Object.create(null),
  ) as FeatureConfigurationProvider<T>;
  configurationDefinitions.set(provider, {
    defaultValue: options.defaultValue,
    parse: options.parse as (
      input: unknown,
    ) => FeatureConfigurationParseResult<unknown>,
  });
  return provider;
}

function objectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function safeValue(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function boundedText(value: string, limit: number): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0xfffd;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : character;
    })
    .join("")
    .slice(0, limit);
}

export function freezeFeatureConfigurationIssues(
  issues: readonly FeatureConfigurationIssue[],
): readonly FeatureConfigurationIssue[] {
  return Object.freeze(
    issues.slice(0, 16).map((issue) =>
      Object.freeze({
        path: Object.freeze([...issue.path].slice(0, 16)),
        code: boundedText(issue.code, 64),
      }),
    ),
  );
}

function cloneConfiguration(value: unknown, seen = new Set<object>()): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Configuration numbers must be finite");
    return value;
  }
  if (!objectLike(value) || typeof value === "function") {
    throw new TypeError("Configuration values must be immutable data");
  }
  if (seen.has(value))
    throw new TypeError("Configuration values cannot be cyclic");
  seen.add(value);
  if (Array.isArray(value)) {
    const output = Object.freeze(
      value.map((entry) => cloneConfiguration(entry, seen)),
    );
    seen.delete(value);
    return output;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Configuration objects must be plain objects");
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    output[key] = cloneConfiguration(safeValue(value, key), seen);
  }
  seen.delete(value);
  return Object.freeze(output);
}

export function hasFeatureConfigurationDefinition(provider: object): boolean {
  return configurationDefinitions.has(provider);
}

export function parseFeatureConfigurationProvider(
  provider: object,
  present: boolean,
  input: unknown,
): FeatureConfigurationParseResult<unknown> {
  const definition = configurationDefinitions.get(provider);
  if (definition === undefined) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([
        Object.freeze({ path: Object.freeze([]), code: "invalid-provider" }),
      ]),
    });
  }
  try {
    const source = present ? input : definition.defaultValue();
    if (objectLike(source) && typeof safeValue(source, "then") === "function") {
      return Object.freeze({
        ok: false,
        issues: Object.freeze([
          Object.freeze({ path: Object.freeze([]), code: "async-default" }),
        ]),
      });
    }
    const result = definition.parse(source);
    if (objectLike(result) && typeof safeValue(result, "then") === "function") {
      return Object.freeze({
        ok: false,
        issues: Object.freeze([
          Object.freeze({ path: Object.freeze([]), code: "async-parser" }),
        ]),
      });
    }
    if (!objectLike(result) || typeof safeValue(result, "ok") !== "boolean") {
      throw new TypeError("Configuration parser returned an invalid result");
    }
    if (safeValue(result, "ok") === true) {
      return Object.freeze({
        ok: true,
        value: cloneConfiguration(safeValue(result, "value")),
      });
    }
    const rawIssues = safeValue(result, "issues");
    if (!Array.isArray(rawIssues) || rawIssues.length === 0) {
      throw new TypeError("Configuration parser returned no issues");
    }
    const issues: FeatureConfigurationIssue[] = [];
    for (const raw of rawIssues.slice(0, 16)) {
      if (!objectLike(raw)) continue;
      const path = safeValue(raw, "path");
      const code = safeValue(raw, "code");
      if (
        Array.isArray(path) &&
        path.every(
          (part) => typeof part === "string" || Number.isSafeInteger(part),
        ) &&
        typeof code === "string" &&
        code.length > 0
      ) {
        issues.push({ path, code });
      }
    }
    if (issues.length === 0)
      throw new TypeError("Configuration issues are invalid");
    return Object.freeze({
      ok: false,
      issues: freezeFeatureConfigurationIssues(issues),
    });
  } catch {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([
        Object.freeze({ path: Object.freeze([]), code: "parser-failed" }),
      ]),
    });
  }
}
