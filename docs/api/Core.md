# Core

Generated from the released public TypeScript declarations.

<a id="cuna"></a>
## Cuna

Constructible Cuna client that owns managers, transport lifecycle, and cleanup.

**Kind:** runtime

**Signature**

```ts
class Cuna
```

### Public members

#### constructor

Constructs the documented public value.

```ts
constructor(config?: CunaConfig): Cuna
```

#### sessions

Stable sessions manager owned by this client.

```ts
sessions: SessionsManager
```

#### workspaceBindings

Stable canonical workspace binding manager owned by this client.

```ts
workspaceBindings: WorkspaceBindingsManager
```

#### workspaceSync

Stable workspace synchronization manager owned by this client.

```ts
workspaceSync: WorkspaceSyncManager
```

#### machineCreates

Stable machine-create recovery manager owned by this client.

```ts
machineCreates: MachineCreatesManager
```

#### agentSessions

Stable AgentSession manager owned by this client.

```ts
agentSessions: AgentSessionsManager
```

#### capabilities

Returns the stable capability discovery manager owned by this client.

```ts
capabilities: CapabilitiesManager
```

#### records

Stable records manager owned by this client.

```ts
records: RecordsManager
```

#### me

Reads the caller profile and workspace state.

```ts
me(): Promise<Me>
```

#### close

Closes this client after already admitted work completes.

```ts
close(): Promise<void>
```

### Cuna#constructor

Invokes the accepted public `constructor` operation owned by `Cuna`.

**Returns:** A configured Cuna client.

- **config:** Optional client configuration resolved under the documented precedence rules.

**Throws**

- `ConfigError` when the contract-backed failure condition applies.

**Example**

```ts
const apiKey = process.env.CUNA_API_KEY;
if (apiKey === undefined) throw new Error("CUNA_API_KEY is required.");
const client = new Cuna({ apiKey });
await client.close();
```

Source: [docs/reference/examples/workflows.ts](../reference/examples/workflows.ts) - Test: `TC-048-EXAMPLE-CUNA_CONSTRUCTOR`

### Cuna#me

Invokes the accepted public `me` operation owned by `Cuna`.

**Returns:** The caller profile and workspace state.

**Throws**

- `ApiError` when the contract-backed failure condition applies.

**Example**

```ts
await cuna.me();
```

Source: [docs/reference/examples/workflows.ts](../reference/examples/workflows.ts) - Test: `TC-048-EXAMPLE-CUNA_ME`

### Cuna#close

Invokes the accepted public `close` operation owned by `Cuna`.

**Returns:** A promise that resolves after client-owned cleanup completes.

**Example**

```ts
await cuna.close();
```

Source: [docs/reference/examples/workflows.ts](../reference/examples/workflows.ts) - Test: `TC-048-EXAMPLE-CUNA_CLOSE`

<a id="cunaconfig"></a>
## CunaConfig

Configuration accepted while constructing a Cuna client.

**Kind:** type

**Signature**

```ts
interface CunaConfig
```

### Public members

#### apiKey

Optional constructor API key selected before environment or explicit-file sources.

```ts
apiKey?: string
```

#### baseUrl

Optional explicit canonical Cuna API origin.

```ts
baseUrl?: string
```

#### configFile

Optional explicit JSON configuration file, or null to disable file loading.

```ts
configFile?: string | null
```

#### fetch

Optional caller-owned fetch-compatible transport function.

```ts
fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | (input: string | Request | URL, init?: RequestInit) => Promise<Response>
```

#### diagnostics

Optional caller-owned diagnostic sink.

```ts
diagnostics?: DiagnosticSink
```

#### tracing

Optional caller-owned tracing sink.

```ts
tracing?: TraceSink
```

