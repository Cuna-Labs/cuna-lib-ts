# Shared

Generated from the released public TypeScript declarations.

<a id="configerror"></a>
## ConfigError

Safe public error raised when selected client configuration is invalid.

**Kind:** runtime

**Signature**

```ts
class ConfigError
```

### Public members

#### name

Public name returned by the API or supplied for an operation.

```ts
name: "ConfigError"
```

#### code

Stable normalized public error code.

```ts
code: "config_error"
```

#### message

Fixed safe English public error message.

```ts
message: "Cuna SDK configuration is invalid."
```

#### constructor

Constructs the documented public value.

```ts
constructor(): ConfigError
```

### ConfigError#constructor

Invokes the accepted public `constructor` operation owned by `ConfigError`.

**Returns:** A safe configuration error instance.

<a id="apierror"></a>
## ApiError

Safe public error for an API failure or malformed successful response.

**Kind:** runtime

**Signature**

```ts
class ApiError
```

### Public members

#### name

Public name returned by the API or supplied for an operation.

```ts
name: "ApiError"
```

#### code

Stable normalized public error code.

```ts
code: "api_error" | "malformed_response"
```

#### status

Documented session status or HTTP status, according to the owning declaration.

```ts
status: number
```

#### message

Fixed safe English public error message.

```ts
message: "The Cuna API request failed." | "The Cuna API returned an invalid response."
```

#### problem

Validated closed Problem metadata when the operation returned a conforming Problem body.

```ts
problem: ApiProblem | undefined
```

#### constructor

Constructs the documented public value.

```ts
constructor(status: number, code?: "api_error" | "malformed_response"): ApiError
```

### ApiError#constructor

Invokes the accepted public `constructor` operation owned by `ApiError`.

**Returns:** A safe API error instance.

- **status:** HTTP status associated with the API outcome.
- **code:** Normalized API failure or malformed-response code.

<a id="commanderror"></a>
## CommandError

Reserved non-constructible public command-error type.

**Kind:** runtime

**Signature**

```ts
class CommandError
```

### Public members

#### name

Public name returned by the API or supplied for an operation.

```ts
name: "CommandError"
```

#### code

Stable normalized public error code.

```ts
code: "command_error"
```

#### message

Fixed safe English public error message.

```ts
message: "The session command failed."
```

<a id="cunaerror"></a>
## CunaError

Base class for normalized public Cuna SDK errors.

**Kind:** runtime

**Signature**

```ts
class CunaError
```

### Public members

#### name

Public name returned by the API or supplied for an operation.

```ts
name: "ConfigError" | "ApiError" | "CommandError"
```

#### code

Stable normalized public error code.

```ts
code: "config_error" | "api_error" | "malformed_response" | "command_error"
```

<a id="opaquewirevalue"></a>
## OpaqueWireValue

Opaque record detail preserved without an SDK-defined shape.

**Kind:** type

**Signature**

```ts
type OpaqueWireValue = unknown
```

<a id="stdouttext"></a>
## stdoutText

Returns stdout only when the supplied wire value is a string.

**Kind:** runtime

**Signature**

```ts
function stdoutText(result: ExecResult): string | undefined
```

### stdoutText#stdoutText

Invokes the accepted public `stdoutText` operation owned by `stdoutText`.

**Returns:** The stdout string when present with the correct type, otherwise undefined.

- **result:** Unknown wire value to inspect without coercion.

<a id="stderrtext"></a>
## stderrText

Returns stderr only when the supplied wire value is a string.

**Kind:** runtime

**Signature**

```ts
function stderrText(result: ExecResult): string | undefined
```

### stderrText#stderrText

Invokes the accepted public `stderrText` operation owned by `stderrText`.

**Returns:** The stderr string when present with the correct type, otherwise undefined.

- **result:** Unknown wire value to inspect without coercion.

