import type * as HKT from "../HKT"

export interface Derive<F extends HKT.URIS, Typeclass extends HKT.URIS, C = HKT.Auto>
  extends HKT.Base<F, C> {
  readonly derive: <N extends string, K, SI, SO, X, I, S, R, E, A>(
    fa: HKT.KindFix<Typeclass, C, N, K, SI, SO, X, I, S, R, E, A>
  ) => HKT.KindFix<
    Typeclass,
    C,
    N,
    K,
    SI,
    SO,
    X,
    I,
    S,
    R,
    E,
    HKT.KindFix<F, C, N, K, SI, SO, X, I, S, R, E, A>
  >
}
