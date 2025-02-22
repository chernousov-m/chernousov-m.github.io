---
title: Backporting newer SwiftUI APIs
date: 2025-02-23
description: Today we'll find a way to use a couple of newer SwiftUI APIs in earlier versions of the operating system.
---
# Backporting newer SwiftUI APIs to older OS versions
When you need to support older versions of iOS, you often can't just use all the newer APIs you see at WWDC. At the very least, you'll wait a couple of years before you can try them in the project you're working on. Today we'll see how we can backport some of the newer APIs to earlier versions of the OS.

## Table of contents

- [[backport#onChange(of perform )|onChange(of:perform:)]]
- [[backport#onGeometryChange(for of action )|onGeometryChange(for:of:action:)]]
- [[backport#Transition|Transition]]
- [[backport#Scoped animation and transaction|Scoped animation and transaction]]
- [[backport#Conclusion|Conclusion]]
- [[backport#Full code|Full code]]

> [!warning]
> This code is not extensively tested, and its behavior may be slightly different from the original. This is because some of the original behavior is not documented well.
# onChange(of:perform:)

First, let's define the result we need. The documentation for the modifier states, "Adds an action to perform when the given value changes." There is also some example code, showing us how to use it.

```swift
struct MyScene: Scene {
	@Environment(\.scenePhase) private var scenePhase
	@StateObject private var cache = DataCache()

	var body: some Scene { 
		WindowGroup {
			MyRootView()
		}
		.onChange(of: scenePhase) { newScenePhase in 
			if newScenePhase == .background {
				cache.empty()
			}
		}
	}
}
```

Let's start with the modifier.
```swift
struct OnChangeModifier<Value: Equatable>: ViewModifier {
	let perform: (Value) -> Void
	let currentValue: Value

	init(
		perform operation: @escaping (Value) -> Void,
		value: Value
	) {
		perform = operation
		currentValue = value
	}

	func body(content: Content) -> some View {
		/*...*/
	}
}

extension View {
	func onChange<Value: Equatable>(
		of value: Value,
		perform operation: @escaping (_ newValue: Value) -> Void
	) -> some View {
		modifier(OnChangeModifier(perform: operation, value: value))
	}
}
```
Now, how do we call the function when the value changes? Well, the only way to compare the value to the previous one is to store the previous one.
```swift
struct OnChangeModifier<Value: Equatable>: ViewModifier {
	let perform: (Value) -> Void
	let currentValue: Value
	
	/*@START_HIGHLIGHT@*/@State/*@END_HIGHLIGHT@*/
	/*@START_HIGHLIGHT@*/var oldValue: Value/*@END_HIGHLIGHT@*/

	init(
		perform operation: @escaping (Value) -> Void,
		value: Value
	) {
		perform = operation
		currentValue = value
		/*@START_HIGHLIGHT@*/_oldValue = .init(wrappedValue: value)/*@END_HIGHLIGHT@*/
	}

	func body(content: Content) -> some View {
		/*...*/
	}
}
```

This gives us storage, but we know that the `State` is only initialized once. We also need a way to run some code every time the `body(content:)` is evaluated. 

```swift
struct OnChangeModifier<Value: Equatable>: ViewModifier {
	let perform: (Value) -> Void
	let currentValue: Value
	
	@State
	var oldValue: Value

	init(
		perform operation: @escaping (Value) -> Void,
		value: Value
	) {
		perform = operation
		currentValue = value
		_oldValue = .init(wrappedValue: value)
	}

	func body(content: Content) -> some View {
		/*@START_HIGHLIGHT@*/if currentValue != oldValue {/*@END_HIGHLIGHT@*/
		/*@START_HIGHLIGHT@*/	perform(currentValue)/*@END_HIGHLIGHT@*/
		/*@START_HIGHLIGHT@*/	oldValue = currentValue/*@END_HIGHLIGHT@*/
		/*@START_HIGHLIGHT@*/}/*@END_HIGHLIGHT@*/
		return content
	}
}
```

If we try to use the modifier, we get the following runtime error.
> [!bug]
> Modifying state during view update, this will cause undefined behavior.

This is because the `body(content:)` is evaluated in response to some state change so the view hierarchy gets rebuilt, and changing state in this method doesn't really makes sense. When you think of it, it leads to infinite recursion.
But this doesn't happen when we use built-in SwiftUI modifiers to change the state (e.g. `onAppear(perform:)`). Well, we need a way to use a built-in modifier, that allows us to run some code. There are not that many modifiers, that suit us. But there is one that will help us.

We'll use `onReceive` modifier. It accepts some Combine `Publisher` and calls the closure when it receives a value from it. While most Combine publishers do "transmit a sequence of values over time," there is one publisher that **just** "returns" a single value and finishes. And it's called `Just`. We can use it to call the closure after every view update. And that's exactly what we need.

```swift
/*@START_HIGHLIGHT@*/import Combine/*@END_HIGHLIGHT@*/

struct OnChangeModifier<Value: Equatable>: ViewModifier {
	let perform: (Value) -> Void
	let currentValue: Value
	
	@State
	var oldValue: Value

	init(
		perform operation: @escaping (Value) -> Void,
		value: Value
	) {
		perform = operation
		currentValue = value
		_oldValue = .init(wrappedValue: value)
	}

	func body(content: Content) -> some View {
		content
			/*@START_HIGHLIGHT@*/.onReceive(Just(currentValue)) { value in/*@END_HIGHLIGHT@*/
			/*@START_HIGHLIGHT@*/	if oldValue != value {/*@END_HIGHLIGHT@*/
			/*@START_HIGHLIGHT@*/		perform(value)/*@END_HIGHLIGHT@*/
			/*@START_HIGHLIGHT@*/		oldValue = value/*@END_HIGHLIGHT@*/
			/*@START_HIGHLIGHT@*/	}/*@END_HIGHLIGHT@*/
			/*@START_HIGHLIGHT@*/}/*@END_HIGHLIGHT@*/
	}
}
```

And it works! We can now react to state changes even on iOS 13.

# onGeometryChange(for:of:action:)
This one is the simplest to implement. And it's backported to iOS 16 by Apple. But we can do better. We'll use overlay with `GeometryReader` to get the geometry for a view. 
```swift
extension View {
	func onGeometryChange<T: Equatable>(
		for type: T.Type,
		of transform: @escaping (GeometryProxy) -> T,
		action: @escaping (T) -> Void
	) -> some View {
		overlay(
			GeometryReader { proxy in
				Color.clear
					.onChange(of: transform(proxy)) { newValue in
						action(newValue)
					}
			}
		)
	}
}
```
And that's it. We have a working modifier for iOS 14 (iOS 13 if we use our own `onChange(of:perform)`. 
# Transition

There is a special protocol for defining custom transitions available from iOS 17. Custom transitions are crucial to great UI. Let's backport this API. First, we copy all the stuff we need from the original protocol.

```swift
public enum TransitionPhase: Hashable {
	case willAppear
	case identity
	case didDisappear

	public var isIdentity: Bool {
		switch self {
		case .willAppear: false
		case .identity: true
		case .didDisappear: false
		}
	}
}

public struct TransitionProperties: Sendable {
	public init(hasMotion: Bool = true) { self.hasMotion = hasMotion }

	public var hasMotion: Bool
}

public protocol Transition: /*@START_HIGHLIGHT@*/DynamicProperty/*@END_HIGHLIGHT@*/ {
    associatedtype Body : View

    @ViewBuilder 
    func body(content: Self.Content, phase: TransitionPhase) -> Self.Body

    static var properties: TransitionProperties { get }

    /*@START_HIGHLIGHT@*/typealias Content = AnyView/*@END_HIGHLIGHT@*/
}
```

We changed the type of `Content`. We use `AnyView` as there is no way to initialize `PlaceholderContentView` for us. Also, we conform it to `DynamicProperty`. This is because we'll need to support `@State` and `@Endvironment` variables in the transitions. More about that [[styling#`DynamicProperty`|here]]

Now, how do we implement it? Well, it turns out that `AnyTransition` already contains all the building blocks for us. There are several `AnyTransition`'s methods that can help us.
```swift
extension AnyTransition {
    public func combined(with other: AnyTransition) -> AnyTransition
}

extension AnyTransition {
    public static func modifier<E: ViewModifier>(
		active: E, 
		identity: E
	) -> AnyTransition
}

extension AnyTransition {
	public static func asymmetric(
		insertion: AnyTransition, 
		removal: AnyTransition
	) -> AnyTransition
}
```
And all of them are available since the first release of SwiftUI! Ok, but how do we use them? Well, if you look at our `Transition`'s `body` method, you'll see that it kinda looks like `ViewModifier`'s body. So we're going to use a custom `ViewModifier` to apply the modifications from our `Transition`.

```swift
struct TransitionModifier<T: Transition>: ViewModifier {
	let phase: TransitionPhase
	let transition: T

	func body(content: Content) -> some View {
		transition.body(content: AnyView(content), phase: phase)
	}
}
```
Now we use `AnyTransition.modifier(active:identity:)` to construct our transition. But it only has two states: active and identity. While our `TransitionPhase` has three states. Well, this is because our transition can be asymmetric. And there is also a special function for that.

```swift
extension AnyTransition {
	init(_ t: some Transition) {
		self = .asymmetric(
			insertion: .modifier(
				active: TransitionModifier(phase: .willAppear, transition: t),
				identity: TransitionModifier(phase: .identity, transition: t)
			),
			removal: .modifier(
				active: TransitionModifier(phase: .didDisappear, transition: t),
				identity: TransitionModifier(phase: .identity, transition: t)
			)
		) 
	}
}
```

Now, we have a working `Transition` protocol. But we also completely ignored the `Transition.properties`. This variable holds our `TransitionProperties` struct that has only one field - `hasMotion`. When the Reduce Motion setting is active and a transition `hasMotion`, it is replaced by `.opacity`. Let's change our `TranstionModifier` a bit.
> [!warning]
> As of iOS 17, this aspect of the SwiftUI's `Transition` doesn't seem to work at all! But we're going to implement it nonetheless.

```swift
struct TransitionModifier<T: Transition>: ViewModifier {
	/*@START_HIGHLIGHT@*/@Environment(\.accessibilityReduceMotion)/*@END_HIGHLIGHT@*/
	/*@START_HIGHLIGHT@*/var reduceMotion/*@END_HIGHLIGHT@*/

	let phase: TransitionPhase
	let transition: T

	func body(content: Content) -> some View {
		transition
			.body(
				content: AnyView(content),
				/*@START_HIGHLIGHT@*/phase: reduceMotion ? .identity : phase/*@END_HIGHLIGHT@*/
			)
			/*@START_HIGHLIGHT@*/.opacity(opacity)/*@END_HIGHLIGHT@*/
	}

	/*@START_HIGHLIGHT@*/var opacity: Double {/*@END_HIGHLIGHT@*/
	/*@START_HIGHLIGHT@*/	guard !phase.isIdentity else { return 1 }/*@END_HIGHLIGHT@*/
	/*@START_HIGHLIGHT@*/	return reduceMotion ? 0 : 1/*@END_HIGHLIGHT@*/
	/*@START_HIGHLIGHT@*/}/*@END_HIGHLIGHT@*/
}
```
And now it works even better than the SwiftUI's version of the protocol! 
# Scoped animation and transaction

These ones are little tricky, but there are instruments that'll help us. First, let's write our modifiers. We use `AnyView` because we cannot use `PlaceholderContentView<Value>`, it's API is not public.
```swift
extension View {
	func animation(
		_ animation: Animation,
		@ViewBuilder body: (/*@START_MENU_TOKEN@*/AnyView/*@END_MENU_TOKEN@*/) -> some View
	) -> some View {
		/*...*/
	}

	func transaction(
		_ transform: @escaping (inout Transaction) -> Void,
		@ViewBuilder body: (/*@START_MENU_TOKEN@*/AnyView/*@END_MENU_TOKEN@*/) -> some View
	) -> some View {
		/*...*/
	}
}
```
Let's leave it for now. How do we apply transactions (and animations) to a subset of the view hierarchy? Well, it turns out, all we need is already there. If we look closer at `ViewModifier`, we'll find that it has two functions, namely `animation(_:)` and `transaction(_:)`. Those are the functions that we'll use to implement the scoped animation and transaction modifier. First, we need a modifier that we can construct using closure.
```swift
struct ScopedModifier<Body: View>: ViewModifier {
	@ViewBuilder
	let makeBody: (AnyView) -> Body

	func body(content: AnyView) -> Body {
		makeBody(AnyView(content))
	}
}
```
Why do we type-erase already type-erased `Content`, you ask? Well, because most of the `View`s out there are generic, and they wrap the views you pass into them. Not only the `ViewModifier`'s `Content` type is generic, it also references the modifier itself. Something along these lines:
```swift
protocol ViewModifier {
	associatedtype Body: View

	typealias Content = SomeGenericView<Self>
}
```
And if we try to use the modifier content while not erasing type, we'll find ourselves in a situation where the type of our modifier references itself, because our `Body` type will be just `Content` with some modifiers applied. So we'll need to erase it somewhere. Now let's return to our modifiers.
```swift
extension View {
	func animation(
		_ animation: Animation?,
		@ViewBuilder body: (AnyView) -> some View
	) -> some View {
		modifier(
			ScopedModifier(makeBody: body)
				.animation(animation)
		)
	}

	func transaction(
		_ transform: @escaping (inout Transaction) -> Void,
		@ViewBuilder body: (AnyView) -> some View
	) -> some View {
		modifier(
			ScopedModifier(makeBody: body)
				.transaction(transform)
		)
	}
}
```
And we immediately get an error.
> [!error]
> Escaping closure captures non-escaping parameter 'body'

We could try building body before passing it to the modifier.
```swift
extension View {
	func animation(
		_ animation: Animation?,
		@ViewBuilder body: (Self) -> some View
	) -> some View {
		let body = body(self)
		return modifier(
			ScopedModifier { _ in body }
				.animation(animation)
		)
	}

	func transaction(
		_ transform: @escaping (inout Transaction) -> Void,
		@ViewBuilder body: (Self) -> some View
	) -> some View {
		let body = body(self)
		return modifier(
			ScopedModifier { _ in body }
				.transaction(transform)
		)
	}
}
```
This is almost equivalent to the previous version. Almost. You see, this way both the transaction and the animation is applied to the whole `View`, while the `ViewModifier`'s ones are applied to the modifications only. This is what we need, but how do we separate modifications from the view that's being modified? Well, we don't have a lot of choice here, we need to set the view we show from outside no matter how deep our placeholder view is in the hierarchy. What can help us? Right, the environment.
```swift
extension EnvironmentValues {
	enum ActualViewKey: EnvironmentKey {
		static var defaultValue: AnyView = AnyView(Color.clear)
	}

	var actualView: AnyView {
		get { self[ActualViewKey.self] }
		set { self[ActualViewKey.self] = newValue }
	}
}
struct PlaceholderView<Value>: View {
	@Environment(\.actualView)
	var view

	var body: some View {
		view
	}
}
```

And now we can use it to separate the view from modifications.
```swift
extension View {
	func animation(
		_ animation: Animation?,
		@ViewBuilder body: (PlaceholderView<Self>) -> some View
	) -> some View {
		let body = body(PlaceholderView())
		return modifier(
			ScopedModifier { body.environment(\.actualView, $0) }
				.animation(animation)
		)
	}

	func transaction(
		_ transform: @escaping (inout Transaction) -> Void,
		@ViewBuilder body: (PlaceholderView<Self>) -> some View
	) -> some View {
		let body = body(PlaceholderView())
		return modifier(
			ScopedModifier { body.environment(\.actualView, $0) }
				.transaction(transform)
		)
	}
}
```

And now our modifiers don't affect the animations outside their scope. Cool, right?

# Conclusion
Today we successfully backported quite a few features from newer versions of SwiftUI back to iOS 13! Sometimes our implementation works even better than the original one. The main purpose of this article is to show you that it is often possible to bypass SwiftUI's limitations using the instruments we have.