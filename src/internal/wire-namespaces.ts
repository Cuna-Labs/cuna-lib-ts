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
 * The terminal-stream protocol this client sends when it requests a grant.
 *
 * One value, not a set: the service owns the minted spelling and this constant
 * is not the place to change it.
 */
export const EMITTED_TERMINAL_PROTOCOL = "runa.terminal.v1" as const;
