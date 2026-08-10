/**
 * The one place this SDK decides which brand spellings of a wire identity it
 * accepts, and the one place it records which spelling it emits.
 *
 * The defect this closes is structural, not cosmetic. A namespace is *minted*
 * by the service and *accepted* by the client, and until now every accepting
 * surface carried its own independently written copy of the minted spelling:
 * one regular expression per token grammar, one string literal per protocol,
 * one host pattern per URL. The day the producer flips a spelling, every one of
 * those independent comparisons rejects a valid response at the same moment,
 * and each rejection of a terminal grant or an open URL destroys a single-use
 * 60-second capability rather than deferring it. Deriving all of them from
 * `WIRE_BRANDS` makes that one edit instead of nine.
 *
 * `WIRE_BRANDS` is an ACCEPT list. It may only ever GROW. Removing a spelling
 * starts rejecting responses that are accepted today, which is the failure this
 * module exists to prevent.
 *
 * Accepting is not emitting. The service is the authority on the minted
 * spelling; `EMITTED_TERMINAL_PROTOCOL` records what this client sends, it is
 * deliberately a single value, and widening the accept sets must never change
 * it.
 *
 * Not every branded identity travels on the wire. A configuration variable
 * name is minted by the documentation and accepted by `config.ts`, compared in
 * a different file from the one that publishes it — the same producer/consumer
 * split, with the same failure. `CUNA_BASE_URL` was documented nowhere and read
 * nowhere while `CUNA_API_KEY` in the very same config block was dual-accepted,
 * so a user who exported the Cuna spelling of the endpoint silently kept
 * talking to the default host. Environment names therefore derive from
 * `WIRE_BRANDS` too: one list, so the credential and the endpoint cannot drift
 * apart again.
 */

/**
 * Every brand spelling accepted on the wire. Append-only, and ORDERED: the
 * first entry is the spelling this product mints today and every later entry is
 * a legacy alias that must keep working.
 *
 * The order is load-bearing exactly once, in `brandedEnvNames`, where it
 * decides which variable wins when a user sets more than one spelling of the
 * same setting. Appending is safe by construction — a new entry lands last and
 * therefore cannot change an existing precedence.
 */
export const WIRE_BRANDS = ["cuna", "runa"] as const;

export type WireBrand = (typeof WIRE_BRANDS)[number];

/** A dotted protocol identity in both brand spellings, e.g. `terminal.v1`. */
export type BrandedProtocol<Suffix extends string> = `${WireBrand}.${Suffix}`;

/**
 * Compile-time proof that an accept set still covers a whole public union.
 *
 * `ReadonlySet<PublicUnion> = brandedProtocols(...)` already catches a set that
 * admits a spelling the public type never declared. This catches the opposite
 * and more dangerous direction: shrinking `WIRE_BRANDS` would silently narrow
 * every accept set below the union the SDK promises to return, and narrowing is
 * the one edit this module exists to forbid. Instantiating this alias fails to
 * compile the moment a declared spelling stops being accepted.
 */
export type Covers<Union extends Accepted, Accepted> = Union;

/** `(?:cuna|runa)` — the brand alternation, for embedding in a validator. */
export const BRAND_ALTERNATION = `(?:${WIRE_BRANDS.join("|")})`;

/** `(?:cunacode|runacode)` — the second-level label of a runtime zone. */
export const ZONE_ALTERNATION =
  `(?:${WIRE_BRANDS.map((brand) => `${brand}code`).join("|")})`;

/**
 * Both brand spellings of one dotted protocol identity.
 *
 * The returned set is typed by construction, so a caller that annotates it with
 * a public union gets a compile error the moment the two disagree.
 */
export function brandedProtocols<Suffix extends string>(
  suffix: Suffix,
): ReadonlySet<BrandedProtocol<Suffix>> {
  return new Set(
    WIRE_BRANDS.map((brand): BrandedProtocol<Suffix> => `${brand}.${suffix}`),
  );
}

/**
 * One environment-variable name in one brand spelling, e.g. `CUNA_BASE_URL`.
 */
export type BrandedEnvName<Suffix extends string> =
  `${Uppercase<WireBrand>}_${Suffix}`;

