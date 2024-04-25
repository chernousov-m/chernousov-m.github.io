---
title: The hidden (in plain sight) power of KeyPaths
date: 2024-04-22
aliases:
  - The hidden (in plain sight) power of KeyPaths
---
# The hidden (in plain sight) power of `KeyPath`s
`KeyPath`s - they're everywhere nowadays. Let's explore how we can design better APIs with them and have some fun along the way.

# Lenses
Before we begin exploring `KeyPath`s in the wild, let us start with a little history overview and take a look at their ancestors, Lenses - which came to our world (as many other really useful things) from functional programming. 
I won't give any Haskell (or other functional language) code for the examples, mainly because I can't really read it, but Swift is more than enough to follow the concept. 
As you might already know, all the data in functional programming is basically immutable. We won't dive into how that works and how to manage state (e.g., a bank account), but we need to set the constraint to our code examples in order to understand the very purpose of lenses. So let's assume that we cannot create mutable properties, and all of them are `let`s. 
Suppose we're writing a simple game engine:
```swift
enum Event { /*...*/ }

struct Vector {
	let x: Double
	let y: Double
	let z: Double
}

struct Player {
	let location: Vector
	let camera: Vector
}

func getNewState(player: Player, event: Event) -> Player {
	/*...*/
}
```
What we have here is an `Event` - something that triggers a state update (the user taps a button or whatever), a `Vector` that can represent both the location of our player and the direction of their camera, `Player` itself, and a function to handle events and update the state of the player. Right now, everything's easy. Now let's add some logic. 

```swift
enum Event {
	case left
	case right
	/*...*/
}

func getNewState(player: Player, event: Event) -> Player {
	switch event {
		case .left:
			Player(
				location: Vector(
					x: player.location.x - 1,
					y: player.location.y,
					z: player.location.z
				),
				camera: player.camera
			)
		case .right:
			Player(
				location: Vector(
					x: player.location.x + 1,
					y: player.location.y,
					z: player.location.z
				),
				camera: player.camera
			)
	}
} 
```
It seems like too much code for a simple property change. And now the concept of lenses arrives. Lenses are just getters and setters; we can implement them ourselves:
```swift
struct Lens<Root, Value> {
	let get: (Root) -> Value
	let set: (Root, Value) -> Root
}
```
A lens in our case is a simple struct that has two functions: one for getting `Value` out of `Root` type and another for setting it (though because of immutability, it returns a new instance of `Root`). Now we can define a lens for getting and setting the `x` value of our `Player`'s `location`:
```swift
let locationXLens = Lens<Player, Double>(
	get: {
		$0.location.x
	},
	set: { player, value in
		Player(
			location: Vector(
				x: value,
				y: player.location.y,
				z: player.location.z
			),
			camera: player.camera
		)
	}
)

func getNewState(player: Player, event: Event) -> Player {
	switch event {
		case .left:
			locationXLens.set(player, locationXLens.get(player) - 1)
		case .right:
			locationXLens.set(player, locationXLens.get(player) + 1)
	}
} 
```
Now it's better, but there's still too much code for a simple property change. Some languages provide some mechanism for generating lenses for the type. Now, the coolest thing about lenses is that they are composable by nature. You can combine two lenses given their types are properly aligned:
```swift
extension Lens {
	func compose<NewValue>(
		with other: Lens<Value, NewValue>
	) -> Lens<Root, NewValue> {
		return .init(
			get: {
				other.get(self.get($0))
			},
			set: { root, value in
				self.set(root, other.set(self.get(root), value))
			}
		)
	}
}
```
Now we can create lenses and combine them any way we like:
```swift
let player = Player(/*...*/)

let locationLens = Lens<Player, Vector>(
	get: {
		$0.location
	},
	set: { player, location in
		Player(location: location, camera: player.camera)
	}
)

let cameraLens = Lens<Player, Vector>(
	get: {
		$0.camera
	},
	set: { player, camera in
		Player(location: player.location, camera: camera)
	}
)

let xLens = Lens<Vector, Double>(
	get: { $0.x },
	set: { vector, x in
		Vector(x: x, y: vector.y, z: vector.z)
	}
)

// Compose lenses to get location.x lens and camera.x lens

let cameraXLens = cameraLens.compose(with: xLens)
let locationXLens = locationLens.compose(with: xLens)

let cameraX = cameraXLens.get(player) // x value of the player's camera vector
let newPlayer = locationXLens.set(
	player,
	locationXLens.get(player) + 1
) // a player whose location's x value is incremented by 1
```
Now that we have a basic overview of lenses - let's explore what the `KeyPath`s are.

