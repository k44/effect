import type * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual, pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import { pipeArguments } from "effect/Pipeable"
import type * as Predicate from "effect/Predicate"
import type * as Schedule from "effect/Schedule"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as Body from "../../Http/Body.js"
import type * as Client from "../../Http/Client.js"
import type * as Error from "../../Http/ClientError.js"
import type * as ClientRequest from "../../Http/ClientRequest.js"
import type * as ClientResponse from "../../Http/ClientResponse.js"
import * as Method from "../../Http/Method.js"
import * as UrlParams from "../../Http/UrlParams.js"
import * as internalBody from "./body.js"
import * as internalError from "./clientError.js"
import * as internalRequest from "./clientRequest.js"
import * as internalResponse from "./clientResponse.js"

/** @internal */
export const TypeId: Client.TypeId = Symbol.for(
  "@effect/platform/Http/Client"
) as Client.TypeId

/** @internal */
export const tag = Context.GenericTag<Client.Client.Default>("@effect/platform/Http/Client")

const clientProto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  }
}

/** @internal */
export const make = <R, E, A, R2, E2>(
  execute: (
    request: Effect.Effect<ClientRequest.ClientRequest, E2, R2>
  ) => Effect.Effect<A, E, R>,
  preprocess: Client.Client.Preprocess<R2, E2>
): Client.Client<R, E, A> => {
  function client(request: ClientRequest.ClientRequest) {
    return execute(preprocess(request))
  }
  Object.setPrototypeOf(client, clientProto)
  ;(client as any).preprocess = preprocess
  ;(client as any).execute = execute
  return client as any
}

const addB3Headers = (req: ClientRequest.ClientRequest) =>
  Effect.match(Effect.currentSpan, {
    onFailure: () => req,
    onSuccess: (span) =>
      internalRequest.setHeader(
        req,
        "b3",
        `${span.traceId}-${span.spanId}-${span.sampled ? "1" : "0"}${
          span.parent._tag === "Some" ? `-${span.parent.value.spanId}` : ""
        }`
      )
  })

/** @internal */
export const makeDefault = (
  f: (
    request: ClientRequest.ClientRequest
  ) => Effect.Effect<ClientResponse.ClientResponse, Error.HttpClientError, Scope.Scope>
): Client.Client.Default => make(Effect.flatMap(f), addB3Headers)

/** @internal */
export const Fetch = Context.GenericTag<Client.Fetch, typeof globalThis.fetch>(
  "@effect/platform/Http/Client/Fetch"
)

/** @internal */
export const fetch = (options?: RequestInit): Client.Client.Default =>
  makeDefault((request) =>
    Effect.flatMap(
      UrlParams.makeUrl(request.url, request.urlParams, (_) =>
        internalError.requestError({
          request,
          reason: "InvalidUrl",
          error: _
        })),
      (url) =>
        Effect.flatMap(Effect.serviceOption(Fetch), (fetch_) => {
          const fetch = fetch_._tag === "Some" ? fetch_.value : globalThis.fetch
          const headers = new Headers(request.headers)
          const send = (body: BodyInit | undefined) =>
            pipe(
              Effect.acquireRelease(
                Effect.sync(() => new AbortController()),
                (controller) => Effect.sync(() => controller.abort())
              ),
              Effect.flatMap((controller) =>
                Effect.tryPromise({
                  try: () =>
                    fetch(url, {
                      ...options,
                      method: request.method,
                      headers,
                      body,
                      duplex: request.body._tag === "Stream" ? "half" : undefined,
                      signal: controller.signal
                    } as any),
                  catch: (_) =>
                    internalError.requestError({
                      request,
                      reason: "Transport",
                      error: _
                    })
                })
              ),
              Effect.map((_) => internalResponse.fromWeb(request, _))
            )
          if (Method.hasBody(request.method)) {
            return send(convertBody(request.body))
          }
          return send(undefined)
        })
    )
  )

const convertBody = (body: Body.Body): BodyInit | undefined => {
  switch (body._tag) {
    case "Empty":
      return undefined
    case "Raw":
      return body.body as any
    case "Uint8Array":
      return body.body
    case "FormData":
      return body.formData
    case "Stream":
      return Stream.toReadableStream(body.stream)
  }
}

/** @internal */
export const fetchOk = (options?: RequestInit): Client.Client.Default => filterStatusOk(fetch(options))

