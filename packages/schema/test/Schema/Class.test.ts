import * as AST from "@effect/schema/AST"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Pretty from "@effect/schema/Pretty"
import * as S from "@effect/schema/Schema"
import * as Serializable from "@effect/schema/Serializable"
import * as Util from "@effect/schema/test/util"
import { Context, Effect, Exit } from "effect"
import * as Data from "effect/Data"
import * as Equal from "effect/Equal"
import * as O from "effect/Option"
import * as Request from "effect/Request"
import { assert, describe, expect, it } from "vitest"

class Person extends S.Class<Person>()({
  id: S.number,
  name: S.string.pipe(S.nonEmpty())
}) {
  get upperName() {
    return this.name.toUpperCase()
  }
}

const Name = Context.GenericTag<"Name", string>("Name")
const NameString = S.string.pipe(
  S.nonEmpty(),
  S.transformOrFail(
    S.string,
    (_, _opts, ast) =>
      Name.pipe(
        Effect.filterOrFail(
          (name) => _ === name,
          () => ParseResult.type(ast, _, "Does not match Name")
        )
      ),
    (_) => ParseResult.succeed(_)
  )
)

const Id = Context.GenericTag<"Id", number>("Name")
const IdNumber = S.number.pipe(
  S.transformOrFail(
    S.number,
    (_, _opts, ast) =>
      Effect.filterOrFail(
        Id,
        (id) => _ === id,
        () => ParseResult.type(ast, _, "Does not match Id")
      ),
    (_) => ParseResult.succeed(_)
  )
)

class PersonContext extends Person.extend<PersonContext>()({
  name: NameString
}) {}

class TaggedPerson extends S.TaggedClass<TaggedPerson>()("TaggedPerson", {
  id: S.number,
  name: S.string.pipe(S.nonEmpty())
}) {
  get upperName() {
    return this.name.toUpperCase()
  }
}

class TaggedPersonWithAge extends TaggedPerson.extend<TaggedPersonWithAge>()({
  age: S.number
}) {
  get isAdult() {
    return this.age >= 18
  }
}

class PersonWithAge extends Person.extend<PersonWithAge>()({
  age: S.number
}) {
  get isAdult() {
    return this.age >= 18
  }
}

class PersonWithNick extends PersonWithAge.extend<PersonWithNick>()({
  nick: S.string
}) {}

class PersonWithTransform extends Person.transformOrFail<PersonWithTransform>()(
  {
    id: S.string,
    thing: S.optional(S.struct({ id: S.number }), { exact: true, as: "Option" })
  },
  (input, _, ast) =>
    input.id === 2 ?
      ParseResult.fail(ParseResult.type(ast, input)) :
      ParseResult.succeed({
        ...input,
        id: input.id.toString(),
        thing: O.some({ id: 123 })
      }),
  (input, _, ast) =>
    input.id === "2" ?
      ParseResult.fail(ParseResult.type(ast, input)) :
      ParseResult.succeed({
        ...input,
        id: Number(input.id)
      })
) {}

class PersonWithTransformFrom extends Person.transformOrFailFrom<PersonWithTransformFrom>()(
  {
    id: S.string,
    thing: S.optional(S.struct({ id: S.number }), { exact: true, as: "Option" })
  },
  (input, _, ast) =>
    input.id === 2 ?
      ParseResult.fail(ParseResult.type(ast, input)) :
      ParseResult.succeed({
        ...input,
        id: input.id.toString(),
        thing: { id: 123 }
      }),
  (input, _, ast) =>
    input.id === "2" ?
      ParseResult.fail(ParseResult.type(ast, input)) :
      ParseResult.succeed({
        ...input,
        id: Number(input.id)
      })
) {}

