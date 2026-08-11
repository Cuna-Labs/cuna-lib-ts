import type { WorkspaceSyncProblem } from "./workspace-sync.js";

/**
 * Base class for normalized public Cuna SDK errors.
 * @cuna-contract cunaerror-summary PRD-024#R-024-01
 */
export abstract class CunaError extends Error {
  /** Stable public error class name. */
  abstract override readonly name:
    | "ConfigError"
    | "ApiError"
    | "CommandError";
  /** Stable normalized public error code. */
  abstract readonly code:
    | "config_error"
    | "api_error"
    | "malformed_response"
    | "command_error";
}

export type ProblemAction =
  | "retry"
  | "sign_in"
  | "open_web"
  | "contact_support"
  | "none";

/** Closed, safe Problem metadata returned by current Cuna API operations. */
export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly detail?: string;
  readonly action?: ProblemAction;
}

export type ApiProblem = Problem | WorkspaceSyncProblem;

const API_PROBLEMS = new WeakMap<ApiError, ApiProblem>();

/**
 * Safe public error raised when selected client configuration is invalid.
 * @cuna-contract configerror-summary PRD-024#R-024-01
 */
export class ConfigError extends CunaError {
  /** Stable public error class name. */
  override readonly name = "ConfigError";
  /** Stable normalized configuration error code. */
  readonly code = "config_error";
  /** Fixed safe English public error message. */
  override readonly message = "Cuna SDK configuration is invalid.";

  /**
   * Constructs a safe configuration error.
   * @returns A safe configuration error instance.
   * @cuna-contract configerror-constructor-description PRD-024#R-024-01
   * @cuna-contract configerror-constructor-returns PRD-024#R-024-01
   */
  constructor() {
    super("Cuna SDK configuration is invalid.");
    Object.setPrototypeOf(this, new.target.prototype);
    this.stack = `${this.name}: ${this.message}`;
  }
}

/**
 * Safe public error for an API failure or malformed successful response.
 * @cuna-contract apierror-summary PRD-024#R-024-01
 */
export class ApiError extends CunaError {
  /** Stable public error class name. */
  override readonly name = "ApiError";
  /** Stable normalized API or malformed-response code. */
  readonly code: "api_error" | "malformed_response";
  /** HTTP status associated with the API outcome. */
  readonly status: number;
  /** Fixed safe English public error message. */
  override readonly message:
    | "The Cuna API request failed."
    | "The Cuna API returned an invalid response.";
  /** Validated Problem metadata when the operation uses the Problem error model. */
  get problem(): ApiProblem | undefined {
    return API_PROBLEMS.get(this);
  }

  /**
   * Constructs a safe API error.
   * @param status HTTP status associated with the API outcome.
   * @param code Normalized API failure or malformed-response code.
   * @returns A safe API error instance.
   * @cuna-contract apierror-constructor-description PRD-024#R-024-01
   * @cuna-contract apierror-constructor-param-status PRD-024#R-024-03
   * @cuna-contract apierror-constructor-param-code PRD-024#R-024-03
   * @cuna-contract apierror-constructor-returns PRD-024#R-024-01
   */
  constructor(
    status: number,
    code: "api_error" | "malformed_response" = "api_error",
  ) {
    const message =
      code === "malformed_response"
        ? "The Cuna API returned an invalid response."
        : "The Cuna API request failed.";
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.status = Number.isInteger(status) ? status : 0;
    this.code = code;
    this.message = message;
    this.stack = `${this.name}: ${this.message}`;
  }
}

/** @internal Constructs an API error with already validated Problem metadata. */
export function apiErrorWithProblem(status: number, problem: ApiProblem): ApiError {
  const error = new ApiError(status);
  API_PROBLEMS.set(error, problem);
  return error;
}

/**
 * Reserved non-constructible public command-error type.
 * @cuna-contract commanderror-summary PRD-024#R-024-01
 */
export class CommandError extends CunaError {
  /** Stable public error class name. */
  override readonly name = "CommandError";
  /** Stable normalized command error code. */
  readonly code = "command_error";
  /** Fixed safe English public error message. */
  override readonly message = "The session command failed.";

  private constructor() {
    super("The session command failed.");
    Object.setPrototypeOf(this, new.target.prototype);
    throw new TypeError("CommandError cannot be constructed directly.");
  }
}