/**
 * Every brand spelling of one environment-variable suffix, most canonical
 * first — which is also the order a reader must consult them in.
 *
 * A caller that reads this list instead of writing the names out cannot widen
 * the credential and forget the endpoint, because there is only one list and
 * one order for both. Annotating the result with a `Covers<>` alias turns a
 * shrunk `WIRE_BRANDS` into a compile error at the configuration layer as well
 * as the wire layer.
 */
export function brandedEnvNames<Suffix extends string>(
  suffix: Suffix,
): readonly BrandedEnvName<Suffix>[] {
  return WIRE_BRANDS.map(
    (brand): BrandedEnvName<Suffix> =>
      `${brand.toUpperCase() as Uppercase<WireBrand>}_${suffix}`,
  );
}

/**
 * One credential-token opening in one brand spelling, e.g. family `sk` yields
 * the type of a secret key's prefix.
 */
export type BrandedCredentialPrefix<Family extends string> =
  `${WireBrand}_${Family}_`;

/**
 * Every brand spelling of one credential family's opening, canonical first.
 *
 * A prefix rather than a whole grammar, because the credential this SDK holds
 * is the customer's secret key and this SDK is not its issuer: it knows the
 * namespace it must accept and deliberately does not constrain a body the
 * service chose. `brandedCredentialPattern` closes the same opening over a
 * body when the grammar IS ours to assert.
 *
 * The append-only rule is at its strongest here. Keys in the legacy spelling
 * are issued and customer-held, so a spelling that leaves this list stops
 * authenticating a credential somebody is holding right now, and the holder
 * sees a configuration error rather than a rejected key.
 */
export function brandedCredentialPrefixes<Family extends string>(
  family: Family,
): readonly BrandedCredentialPrefix<Family>[] {
  return WIRE_BRANDS.map(
    (brand): BrandedCredentialPrefix<Family> => `${brand}_${family}_`,
  );
}

/**
 * A credential-token grammar in both brand spellings, e.g. family `tc` and
 * body `[A-Za-z0-9_-]{43}` yields `^(?:cuna|runa)_tc_[A-Za-z0-9_-]{43}$`.
 */
export function brandedCredentialPattern(family: string, body: string): RegExp {
  return new RegExp(`^${BRAND_ALTERNATION}_${family}_${body}$`, "u");
}

/** A runtime-zone host pattern in both brand spellings, anchored to one label. */
export function brandedZonePattern(pathAndQuery = ""): RegExp {
  return new RegExp(
    `^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.${ZONE_ALTERNATION}\\.cloud${pathAndQuery}$`,
  );
}

/**
 * The API host each brand spelling serves, KEYED BY BRAND rather than listed.
 *
 * The runtime zone above derives from the brand by string transform —
 * `cuna` → `cunacode.cloud` — and the API host is the one branded identity that
 * does not: `cuna` serves `api.getcuna.com` and `runa` serves
 * `api.runacode.io`, and no transform relates the two. The mapping therefore
 * has to be written down somewhere, and this is the only place it may be.
 *
 * `Record<WireBrand, string>` is what makes writing it down safe, and it is the
 * reason this is a record and not the obvious array. An array stays
 * type-correct when `WIRE_BRANDS` grows and silently omits the new host — a
 * narrowing relative to the authority, arriving with no diagnostic, which is
 * the exact failure this module exists to forbid. A record indexed by
 * `WireBrand` cannot: appending a spelling to the authority is a COMPILE ERROR
 * here until the host that spelling serves is supplied.
 *
 * Private on purpose. Every consumer takes a projection below, so no call site
 * can pick one brand's host out of the mapping and compare against it alone.
 */
const API_HOSTS = Object.freeze({
  cuna: "api.getcuna.com",
  runa: "api.runacode.io",
} as const satisfies Readonly<Record<WireBrand, string>>);

/** One accepted API host, e.g. `api.getcuna.com`. */
export type BrandedApiHost = (typeof API_HOSTS)[WireBrand];

/** One accepted API origin under one scheme, e.g. `wss://api.runacode.io`. */
export type BrandedApiOrigin<Scheme extends string> =
  `${Scheme}://${BrandedApiHost}`;

/**
 * One value per element of a tuple, preserving its length.
 *
 * `Tuple` must stay a type PARAMETER: only then is the mapped type homomorphic
 * and only then does it produce a tuple. Written directly over
 * `keyof typeof WIRE_BRANDS` it maps `map`, `some` and every other array member
 * as well, and the result is unusable.
 */
