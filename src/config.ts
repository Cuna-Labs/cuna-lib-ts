import { readFileSync, statSync } from "node:fs";
import { TextDecoder } from "node:util";

import { ConfigError } from "./errors.js";
import {
  brandedCredentialPrefixes,
  brandedEnvNames,
  type BrandedEnvName,
  type Covers,
} from "./internal/wire-namespaces.js";
import type {
  DiagnosticSink,
  RunaConfig,
  TraceSink,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.getcuna.com";
export const LEGACY_BASE_URL = "https://api.runacode.io";

interface ConfigFileShape {
  readonly api_key?: string;
  readonly base_url?: string;
}

/**
 * Compile-time proof that every declared spelling of a configuration variable
 * is still consulted.
 *
 * `brandedEnvNames` already cannot invent a name the brand list does not
 * contain. These aliases catch the opposite and more dangerous direction:
 * shrinking `WIRE_BRANDS` would quietly stop this file from reading a variable
 * a user has already exported, and a configuration variable that stops being
 * read does not fail — it falls through to a different endpoint or a different
 * credential in silence. Instantiating them fails to compile the moment a
 * spelling named here stops being derived.
 */
type ApiKeyEnvName = Covers<
  "CUNA_API_KEY" | "RUNA_API_KEY",
  BrandedEnvName<"API_KEY">
>;
type BaseUrlEnvName = Covers<
  "CUNA_BASE_URL" | "RUNA_BASE_URL",
  BrandedEnvName<"BASE_URL">
>;

interface SelectedEnvValue<Name extends string> {
  readonly name: Name;
  readonly value: string;
}

/**
 * States which spelling won when a user exported more than one.
 *
 * Preferring the canonical spelling is not a new rule invented here — it is the
 * rule `CUNA_API_KEY` has always followed, now derived from `WIRE_BRANDS`
 * rather than written out a second time. But a preference applied in silence is
 * how this defect class starts: the endpoint namespace was left un-widened for
 * months and nothing at runtime said so. `resolveConfig` has no diagnostic sink
 * available — `DiagnosticSink` is a closed union of per-operation events and
 * configuration is resolved before any operation exists — and turning a
 * configuration that resolves today into an error would narrow an accepting
 * surface, which is forbidden. Node's process warning is the one channel left
 * that reaches the operator without inventing public surface and without
 * breaking anybody. Values never appear in it: one of these variables is a
 * secret.
 */
function discloseShadowedEnv(chosen: string, shadowed: readonly string[]): void {
  const list = shadowed.join(" and ");
  const verb = shadowed.length === 1 ? "is" : "are";
  process.emitWarning(
    `${list} ${verb} set to a different value than ${chosen}. ` +
      `${chosen} takes precedence and ${list} ${verb} ignored. ` +
      `Unset ${list} to remove the ambiguity.`,
    "CunaConfigWarning",
  );
}

/**
 * Reads one setting from every brand spelling of its environment variable.
 *
 * Presence, not truthiness, selects: an exported but empty canonical variable
 * is selected and then fails validation, so a present higher-precedence value
 * never falls through to a legacy one. That is the existing documented
 * behaviour of the API key and it now governs the endpoint by construction.
 */
function selectBrandedEnv<Name extends string>(
  names: readonly Name[],
): SelectedEnvValue<Name> | undefined {
  let selected: SelectedEnvValue<Name> | undefined;
  const shadowed: Name[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (value === undefined) continue;
    if (selected === undefined) selected = { name, value };
    else if (value !== selected.value) shadowed.push(name);
  }
  if (selected !== undefined && shadowed.length > 0) {
    discloseShadowedEnv(selected.name, shadowed);
  }
  return selected;
}

export interface EffectiveConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly diagnostics?: DiagnosticSink;
  readonly tracing?: TraceSink;
  readonly apiKeySource: "constructor" | "environment" | "file";
  readonly baseUrlSource:
    | "constructor"
    | "environment"
    | "file"
    | "default";
}

function fail(): never {
  throw new ConfigError();
}

function readConfigFile(path: string): ConfigFileShape {
  if (path.length === 0) fail();
  try {
    if (!statSync(path).isFile()) fail();
    const bytes = readFileSync(path);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      fail();
    }
    const record = parsed as globalThis.Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.some((key) => key !== "api_key" && key !== "base_url")) {
      fail();
    }
    if ("api_key" in record && typeof record.api_key !== "string") fail();
    if ("base_url" in record && typeof record.base_url !== "string") fail();
    const result: ConfigFileShape = {};
    if (typeof record.api_key === "string") {
      Object.defineProperty(result, "api_key", {
        value: record.api_key,
        enumerable: true,
      });
    }
    if (typeof record.base_url === "string") {
      Object.defineProperty(result, "base_url", {
        value: record.base_url,
        enumerable: true,
      });
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    fail();
  }
}