/** @internal */
export const layer = Layer.succeed(tag, fetch())

/** @internal */
export const transform = dual<
  <R, E, A, R1, E1, A1>(
    f: (
      effect: Effect.Effect<A, E, R>,
      request: ClientRequest.ClientRequest
    ) => Effect.Effect<A1, E1, R1>
  ) => (self: Client.Client<R, E, A>) => Client.Client<R | R1, E | E1, A1>,
  <R, E, A, R1, E1, A1>(
    self: Client.Client<R, E, A>,
    f: (
      effect: Effect.Effect<A, E, R>,
      request: ClientRequest.ClientRequest
    ) => Effect.Effect<A1, E1, R1>
  ) => Client.Client<R | R1, E | E1, A1>
>(2, (self, f) =>
  make(
    Effect.flatMap((request) => f(self.execute(Effect.succeed(request)), request)),
    self.preprocess
  ))

/** @internal */
export const transformResponse = dual<
  <R, E, A, R1, E1, A1>(
    f: (effect: Effect.Effect<A, E, R>) => Effect.Effect<A1, E1, R1>
  ) => (self: Client.Client<R, E, A>) => Client.Client<R1, E1, A1>,
  <R, E, A, R1, E1, A1>(
    self: Client.Client<R, E, A>,
    f: (effect: Effect.Effect<A, E, R>) => Effect.Effect<A1, E1, R1>
  ) => Client.Client<R1, E1, A1>
>(2, (self, f) => make((request) => f(self.execute(request)), self.preprocess))

/** @internal */
export const catchTag: {
  <K extends E extends { _tag: string } ? E["_tag"] : never, E, R1, E1, A1>(
    tag: K,
    f: (e: Extract<E, { _tag: K }>) => Effect.Effect<A1, E1, R1>
  ): <R, A>(
    self: Client.Client<R, E, A>
  ) => Client.Client<R1 | R, E1 | Exclude<E, { _tag: K }>, A1 | A>
  <
    R,
    E,
    A,
    K extends E extends { _tag: string } ? E["_tag"] : never,
    R1,
    E1,
    A1
  >(
    self: Client.Client<R, E, A>,
    tag: K,
    f: (e: Extract<E, { _tag: K }>) => Effect.Effect<A1, E1, R1>
  ): Client.Client<R1 | R, E1 | Exclude<E, { _tag: K }>, A1 | A>
} = dual(
  3,
  <
    R,
    E,
    A,
    K extends E extends { _tag: string } ? E["_tag"] : never,
    R1,
    E1,
    A1
  >(
    self: Client.Client<R, E, A>,
    tag: K,
    f: (e: Extract<E, { _tag: K }>) => Effect.Effect<A1, E1, R1>
  ): Client.Client<R1 | R, E1 | Exclude<E, { _tag: K }>, A1 | A> => transformResponse(self, Effect.catchTag(tag, f))
)