# `KeyPath`s
In Swift, `KeyPath`s are basically Lenses (but some of them are read-only) with a significantly better API for a language that supports mutation. They are also parametrized types with `Root` and `Value` parameters that allow us to read (or write) `Value`s of the `Root` type:
```swift
public class KeyPath<Root, Value>: PartialKeyPath<Root> {}
```
Disregard `PartialKeyPath` for now, we'll talk about the type hierarchy later.
The easiest way to get a `KeyPath` instance is by using a key path literal:
```swift
let keyPath = \Player.location // KeyPath<Player, Vector>
```
When the compiler knows the `Root` type (either with explicit type or type inference) - you can omit it in the literal:
```swift
let keyPath: KeyPath<Player, _> = \.location
```
Every type in Swift has a special subscript that accepts a `KeyPath` and returns a value on the given path:
```swift
func getDouble<Root>(from root: Root, keyPath: KeyPath<Root, Double>) -> Double {
	root/*@START_HIGHLIGHT@*/[keyPath: keyPath]/*@END_HIGHLIGHT@*/
}
```
Likewise, `WritableKeyPaths` can be used to write properties:
```swift
func setDouble<Root>(
	to root: inout Root, 
	keyPath: WritableKeyPath<Root, Double>, 
	_ value: Double
) {
	root[keyPath: keyPath] = value
}
```
## The type hierarchy
As you've seen already, `KeyPath`s are classes, and there is inheritance involved. 
The classes form the following type tree: `AnyKeyPath -> PartialKeyPath<Root> -> KeyPath<Root, Value> -> WritableKeyPath<Root, Value> -> ReferenceWritableKeyPath<Root, Value>`
Here is the overview of what they are and what they are useful for:
 - `AnyKeyPath` is the root base class for all the `*KeyPath` types. Conforms to `Hashable`, so the other types are `Hashable` as well, which means they can be used as a `Key` in dictionaries. As the name implies - it is a type-erased version of `KeyPath`.
- `PartialKeyPath<Root>`  is another type-erased version of `KeyPath`, but this time only the `Value` type is erased. We can't use it on any type other than `Root`, but we always get `Any` as the return value of the `KeyPath`-based subscript.
- `KeyPath<Root, Value>` - is the most commonly used version of them all. It has both `Root` and `Value` types and it can be used to read the value from the `Root`.
- `WritableKeyPath<Root, Value>` is, as the name implies, a version of `KeyPath` that allows us to write properties and not only read them.
- `ReferenceWritableKeyPath<Root, Value>` is the version that allows mutating properties without mutating the object itself (reference semantics). Most of the time, these are `KeyPath`s to class member properties, but `nonmutating set` also counts for these `KeyPath`s.
## The cool things about `KeyPath`s

### 1. `KeyPath` literal to function conversion
`KeyPath` literals can be converted to functions that have the following signature:
```swift
(Root) -> Value
```
This allows us to use APIs that accept closures passing `KeyPath`s instead:
```swift
let array = [0, 1, 2, 3] 

let descriptions = array.map(\.description) // ["0", "1", "2", "3"]
```
### 2. Composability
As in our example of lenses, `KeyPath`s are composable - you can combine them using the `appending(path:)` method that gives you a new `KeyPath` out of two:
```swift
let locationKeyPath = \Player.location
let xKeyPath = \Vector.x

let playerToLocationXKeyPath = locationKeyPath.appending(path: xKeyPath)
// same as \Player.location.x
```
### 3. Subscript access
`KeyPath`s can represent subscript access with all the parameters embedded in it. That means we can use `KeyPath`s to access a specific element in Array, for example. But there's more: we can pass parameters to any subscript, including custom ones, the only restriction for the parameters is that the types of them must be `Hashable`.
```swift
let arrayFirst: KeyPath<[Int], Int?> = \.first
let arrayFirstUnwrapped: KeyPath<[Int], Int> = \.[0]
```

### 4. `@dynamicMemberLookup`
There is a special attribute in Swift that allows our types to define custom attributes and access them via so called "dot syntax". All we need to do is implement a special subscript that accepts a parameter with a `dynamicMember` label. The parameter must be either an `ExpressibleByStringLiteral` or a `KeyPath`. That is the only constraint. The subscript can be generic, it can return any type we like, it can be get/set or read-only - it's up to you to decide what it will be:
```swift
@dynamicMemberLookup
struct Wrapper<Wrapped> {
	var wrapped: Wrapped

	subscript<T>(dynamicMember keyPath: KeyPath<Wrapped, T>) -> T {
		wrapped[keyPath: keyPath]
	}
	
	subscript<T>(dynamicMember keyPath: WritableKeyPath<Wrapped, T>) -> T {
		get { wrapped[keyPath: keyPath] }
		set { wrapped[keyPath: keyPath] = newValue }
	}

	subscript<T>(
		dynamicMember keyPath: ReferenceWritableKeyPath<Wrapped, T>
	) -> T {
		get { wrapped[keyPath: keyPath] }
		nonmutating set { wrapped[keyPath: keyPath] = newValue }
	}
}
```
### 5. Type inference
The type inference works well with `KeyPath`s. When the compiler knows the type of the `KeyPath`, you can omit the `Root` in literals and, most importantly, change the types in the middle of it:
```swift
let intWidthKeyPath: KeyPath<Int, Int> = \.description.count
```
Even when the `Value` type is unknown, the compiler can understand the result:
```swift
let intWidthKeyPath: KeyPath<Int, _> = \.description.count
```