type PerElement<Tuple extends readonly unknown[], Value> = {
  readonly [Index in keyof Tuple]: Value;
};

/**
 * Every accepted API origin, one per brand, in the authority's order.
 *
 * A TUPLE whose length tracks `WIRE_BRANDS`, so callers that need the canonical
 * origin index it at `[0]` without a non-null assertion under
 * `noUncheckedIndexedAccess`, and keep compiling when a third spelling lands.
 */
export type BrandedApiOrigins<Scheme extends string> =
  PerElement<typeof WIRE_BRANDS, BrandedApiOrigin<Scheme>>;

/** Escapes a host literal for embedding in a regular expression. */
function regexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** `(?:api\.getcuna\.com|api\.runacode\.io)` — the API-host alternation. */
export const API_HOST_ALTERNATION = `(?:${
  WIRE_BRANDS.map((brand) => regexLiteral(API_HOSTS[brand])).join("|")
})`;

/**
 * Every accepted API origin under one scheme, canonical first.
 *
 * The projection for accepting surfaces that compare a whole URL by equality
 * rather than by shape — a terminal `connect_url` bound to a decoded session
 * id, a problem `type` bound to a decoded code — where no pattern can express
 * the binding. `brandedApiHostPattern` is the same authority projected as a
 * shape check; the two cannot disagree about the host because neither spells
 * one.
 *
 * The `as` is confined to this one line: `readonly [...].map()` widens a tuple
 * to an array, and the mapped return type is what restores the length the
 * authority guarantees.
 */
export function brandedApiOrigins<Scheme extends string>(
  scheme: Scheme,
): BrandedApiOrigins<Scheme> {
  return WIRE_BRANDS.map(
    (brand): BrandedApiOrigin<Scheme> => `${scheme}://${API_HOSTS[brand]}`,
  ) as unknown as BrandedApiOrigins<Scheme>;
}

/**
 * An API-host URL pattern in every brand spelling, anchored end to end.
 *
 * The counterpart of `brandedZonePattern` for the half of the same concept that
 * derived from nothing. The runtime zone had an authority and the API host did
 * not, so `api.getcuna.com|api.runacode.io` was written out by hand at every
 * accepting site — the terminal `connect_url`, the problem `type`, and the
 * expected `wss://` origins — each an independent copy of a spelling the
 * service mints. Every copy rejects a valid response on the same day, and a
 * rejected terminal grant is a single-use 60-second capability destroyed rather
 * than retried.
 *
 * `scheme` is a parameter because one host carries two: `https` for the REST
 * surface and `wss` for the terminal stream. Splitting it into two functions
 * would put the host in two derivations again for no gain.
 */
export function brandedApiHostPattern(
  pathAndQuery = "",
  scheme: "https" | "wss" = "https",
): RegExp {
  return new RegExp(`^${scheme}://${API_HOST_ALTERNATION}${pathAndQuery}$`, "u");
}

/**
 * `(?:/__cuna|/__runa)` — the reserved-path label of a runtime capability URL,
 * leading separator included so it composes the same way `brandedReservedPaths`
 * spells a whole path.
 *
 * `/__runa/auth` is minted by the edge and accepted here, and it was accepted
 * in two independent places at once: once inside the capability-URL pattern and
 * once as a bare pathname string after the URL is re-parsed. Two copies of one
 * spelling, compared by nothing, in the same function.
 */
export const RESERVED_PATH_ALTERNATION =
  `(?:${WIRE_BRANDS.map((brand) => `/__${brand}`).join("|")})`;

/** One reserved runtime path in one brand spelling, e.g. `/__cuna/auth`. */
export type BrandedReservedPath<Suffix extends string> =
  `/__${WireBrand}/${Suffix}`;

/** Every brand spelling of one reserved runtime path, canonical first. */
export function brandedReservedPaths<Suffix extends string>(
  suffix: Suffix,
): readonly BrandedReservedPath<Suffix>[] {
  return WIRE_BRANDS.map(
    (brand): BrandedReservedPath<Suffix> => `/__${brand}/${suffix}`,
  );
}

/**
 * The terminal-stream protocol this client sends when it requests a grant.
 *
 * One value, not a set: the service owns the minted spelling and this constant
 * is not the place to change it.
 */
export const EMITTED_TERMINAL_PROTOCOL = "runa.terminal.v1" as const;
