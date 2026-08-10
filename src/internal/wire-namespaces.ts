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
 */

/** Every brand spelling accepted on the wire. Append-only. */
export const WIRE_BRANDS = ["cuna", "runa"] as const;

export type WireBrand = (typeof WIRE_BRANDS)[number];

/** A dotted protocol identity in both brand spellings, e.g. `terminal.v1`. */
export type BrandedProtocol<Suffix extends string> = `${WireBrand}.${Suffix}`;

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