/** @internal */
export const catchTags: {
  <
    E,
    Cases extends
      & {
        [K in Extract<E, { _tag: string }>["_tag"]]+?: (
          error: Extract<E, { _tag: K }>
        ) => Effect.Effect<any, any, any>
      }
      & (unknown extends E ? {}
        : {
          [
            K in Exclude<
              keyof Cases,
              Extract<E, { _tag: string }>["_tag"]
            >
          ]: never
        })
  >(
    cases: Cases
  ): <R, A>(
    self: Client.Client<R, E, A>
  ) => Client.Client<
    | R
    | {
      [K in keyof Cases]: Cases[K] extends (
        ...args: Array<any>
      ) => Effect.Effect<any, any, infer R> ? R
        : never
    }[keyof Cases],
    | Exclude<E, { _tag: keyof Cases }>
    | {
      [K in keyof Cases]: Cases[K] extends (
        ...args: Array<any>
      ) => Effect.Effect<any, infer E, any> ? E
        : never
    }[keyof Cases],
    | A
    | {
      [K in keyof Cases]: Cases[K] extends (
        ...args: Array<any>
      ) => Effect.Effect<infer A, any, any> ? A
        : never
    }[keyof Cases]
  >
  <
    R,
    E extends { _tag: string },
    A,
    Cases extends
      & {
        [K in Extract<E, { _tag: string }>["_tag"]]+?: (
          error: Extract<E, { _tag: K }>
        ) => Effect.Effect<any, any, any>
      }
      & (unknown extends E ? {}
        : {
          [
            K in Exclude<
              keyof Cases,
              Extract<E, { _tag: string }>["_tag"]
            >
          ]: never
        })
  >(
    self: Client.Client<R, E, A>,
    cases: Cases
  ): Client.Client<
    | R
    | {
      [K in keyof Cases]: Cases[K] extends (
        ...args: Array<any>
      ) => Effect.Effect<any, any, infer R> ? R
        : never
    }[keyof Cases],
    | Exclude<E, { _tag: keyof Cases }>
    | {
      [K in keyof Cases]: Cases[K] extends (
        ...args: Array<any>
      ) => Effect.Effect<any, infer E, any> ? E
        : never
    }[keyof Cases],
    | A
    | {
      [K in keyof Cases]: Cases[K] extends (
        ...args: Array<any>
      ) => Effect.Effect<infer A, any, any> ? A
        : never
    }[keyof Cases]
  >
} = dual(
  2,
  <
    R,
    E extends { _tag: string },
    A,
    Cases extends
      & {
        [K in Extract<E, { _tag: string }>["_tag"]]+?: (
          error: Extract<E, { _tag: K }>
        ) => Effect.Effect<any, any, any>
      }
      & (unknown extends E ? {}
        : {
          [
            K in Exclude<
              keyof Cases,
              Extract<E, { _tag: string }>["_tag"]
            >
          ]: never
        })
  >(
    self: Client.Client<R, E, A>,
    cases: Cases
  ): Client.Client<
    | R
    | {
      [K in keyof Cases]: Cases[K] extends (
        ...args: Array<any>
      ) => Effect.Effect<any, any, infer R> ? R
        : never
    }[keyof Cases],
    | Exclude<E, { _tag: keyof Cases }>
    | {
      [K in keyof Cases]: Cases[K] extends (
        ...args: Array<any>
      ) => Effect.Effect<any, infer E, any> ? E
        : never
    }[keyof Cases],
    | A
    | {
      [K in keyof Cases]: Cases[K] extends (
        ...args: Array<any>
      ) => Effect.Effect<infer A, any, any> ? A
        : never
    }[keyof Cases]
  > => transformResponse(self, Effect.catchTags(cases))
)

/** @internal */
export const catchAll: {
  <E, R2, E2, A2>(
    f: (e: E) => Effect.Effect<A2, E2, R2>
  ): <R, A>(self: Client.Client<R, E, A>) => Client.Client<R | R2, E2, A2 | A>
  <R, E, A, R2, E2, A2>(
    self: Client.Client<R, E, A>,
    f: (e: E) => Effect.Effect<A2, E2, R2>
  ): Client.Client<R | R2, E2, A2 | A>
} = dual(
  2,
  <R, E, A, R2, E2, A2>(
    self: Client.Client<R, E, A>,
    f: (e: E) => Effect.Effect<A2, E2, R2>
  ): Client.Client<R | R2, E2, A2 | A> => transformResponse(self, Effect.catchAll(f))
)

/** @internal */
export const filterOrElse = dual<
  <A, R2, E2, B>(
    f: Predicate.Predicate<A>,
    orElse: (a: A) => Effect.Effect<B, E2, R2>
  ) => <R, E>(
    self: Client.Client<R, E, A>
  ) => Client.Client<R2 | R, E2 | E, A | B>,
  <R, E, A, R2, E2, B>(
    self: Client.Client<R, E, A>,
    f: Predicate.Predicate<A>,
    orElse: (a: A) => Effect.Effect<B, E2, R2>
  ) => Client.Client<R2 | R, E2 | E, A | B>
>(3, (self, f, orElse) => transformResponse(self, Effect.filterOrElse(f, orElse)))

/** @internal */
export const filterOrFail = dual<
  <A, E2>(
    f: Predicate.Predicate<A>,
    orFailWith: (a: A) => E2
  ) => <R, E>(self: Client.Client<R, E, A>) => Client.Client<R, E2 | E, A>,
  <R, E, A, E2>(
    self: Client.Client<R, E, A>,
    f: Predicate.Predicate<A>,
    orFailWith: (a: A) => E2
  ) => Client.Client<R, E2 | E, A>