describe("Schema > Class", () => {
  it("should be a Schema", () => {
    expect(S.isSchema(Person)).toEqual(true)
    const schema = Person.pipe(S.title("Person"))
    expect(schema.ast.annotations).toEqual({
      [AST.TitleAnnotationId]: "Person"
    })
    expect(S.isSchema(schema)).toEqual(true)
  })

  it("constructor", () => {
    const john = new Person({ id: 1, name: "John" })
    expect(john.name).toEqual("John")
    expect(john.upperName).toEqual("JOHN")
    expect(typeof john.upperName).toEqual("string")
    expect(() => new Person({ id: 1, name: "" })).toThrow(
      new Error(`{ id: number; name: a non empty string }
└─ ["name"]
   └─ a non empty string
      └─ Predicate refinement failure
         └─ Expected a non empty string, actual ""`)
    )
  })

  it("is", () => {
    const is = S.is(S.to(Person))
    expect(is(new Person({ id: 1, name: "name" }))).toEqual(true)
    expect(is({ id: 1, name: "name" })).toEqual(false)
  })

  it("schema", async () => {
    const person = S.decodeUnknownSync(Person)({ id: 1, name: "John" })
    expect(person.name).toEqual("John")

    const PersonFromSelf = S.to(Person)
    await Util.expectDecodeUnknownSuccess(PersonFromSelf, new Person({ id: 1, name: "John" }))
    await Util.expectDecodeUnknownFailure(
      PersonFromSelf,
      { id: 1, name: "John" },
      `Expected Person (an instance of Person), actual {"id":1,"name":"John"}`
    )
  })

  it("with context", async () => {
    const person = S.decodeUnknown(PersonContext)({ id: 1, name: "John" }).pipe(
      Effect.provideService(Name, "John"),
      Effect.runSync
    )
    expect(person.name).toEqual("John")

    const PersonFromSelf = S.to(Person)
    await Util.expectDecodeUnknownSuccess(PersonFromSelf, new Person({ id: 1, name: "John" }))
    await Util.expectDecodeUnknownFailure(
      PersonFromSelf,
      { id: 1, name: "John" },
      `Expected Person (an instance of Person), actual {"id":1,"name":"John"}`
    )
  })

  it(".struct", async () => {
    const person = S.decodeUnknownSync(Person.struct)({ id: 1, name: "John" })
    assert.deepStrictEqual(person, { id: 1, name: "John" })
  })

  it("extends", () => {
    const person = S.decodeUnknownSync(PersonWithAge)({
      id: 1,
      name: "John",
      age: 30
    })
    expect(person.name).toEqual("John")
    expect(person.age).toEqual(30)
    expect(person.isAdult).toEqual(true)
    expect(person.upperName).toEqual("JOHN")
    expect(typeof person.upperName).toEqual("string")
  })

  it("extends extends", () => {
    const person = S.decodeUnknownSync(PersonWithNick)({
      id: 1,
      name: "John",
      age: 30,
      nick: "Joe"
    })
    expect(person.age).toEqual(30)
    expect(person.nick).toEqual("Joe")
  })

  it("extends error", () => {
    expect(() => S.decodeUnknownSync(PersonWithAge)({ id: 1, name: "John" })).toThrow(
      new Error(
        `({ id: number; age: number; name: a non empty string } <-> PersonWithAge)
└─ From side transformation failure
   └─ { id: number; age: number; name: a non empty string }
      └─ ["age"]
         └─ is missing`
      )
    )
  })

  it("Data.Class", () => {
    const person = new Person({ id: 1, name: "John" })
    const personAge = new PersonWithAge({ id: 1, name: "John", age: 30 })

    expect(String(person)).toEqual(`Person({ "id": 1, "name": "John" })`)
    expect(String(personAge)).toEqual(`PersonWithAge({ "id": 1, "age": 30, "name": "John" })`)

    expect(person instanceof Data.Class).toEqual(true)
    expect(personAge instanceof Data.Class).toEqual(true)

    const person2 = new Person({ id: 1, name: "John" })
    expect(Equal.equals(person, person2)).toEqual(true)

    const person3 = new Person({ id: 2, name: "John" })
    expect(Equal.equals(person, person3)).toEqual(false)
  })

  it("pretty", () => {
    const pretty = Pretty.make(Person)
    expect(pretty(new Person({ id: 1, name: "John" }))).toEqual(
      `Person({ "id": 1, "name": "John" })`
    )
  })

  it("transformOrFail", async () => {
    const decode = S.decodeSync(PersonWithTransform)
    const person = decode({
      id: 1,
      name: "John"
    })
    expect(person.id).toEqual("1")
    expect(person.name).toEqual("John")
    expect(O.isSome(person.thing) && person.thing.value.id === 123).toEqual(true)
    expect(person.upperName).toEqual("JOHN")
    expect(typeof person.upperName).toEqual("string")

    await Util.expectDecodeUnknownFailure(
      PersonWithTransform,
      {
        id: 2,
        name: "John"
      },
      `(({ id: number; name: a non empty string } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> }) <-> PersonWithTransform)
└─ From side transformation failure
   └─ ({ id: number; name: a non empty string } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> })
      └─ Transformation process failure
         └─ Expected ({ id: number; name: a non empty string } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> }), actual {"id":2,"name":"John"}`
    )
    await Util.expectEncodeFailure(
      PersonWithTransform,
      new PersonWithTransform({ id: "2", name: "John", thing: O.some({ id: 1 }) }),
      `(({ id: number; name: a non empty string } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> }) <-> PersonWithTransform)
└─ From side transformation failure
   └─ ({ id: number; name: a non empty string } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> })
      └─ Transformation process failure
         └─ Expected ({ id: number; name: a non empty string } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> }), actual {"id":"2","name":"John","thing":{"_id":"Option","_tag":"Some","value":{"id":1}}}`
    )
  })

  it("transformOrFailFrom", async () => {
    const decode = S.decodeSync(PersonWithTransformFrom)
    const person = decode({
      id: 1,
      name: "John"
    })
    expect(person.id).toEqual("1")
    expect(person.name).toEqual("John")
    expect(O.isSome(person.thing) && person.thing.value.id === 123).toEqual(true)
    expect(person.upperName).toEqual("JOHN")
    expect(typeof person.upperName).toEqual("string")

    await Util.expectDecodeUnknownFailure(
      PersonWithTransformFrom,
      {
        id: 2,
        name: "John"
      },
      `(({ id: number; name: string } <-> ({ id: string; name: a non empty string; thing?: { id: number } } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> })) <-> PersonWithTransformFrom)
└─ From side transformation failure
   └─ ({ id: number; name: string } <-> ({ id: string; name: a non empty string; thing?: { id: number } } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> }))
      └─ Transformation process failure
         └─ Expected ({ id: number; name: string } <-> ({ id: string; name: a non empty string; thing?: { id: number } } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> })), actual {"id":2,"name":"John"}`
    )
    await Util.expectEncodeFailure(
      PersonWithTransformFrom,
      new PersonWithTransformFrom({ id: "2", name: "John", thing: O.some({ id: 1 }) }),
      `(({ id: number; name: string } <-> ({ id: string; name: a non empty string; thing?: { id: number } } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> })) <-> PersonWithTransformFrom)
└─ From side transformation failure
   └─ ({ id: number; name: string } <-> ({ id: string; name: a non empty string; thing?: { id: number } } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> }))
      └─ Transformation process failure
         └─ Expected ({ id: number; name: string } <-> ({ id: string; name: a non empty string; thing?: { id: number } } <-> { id: string; name: a non empty string; thing: Option<{ id: number }> })), actual {"id":"2","name":"John","thing":{"id":1}}`
    )
  })

  it("TaggedClass", () => {
    let person = new TaggedPersonWithAge({ id: 1, name: "John", age: 30 })

    expect(String(person)).toEqual(
      `TaggedPersonWithAge({ "_tag": "TaggedPerson", "id": 1, "age": 30, "name": "John" })`
    )
    expect(person._tag).toEqual("TaggedPerson")
    expect(person.upperName).toEqual("JOHN")

    expect(() => S.decodeUnknownSync(TaggedPersonWithAge)({ id: 1, name: "John", age: 30 })).toThrow(
      new Error(
        `({ _tag: "TaggedPerson"; id: number; age: number; name: a non empty string } <-> TaggedPersonWithAge)
└─ From side transformation failure
   └─ { _tag: "TaggedPerson"; id: number; age: number; name: a non empty string }
      └─ ["_tag"]
         └─ is missing`
      )
    )
    person = S.decodeUnknownSync(TaggedPersonWithAge)({
      _tag: "TaggedPerson",
      id: 1,
      name: "John",
      age: 30
    })
    expect(person._tag).toEqual("TaggedPerson")
    expect(person.upperName).toEqual("JOHN")
  })

  it("extending a TaggedClass with props containing a _tag field", async () => {
    class A extends S.TaggedClass<A>()("A", {
      id: S.number
    }) {}
    class B extends A.transformOrFail<B>()(
      { _tag: S.literal("B") },
      (input) => ParseResult.succeed({ ...input, _tag: "B" as const }),
      (input) => ParseResult.succeed({ ...input, _tag: "A" })
    ) {}

    await Util.expectDecodeUnknownSuccess(B, { _tag: "A", id: 1 }, new B({ _tag: "B", id: 1 }))
    await Util.expectEncodeSuccess(B, new B({ _tag: "B", id: 1 }), { _tag: "A", id: 1 })
  })

  it("TaggedError", () => {
    class MyError extends S.TaggedError<MyError>()("MyError", {
      id: S.number
    }) {}

    let err = new MyError({ id: 1 })

    expect(String(err)).toEqual(`MyError({ "_tag": "MyError", "id": 1 })`)
    expect(err.stack).toContain("Class.test.ts:")
    expect(err._tag).toEqual("MyError")
    expect(err.id).toEqual(1)

    err = Effect.runSync(Effect.flip(err))
    expect(err._tag).toEqual("MyError")
    expect(err.id).toEqual(1)

    err = S.decodeUnknownSync(MyError)({ _tag: "MyError", id: 1 })
    expect(err._tag).toEqual("MyError")
    expect(err.id).toEqual(1)
  })

  it("TaggedRequest", () => {
    class MyRequest extends S.TaggedRequest<MyRequest>()("MyRequest", S.string, S.number, {
      id: S.number
    }) {}

    let req = new MyRequest({ id: 1 })

    expect(String(req)).toEqual(`MyRequest({ "_tag": "MyRequest", "id": 1 })`)
    expect(req._tag).toEqual("MyRequest")
    expect(req.id).toEqual(1)
    expect(Request.isRequest(req)).toEqual(true)

    req = S.decodeSync(MyRequest)({ _tag: "MyRequest", id: 1 })
    expect(req._tag).toEqual("MyRequest")
    expect(req.id).toEqual(1)
    expect(Request.isRequest(req)).toEqual(true)
  })

  it("TaggedRequest extends SerializableWithExit", () => {
    class MyRequest extends S.TaggedRequest<MyRequest>()("MyRequest", S.string, S.NumberFromString, {
      id: S.number
    }) {}

    const req = new MyRequest({ id: 1 })
    assert.deepStrictEqual(
      Serializable.serialize(req).pipe(Effect.runSync),
      { _tag: "MyRequest", id: 1 }
    )
    assert(Equal.equals(
      Serializable.deserialize(req, { _tag: "MyRequest", id: 1 }).pipe(Effect.runSync),
      req
    ))
    assert.deepStrictEqual(
      Serializable.serializeExit(req, Exit.fail("fail")).pipe(Effect.runSync),
      { _tag: "Failure", cause: { _tag: "Fail", error: "fail" } }
    )
    assert.deepStrictEqual(
      Serializable.deserializeExit(req, { _tag: "Failure", cause: { _tag: "Fail", error: "fail" } })
        .pipe(Effect.runSync),
      Exit.fail("fail")
    )
    assert.deepStrictEqual(
      Serializable.serializeExit(req, Exit.succeed(123)).pipe(Effect.runSync),
      { _tag: "Success", value: "123" }
    )
    assert.deepStrictEqual(
      Serializable.deserializeExit(req, { _tag: "Success", value: "123" }).pipe(Effect.runSync),
      Exit.succeed(123)
    )
  })

  it("TaggedRequest context", () => {
    class MyRequest extends S.TaggedRequest<MyRequest>()("MyRequest", NameString, S.number, {
      id: IdNumber
    }) {}

    let req = new MyRequest({ id: 1 }, true)
    expect(String(req)).toEqual(`MyRequest({ "_tag": "MyRequest", "id": 1 })`)

    req = S.decode(MyRequest)({ _tag: "MyRequest", id: 1 }).pipe(
      Effect.provideService(Id, 1),
      Effect.runSync
    )
    expect(String(req)).toEqual(`MyRequest({ "_tag": "MyRequest", "id": 1 })`)

    assert.deepStrictEqual(
      Serializable.serialize(req).pipe(
        Effect.provideService(Id, 1),
        Effect.runSync
      ),
      { _tag: "MyRequest", id: 1 }
    )
    assert.deepStrictEqual(
      Serializable.deserialize(req, { _tag: "MyRequest", id: 1 }).pipe(
        Effect.provideService(Id, 1),
        Effect.runSync
      ),
      req
    )
    assert.deepStrictEqual(
      Serializable.serializeExit(req, Exit.fail("fail")).pipe(
        Effect.provideService(Name, "fail"),
        Effect.runSync
      ),
      { _tag: "Failure", cause: { _tag: "Fail", error: "fail" } }
    )
    assert.deepStrictEqual(
      Serializable.deserializeExit(req, { _tag: "Failure", cause: { _tag: "Fail", error: "fail" } })
        .pipe(
          Effect.provideService(Name, "fail"),
          Effect.runSync
        ),
      Exit.fail("fail")
    )
  })

  describe("encode", () => {
    it("struct + a class without methods nor getters", async () => {
      class A extends S.Class<A>()({
        n: S.NumberFromString
      }) {}
      await Util.expectEncodeSuccess(A, { n: 1 }, { n: "1" })
    })

    it("struct + a class with a getter", async () => {
      class A extends S.Class<A>()({
        n: S.NumberFromString
      }) {
        get s() {
          return "s"
        }
      }
      await Util.expectEncodeSuccess(A, { n: 1 } as any, { n: "1" })
    })

    it("struct + nested classes", async () => {
      class A extends S.Class<A>()({
        n: S.NumberFromString
      }) {}
      class B extends S.Class<B>()({
        a: A
      }) {}
      await Util.expectEncodeSuccess(S.union(B, S.NumberFromString), 1, "1")
      await Util.expectEncodeSuccess(B, { a: { n: 1 } }, { a: { n: "1" } })
    })

    it("class + a class with a getter", async () => {
      class A extends S.Class<A>()({
        n: S.NumberFromString
      }) {
        get s() {
          return "s"
        }
      }
      class B extends S.Class<B>()({
        n: S.NumberFromString,
        s: S.string
      }) {}

      await Util.expectEncodeSuccess(B, new A({ n: 1 }), { n: "1", s: "s" })
    })

    describe("encode(S.to(Class))", () => {
      it("should always return an instance", async () => {
        class A extends S.Class<A>()({
          n: S.NumberFromString
        }) {}
        const schema = S.to(A)
        await Util.expectEncodeSuccess(schema, new A({ n: 1 }), new A({ n: 1 }))
        await Util.expectEncodeSuccess(schema, { n: 1 }, new A({ n: 1 }))
      })

      it("should fail on bad values", async () => {
        class A extends S.Class<A>()({
          n: S.NumberFromString
        }) {}
        const schema = S.to(A)
        await Util.expectEncodeFailure(schema, null as any, "Expected A (an instance of A), actual null")
      })
    })
  })
})