/**
 * Every brand spelling of the secret-key opening this SDK authenticates with,
 * read from the brand authority rather than written out beside it.
 *
 * This predicate is an ACCEPTING surface for a credential that is already in a
 * customer's hands, so it may only ever widen. It nevertheless carried two
 * hand-written prefixes while the environment names a hundred lines above
 * already derived theirs from the same list — a namespace minted by the issuer
 * and compared here against a private copy of its spelling, in the one module
 * that had the authority imported and did not use it.
 *
 * The copy fails silently and in one direction. The authority is append-only,
 * so it grows and a literal does not: the day a further spelling is issued,
 * this predicate rejects a valid key, and it rejects it as `ConfigError` —
 * "configuration is invalid" — which sends the holder to look at everything
 * except the credential that is fine.
 */
const API_KEY_PREFIXES = brandedCredentialPrefixes("sk");

function validApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    API_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
  );
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string") fail();
  if (![DEFAULT_BASE_URL, `${DEFAULT_BASE_URL}/`, LEGACY_BASE_URL, `${LEGACY_BASE_URL}/`]
    .includes(value)) fail();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.length === 0 ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.origin !== DEFAULT_BASE_URL && parsed.origin !== LEGACY_BASE_URL)
  ) {
    fail();
  }
  return parsed.origin;
}

function validateDiagnostics(value: unknown): DiagnosticSink | undefined {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { emit?: unknown }).emit !== "function"
  ) {
    fail();
  }
  return value as DiagnosticSink;
}

function validateTracing(value: unknown): TraceSink | undefined {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { startSpan?: unknown }).startSpan !== "function"
  ) {
    fail();
  }
  return value as TraceSink;
}

export function resolveConfig(config: RunaConfig = {}): EffectiveConfig {
  if (
    config === null ||
    typeof config !== "object" ||
    Array.isArray(config)
  ) {
    fail();
  }
  const unsafe = config as RunaConfig &
    globalThis.Record<string, unknown>;
  let file: ConfigFileShape = Object.freeze({});
  if (unsafe.configFile !== undefined && unsafe.configFile !== null) {
    if (
      typeof unsafe.configFile !== "string" ||
      unsafe.configFile.length === 0
    ) {
      fail();
    }
    file = readConfigFile(unsafe.configFile);
  }

  let apiKey: unknown;
  let apiKeySource: EffectiveConfig["apiKeySource"];
  if (unsafe.apiKey !== undefined) {
    apiKey = unsafe.apiKey;
    apiKeySource = "constructor";
  } else {
    const fromEnv = selectBrandedEnv<ApiKeyEnvName>(
      brandedEnvNames("API_KEY"),
    );
    if (fromEnv !== undefined) {
      apiKey = fromEnv.value;
      apiKeySource = "environment";
    } else if (Object.hasOwn(file, "api_key")) {
      apiKey = file.api_key;
      apiKeySource = "file";
    } else {
      fail();
    }
  }
  if (!validApiKey(apiKey)) fail();

  let rawBaseUrl: unknown;
  let baseUrlSource: EffectiveConfig["baseUrlSource"];
  if (unsafe.baseUrl !== undefined) {
    rawBaseUrl = unsafe.baseUrl;
    baseUrlSource = "constructor";
  } else {
    const fromEnv = selectBrandedEnv<BaseUrlEnvName>(
      brandedEnvNames("BASE_URL"),
    );
    if (fromEnv !== undefined) {
      rawBaseUrl = fromEnv.value;
      baseUrlSource = "environment";
    } else if (Object.hasOwn(file, "base_url")) {
      rawBaseUrl = file.base_url;
      baseUrlSource = "file";
    } else {
      rawBaseUrl = DEFAULT_BASE_URL;
      baseUrlSource = "default";
    }
  }

  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  let selectedFetch: typeof globalThis.fetch | undefined;
  if (unsafe.fetch !== undefined) {
    if (typeof unsafe.fetch !== "function") fail();
    selectedFetch = unsafe.fetch;
  }
  const diagnostics = validateDiagnostics(unsafe.diagnostics);
  const tracing = validateTracing(unsafe.tracing);

  return Object.freeze({
    apiKey,
    baseUrl,
    ...(selectedFetch === undefined ? {} : { fetch: selectedFetch }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(tracing === undefined ? {} : { tracing }),
    apiKeySource,
    baseUrlSource,
  });
}