>(3, (self, f, orFailWith) => transformResponse(self, Effect.filterOrFail(f, orFailWith)))

/** @internal */
export const filterStatus = dual<
  (
    f: (status: number) => boolean
  ) => <R, E>(
    self: Client.Client.WithResponse<R, E>
  ) => Client.Client.WithResponse<R, E | Error.ResponseError>,
  <R, E>(
    self: Client.Client.WithResponse<R, E>,
    f: (status: number) => boolean
  ) => Client.Client.WithResponse<R, E | Error.ResponseError>
>(2, (self, f) =>
  transform(self, (effect, request) =>
    Effect.filterOrFail(
      effect,
      (response) => f(response.status),
      (response) =>
        internalError.responseError({
          request,
          response,
          reason: "StatusCode",
          error: "non 2xx status code"
        })
    )))

/** @internal */
export const filterStatusOk: <R, E>(
  self: Client.Client.WithResponse<R, E>
) => Client.Client.WithResponse<R, E | Error.ResponseError> = filterStatus(
  (status) => status >= 200 && status < 300
)

/** @internal */
export const map = dual<
  <A, B>(
    f: (a: A) => B
  ) => <R, E>(self: Client.Client<R, E, A>) => Client.Client<R, E, B>,
  <R, E, A, B>(
    self: Client.Client<R, E, A>,
    f: (a: A) => B
  ) => Client.Client<R, E, B>
>(2, (self, f) => transformResponse(self, Effect.map(f)))

/** @internal */
export const mapEffect = dual<
  <A, R2, E2, B>(
    f: (a: A) => Effect.Effect<B, E2, R2>
  ) => <R, E>(self: Client.Client<R, E, A>) => Client.Client<R | R2, E | E2, B>,
  <R, E, A, R2, E2, B>(
    self: Client.Client<R, E, A>,
    f: (a: A) => Effect.Effect<B, E2, R2>
  ) => Client.Client<R | R2, E | E2, B>
>(2, (self, f) => transformResponse(self, Effect.flatMap(f)))

/** @internal */
export const scoped = <R, E, A>(
  self: Client.Client<R, E, A>
): Client.Client<Exclude<R, Scope.Scope>, E, A> => transformResponse(self, Effect.scoped)

/** @internal */
export const mapEffectScoped = dual<
  <A, R2, E2, B>(
    f: (a: A) => Effect.Effect<B, E2, R2>
  ) => <R, E>(self: Client.Client<R, E, A>) => Client.Client<Exclude<R | R2, Scope.Scope>, E | E2, B>,
  <R, E, A, R2, E2, B>(
    self: Client.Client<R, E, A>,
    f: (a: A) => Effect.Effect<B, E2, R2>
  ) => Client.Client<Exclude<R | R2, Scope.Scope>, E | E2, B>
>(2, (self, f) => scoped(mapEffect(self, f)))

/** @internal */
export const mapRequest = dual<
  (
    f: (a: ClientRequest.ClientRequest) => ClientRequest.ClientRequest
  ) => <R, E, A>(self: Client.Client<R, E, A>) => Client.Client<R, E, A>,
  <R, E, A>(
    self: Client.Client<R, E, A>,
    f: (a: ClientRequest.ClientRequest) => ClientRequest.ClientRequest
  ) => Client.Client<R, E, A>
>(2, (self, f) => make(self.execute, (request) => Effect.map(self.preprocess(request), f)))

/** @internal */
export const mapRequestEffect = dual<
  <R2, E2>(
    f: (
      a: ClientRequest.ClientRequest
    ) => Effect.Effect<ClientRequest.ClientRequest, E2, R2>
  ) => <R, E, A>(
    self: Client.Client<R, E, A>
  ) => Client.Client<R | R2, E | E2, A>,
  <R, E, A, R2, E2>(
    self: Client.Client<R, E, A>,
    f: (
      a: ClientRequest.ClientRequest
    ) => Effect.Effect<ClientRequest.ClientRequest, E2, R2>
  ) => Client.Client<R | R2, E | E2, A>
>(2, (self, f) => make(self.execute as any, (request) => Effect.flatMap(self.preprocess(request), f)))