Now let's have some fun with them, shall we?

## The use cases

### `dynamicMemberLookup` inheritance
The `@dynamicMemberLookup` attribute on protocols is (as expected) inherited by conforming types. So suppose we have a `protocol ViewModel` that all our `ViewModel`s conform to. We can add some properties to all of them using extension on that protocol without adding properties individually to the types or exposing the origin of those properties:
```swift
public struct Dependencies {
	@TaskLocal
	 static var current: Dependencies = .init(
		logger: .shared,
		analytics: .shared
	)

	public var logger: Logger
	public var analytics: Analytics
}

@dynamicMemberLookup
public protocol ViewModel: ObservableObject {
	subscript<T>(dynamicMember keyPath: KeyPath<Dependencies, T>) -> T { get }
}

public extension ViewModel {
	subscript<T>(dynamicMember keyPath: KeyPath<Dependencies, T>) -> T {
		Dependencies.current[keyPath: keyPath]
	}
}
```
And now all our `ViewModel`s can use the global dependencies without having to store them individually:
```swift
final class VM: ViewModel {
	func buttonTapped() {
		self.logger.info("Tapped a button")
		self.analytics.send("Opening a screen")
	}
}
```

### Design system colors (or other tokens) as `KeyPath`s
We can define our color tokens with `KeyPath`s:
```swift
struct ColorGuide {}

typealias ColorToken = KeyPath<ColorGuide, Color>
```
Which gives us the following advantages (assuming we remember all the cool things). First, we can group tokens:
```swift
struct ColorGuide {
	struct Backgrounds {
		let primary: Color = .white
		let secondary: Color = .gray
	}

	var backgrounds: Backgrounds { .init() }
}
```
This gives us more control over the correctness of API usage, we allow only tokens from a specific group to be a background color:
```swift
extension View {
	func background(_ token: ColorToken) -> some View {
		backgroundStyle(ColorGuide()[keyPath: token])
	}
}
```
This is cool, but `enum`s can do it. But we can have more. Suppose we have to change the opacity of the selected token for certain components in our design system. But all our APIs accept only tokens.
Properties can be computed, meaning they can be functions, but subscripts are real functions in the sense that they can accept parameters. We can add a subscript to `Color` and call it through `KeyPath`. This basically means that we can call any function through them. The only thing we need for it is to define the subscript:
```swift
extension Color {
	subscript(opacity value: Double) -> Color {
		self.opacity(value)
	}
}

let kp = \Color.black[opacity: 0.5]
```
Even more, because `KeyPath`s can change types in the middle, we can make those transformations look like a function call with fancy square brackets:
```swift
extension Color {
	struct Opacity {
		let color: Color

		subscript(value: Double) -> Color {
			color.opacity(value)
		}
	}
	var opacity: Opacity { .init(color: self) }
}

let kp: ColorToken = \.backgrounds.primary.opacity[0.5]
```
Which of these methods to use is up to you. Personally, I prefer the former for cases where I need to internally apply multiple modifiers in a quick succession:
```swift
func transform(userToken: ImageToken) -> ImageToken {
	userToken.appending(
		path: \.resizable[renderingMode: .template][antialiased: true]
	)
}
```
And latter for the external APIs (especially the ones that accept more than one parameter) as it looks more like a function call and hence reads easier at the call site:
```swift
var body: some View {
	Icon(\.info.combined[with: .triangle].mode[.fill])
		.frame(width: 100, height: 100)
}
```

### Bonus feature
Sometimes we might need to parametrize `KeyPath`s with types rather than plain values, but we can't just pass types as parameters:
```swift
@Environment(\.[MyEnvKey.self])
var myEnvProperty
// Error: Subscript index of type 'MyEnvKey.Type' in a key path must be Hashable
```
That is expected. `MyEnvKey.Type` cannot be `Hashable` or conform to any protocol. But we can make a generic type that is `Hashable` and use its value to parametrize the subscript:
```swift
struct KeyWrapper<Wrapped: EnvironmentKey>: Hashable {}

extension EnvironmentValues {
	subscript<Wrapped: EnvironmentKey>(
		wrapper: KeyWrapper<Wrapped>
	) -> Wrapped.Value {
		get { self[Wrapped.self] }
		set { self[Wrapped.self] = newValue }
	}
}

struct MyView: View {
	@Environment(\.[KeyWrapper<MyEnvKey>()])
	var myEnvProperty // No error
}
```
Rarely are we going to need it, but sometimes it's really useful. You'll see the concrete use case for this in the next article.
# Conclusion
`KeyPath`s are essential tools for crafting modern APIs. They simplify data manipulation tasks and seamlessly integrate with Swift. `KeyPath`s offer versatility and efficiency, allowing for cleaner code and improving overall development. With `KeyPath`s, you can create better APIs and streamline your coding process. 
See you in the [[styling|next article]].