/** @internal */
export const mapInputRequest = dual<
  (
    f: (a: ClientRequest.ClientRequest) => ClientRequest.ClientRequest
  ) => <R, E, A>(self: Client.Client<R, E, A>) => Client.Client<R, E, A>,
  <R, E, A>(
    self: Client.Client<R, E, A>,
    f: (a: ClientRequest.ClientRequest) => ClientRequest.ClientRequest
  ) => Client.Client<R, E, A>
>(2, (self, f) => make(self.execute, (request) => self.preprocess(f(request))))

/** @internal */
export const mapInputRequestEffect = dual<
  <R2, E2>(
    f: (
      a: ClientRequest.ClientRequest
    ) => Effect.Effect<ClientRequest.ClientRequest, E2, R2>
  ) => <R, E, A>(
    self: Client.Client<R, E, A>
  ) => Client.Client<R | R2, E | E2, A>,
  <R, E, A, R2, E2>(
    self: Client.Client<R, E, A>,
    f: (
      a: ClientRequest.ClientRequest
    ) => Effect.Effect<ClientRequest.ClientRequest, E2, R2>
  ) => Client.Client<R | R2, E | E2, A>
>(2, (self, f) => make(self.execute as any, (request) => Effect.flatMap(f(request), self.preprocess)))

/** @internal */
export const retry: {
  <R1, E extends E0, E0, B>(
    policy: Schedule.Schedule<R1, E0, B>
  ): <R, A>(self: Client.Client<R, E, A>) => Client.Client<R1 | R, E, A>
  <R, E extends E0, E0, A, R1, B>(
    self: Client.Client<R, E, A>,
    policy: Schedule.Schedule<R1, E0, B>
  ): Client.Client<R | R1, E, A>
} = dual(
  2,
  <R, E extends E0, E0, A, R1, B>(
    self: Client.Client<R, E, A>,
    policy: Schedule.Schedule<R1, E0, B>
  ): Client.Client<R | R1, E, A> => transformResponse(self, Effect.retry(policy))
)

/** @internal */
export const schemaFunction = dual<
  <SA, SI, SR>(
    schema: Schema.Schema<SA, SI, SR>
  ) => <R, E, A>(
    self: Client.Client<R, E, A>
  ) => (
    request: ClientRequest.ClientRequest
  ) => (
    a: SA
  ) => Effect.Effect<A, E | ParseResult.ParseError | Error.RequestError, SR | R>,
  <R, E, A, SA, SI, SR>(
    self: Client.Client<R, E, A>,
    schema: Schema.Schema<SA, SI, SR>
  ) => (
    request: ClientRequest.ClientRequest
  ) => (
    a: SA
  ) => Effect.Effect<A, E | ParseResult.ParseError | Error.RequestError, SR | R>
>(2, (self, schema) => {
  const encode = Schema.encode(schema)
  return (request) => (a) =>
    Effect.flatMap(
      Effect.tryMap(encode(a), {
        try: (body) => new TextEncoder().encode(JSON.stringify(body)),
        catch: (error) =>
          internalError.requestError({
            request,
            reason: "Encode",
            error
          })
      }),
      (body) =>
        self(
          internalRequest.setBody(
            request,
            internalBody.uint8Array(body, "application/json")
          )
        )
    )
})

/** @internal */
export const tap = dual<
  <A, R2, E2, _>(
    f: (a: A) => Effect.Effect<_, E2, R2>
  ) => <R, E>(self: Client.Client<R, E, A>) => Client.Client<R | R2, E | E2, A>,
  <R, E, A, R2, E2, _>(
    self: Client.Client<R, E, A>,
    f: (a: A) => Effect.Effect<_, E2, R2>
  ) => Client.Client<R | R2, E | E2, A>
>(2, (self, f) => transformResponse(self, Effect.tap(f)))

/** @internal */
export const tapRequest = dual<
  <R2, E2, _>(
    f: (a: ClientRequest.ClientRequest) => Effect.Effect<_, E2, R2>
  ) => <R, E, A>(
    self: Client.Client<R, E, A>
  ) => Client.Client<R | R2, E | E2, A>,
  <R, E, A, R2, E2, _>(
    self: Client.Client<R, E, A>,
    f: (a: ClientRequest.ClientRequest) => Effect.Effect<_, E2, R2>
  ) => Client.Client<R | R2, E | E2, A>
>(2, (self, f) => make(self.execute as any, (request) => Effect.tap(self.preprocess(request), f)))
