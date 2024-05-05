---
title: Generalizing styling APIs for SwiftUI components
date: 2024-05-05
description: When you need to develop an app using SwiftUI, you will inevitably end up building your design system. And your components will require their own styling. Let's design the API for that
show-toc: "true"
---
# Generalizing styling APIs for SwiftUI components.
>[!warning]
>This article is long. Just reading it takes about half an hour. And if you want to play with the examples, you'll need even more time. So make sure you allocate enough of it, or read it in parts. Also, I highly recommend that you read the [[keypaths|previous article]] before you read this one


When you need to develop an app using SwiftUI, you will inevitably end up building your own design system. And your components will require their own styling. Let's design the API for that.

---
# SwiftUI style's anatomy
There are plenty of built-in styles in SwiftUI. `ButtonStyle`, `LabelStyle`, `ProgressViewStyle`, and many others. And almost all of them follow the same pattern:
```swift
public struct ButtonStyleConfiguration {
	public struct Label: View { /*...*/ }

	public let label: Label
	public let isPressed: Bool
}

public protocol ButtonStyle {
	associatedtype Body: View
	typealias Configuration = ButtonStyleConfiguration

	@ViewBuilder 
	func makeBody(configuration: Configuration) -> Body
}
```
What we have here is a protocol for a style that makes a `View` out of the configuration. In the `ButtonStyle` case, the configuration contains its label and `isPressed` property indicating whether the button is pressed at the moment. First, let's recreate that, and then we'll try to make it universal for all of our components.

# Our own style
To begin, let's create the `View` we're going to style:
```swift
public struct Badge: View {
	public let text: String
	public let image: Image?

	public var body: some View {
		HStack {
			Text(text)
			image
		}
		.padding()
		.background {
			Capsule().fill(.background)
		}
	}
}
```
Now, we are already able to change the background color with the `backgroundStyle(_:)` modifier. But we also want to let users of our design system change the layout of our badge. Perhaps they want to change the padding or the order of the views in `HStack`, or even replace `HStack` with `VStack`. Instead of putting all the imaginable properties in the environment, let's create a `BadgeStyle` protocol to make it configurable the SwiftUI way:
```swift
public struct BadgeStyleConfiguration {
	public let text: String
	public let image: Image?
}

public protocol BadgeStyle {
	associatedtype Body: View
	typealias Configuration = BadgeStyleConfiguration

	@ViewBuilder
	func makeBody(configuration: Configuration) -> Body
}
```
And we also create the conforming type so that we can test its behaviour:
```swift
public struct DefaultBadgeStyle: BadgeStyle {
	public func makeBody(configuration: Configuration) -> some View {
		HStack {
			Text(configuration.text)
			configuration.image
		}
		.padding()
		.background {
			Capsule().fill(.background)
		}
	}
}
```
As you might know already, the `ButtonStyle` can be applied to any view in the view hierarchy. That means there is the environment involved. We also need that because we might want to specify a style for multiple badges at once somewhere higher in the hierarchy, so we create our environment value:
```swift
extension EnvironmentValues {
	private enum BadgeStyleKey: EnvironmentKey {
		static var defaultValue: any BadgeStyle {
			DefaultBadgeStyle()
		}
	}

	var badgeStyle: any BadgeStyle {
		get { self[BadgeStyleKey.self] }
		set { self[BadgeStyleKey.self] = newValue }
	}
}

public extension View {
	func badgeStyle<Style: BadgeStyle>(_ style: Style) -> some View {
		environment(\.badgeStyle, style)
	}
}
```
Note that we use `any BadgeStyle`. We can't know the concrete type of style that will be applied by the user, so we store it as `any`.
Now let's change our badge to use the style from the environment:
```swift
public struct Badge: View {
	public let text: String
	public let image: Image?

	@Environment(\.badgeStyle)
	var style

	public var body: some View {
		style.makeBody(configuration: configuration)
	}

	var configuration: ButtonStyleConfiguration {
		.init(text: text, image: image)
	}
}
```
And we get the error: 

> [!error]
> Type 'any View' cannot conform to 'View'

Because we use `any BadgeStyle`, our `makeBody(configuration:)` method now also returns `any View`. The reason is the same - we can't know the concrete type, and even if we did - it can change, so the return type of our method is erased as well. We can easily fix this by using `AnyView` (it's okay to use it, see [[styling#Type erasure|the side note]] on type erasure usage):
```swift
extension BadgeStyle {
	func erasedBody(configuration: Configuration) -> AnyView {
		AnyView(makeBody(configuration: configuration))
	}
}

public struct Badge: View {
	public let text: String
	public let image: Image?

	@Environment(\.badgeStyle)
	var style

	public var body: some View {
		style.erasedBody(configuration: configuration)
	}

	var configuration: ButtonStyleConfiguration {
		.init(text: text, image: image)
	}
}
```
Now our code compiles. Cool! We can define our own styles and use them to style our badge. We can use this pattern to build styling for every component in our design system with a few lines of code for each component. But there's a problem, though.
## `@Environment` and friends
At some point in the future your colleague will come to you with the following code, which doesn't work:
```swift
struct ColorSchemeBadgeStyle: BadgeStyle {
	@Environment(\.colorScheme)
	var colorScheme

	func makeBody(configuration: Configuration) -> some View {
		HStack {
			Text(configuration.text)
			configuration.image
		}
		.padding()
		.background {
			Capsule().fill(colorScheme == .light ? Color.blue : .red)
		}
	}
}
```
The `Environment` property wrapper doesn't work with our `BadgeStyle`, nor do any other SwiftUI property wrappers. When you run this code, you get the following runtime warning:
> [!bug]
> Accessing Environment\<ColorScheme\>'s value outside of being installed on a View. This will always read the default value and will not update.

This gives us a clue. Our `BadgeStyle` is not `View` (or `ViewModifier`, `ButtonStyle`, `Shape`, or any other built-in protocol that supports those property wrappers). We need to somehow "install" the wrappers on a `View`. One way to do it is to create an intermediate `View`:
```swift
struct ColorSchemeBadgeStyle: BadgeStyle {
	private struct Intermediate: View {
		@Environment(\.colorScheme)
		var colorScheme

		let configuration: Configuration

		var body: some View {
			HStack {
				Text(configuration.text)
				configuration.image
			}
			.padding()
			.background {
				Capsule().fill(colorScheme == .light ? Color.blue : .red)
			}
		}
	}

	func makeBody(configuration: Configuration) -> some View {
		Intermediate(configuration: configuration)
	}
}
```
But that is quite heavy boilerplate to write every time we need to use `Environment` or  `State`. Luckily, there is another way.  

## `DynamicProperty`
If you look at the documentation for `Environment` (or any other SwiftUI property wrapper), you'll see that it conforms to the special protocol `DynamicProperty`. When the value of the type conforming to this protocol is inside a `View` as a property, "the view gives values to these properties prior to recomputing the view’s `body`", the documentation states. It also happens recursively; we can define our own `DynamicProperty` using existing ones:
```swift
@propertyWrapper
struct DefaultingState<Value>: DynamicProperty {
	@State
	var state: Value
	@Environment(\.useDefaultValue) // our custom environment propery
	var useDefault: Bool
	let defaultValue: Value

	var wrappedValue: Value {
		get {
			if useDefault {
				defaultValue
			} else {
				state
			}
		}
		nonmutating set {
			state = newValue
		}
	}

	init(wrappedValue: Value, `default`: Value) {
		_state = .init(wrappedValue: wrappedValue)
		defaultValue = `default`
	}
}
```
And use it in our views:
```swift
struct MyView: View {
	@DefaultingState(default: .zero)
	var state = 1

	var body: some View { /*...*/ }
}
```
But `DynamicProperty` doesn't have to be a `@propertyWrapper`. We'll probably explore the protocol in some future posts. For now, all we need to know is that `@Environment` can work inside the `DynamicProperty` and it must be inside a `View` (or any `View`-like structure) itself. Let's continue with our `BadgeStyle`. 
## Installing on a `View`
First, we need to conform our styles to `DynamicProperty`. This is easy because all the protocol's requirements have default implementations:
```swift
public protocol BadgeStyle/*@START_HIGHLIGHT@*/: DynamicProperty/*@END_HIGHLIGHT@*/ {
	/*...*/
}
```
Now, we need to somehow install it on a `View`. For that, let's create an intermediate wrapper view ourselves and save our users from having to do it every time they need to use a property wrapper:
```swift
struct ResolvedBadgeStyle<Base: BadgeStyle>: View {
	let base: Base
	let configuration: BadgeStyleConfiguration
	
	var body: some View {
		base.makeBody(configuration: configuration)
	}
}
```
Now, if we use our `ColorSchemeBadgeStyle` we defined [[styling#`@Environment` and friends|earlier]] with this view, it will work. Then we need to change our `Badge` so that it uses `ResolvedBadgeStyle` within its body. If we try to just use it, we get the error:
```swift
public struct Badge: View {
	public let text: String
	public let image: Image?

	@Environment(\.badgeStyle)
	var style

	public var body: some View {
		ResolvedBadgeStyle(base: style, configuration: configuration)
	}
	
	var configuration: BadgeStyleConfiguration {
		.init(text: text, image: image)
	}
}
```
 > [!error]
 > Type 'any BadgeStyle' cannot conform to 'BadgeStyle'

But now we can't just use `AnyView` because the error is not about `View` anymore. But fear not; we don't need to create a type-erasing wrapper for our styles. All we need to do is extend the `BadgeStyle` protocol:
```swift
extension BadgeStyle {
	func resolved(with configuration: BadgeStyleConfiguration) -> AnyView {
		AnyView(ResolvedBadgeStyle(base: self, configuration: configuration))
		// Now the compiler knows the concrete type of Self
		// We use AnyView again. The reason is the same as last time
	}
}
```
And we change the `Badge` a little:
```swift
public struct Badge: View {
	public let text: String
	public let image: Image?

	@Environment(\.badgeStyle)
	var style

	public var body: some View {
		style.resolved(with: configuration)
	}
	
	var configuration: BadgeStyleConfiguration {
		.init(text: text, image: image)
	}
}
```
Now our styles can use all the SwiftUI property wrappers, and it works like a charm. But it's a single component. Our design system will most probably have dozens of them, and we need to write this code for every component. And it's the same code over and over. What we want is to write it once and use it for all the imaginable components in our design system. And now the most fun part begins.
# Generalize this
Let's look at two implementations of this method and find the common parts:
```swift
// MARK: - BadgeStyle
struct BadgeStyleConfiguration { /*...*/ }
protocol BadgeStyle: DynamicProperty {
	associatedtype Body: View
	typealias Configuration = BadgeStyleConfiguration
	func makeBody(configuration: Configuration) -> Body
}
struct BadgeStyle: View { 
	/*...*/
	@Environment(\.badgeStyle)
	var style

	var body: some View { /*...*/ }
 }
extension Environment {
	var badgeStyle: any BadgeStyle { /*...*/ }
}

struct IndicatorStyleConfiguration { /*...*/ }
protocol IndicatorStyle: DynamicProperty {
	associatedtype Body: View
	typealias Configuration = IndicatorStyleConfiguration
	func makeBody(configuration: Configuration) -> Body
}
struct IndicatorStyle: View { 
	/*...*/
	@Environment(\.indicatorStyle)
	var style

	var body: some View { /*...*/ }
}
extension Environment {
	var indicatorStyle: any IndicatorStyle { /*...*/ }
}
```
As you see, almost everything is a common part. So let's start generalizing. First, we define our component protocol:
```swift
protocol StylableComponent: View {
	associatedtype Configuration

	var configuration: Configuration { get }
}
```
Next, we need the style protocol:
```swift
protocol ComponentStyle: DynamicProperty {
	associatedtype Body: View
	typealias Configuration = ???
	
	@ViewBuilder
	func makeBody(configuration: Configuration) -> Body
}
```
Now, because our `ComponentStyle` will be used for all the styles, we don't know the type of our configuration. But instead of making it `associatedtype` (which would also work), let's have the `Component` for this style be `associatedtype` instead:
```swift
protocol ComponentStyle<Component>: DynamicProperty {
	associatedtype Component: StylableComponent 
	associatedtype Body: View
	
	@ViewBuilder
	func makeBody(configuration: Component.Configuration) -> Body
}
```
And we need the `ResolvedComponent` view as well to use in our component's `body` property:
```swift
struct ResolvedComponent<Style: ComponentStyle>: View {
	let configuration: Style.Component.Configuration
	let style: Style

	var body: some View {
		style.makeBody(configuration: configuration)
	}
}

extension ComponentStyle {
	func erasedBody(configuration: Component.Configuration) -> AnyView {
		AnyView(
			ResolvedComponent(
				configuration: configuration,
				style: self
			)
		)
	}
}
```
Good, now we have basic abstractions. But they are not complete; all our components need their default styles, so we add them to the protocol:
```swift
protocol StylableComponent: View {
	associatedtype Configuration

	var configuration: Configuration { get }

	/*@START_HIGHLIGHT@*/static var defaultStyle: any ComponentStyle<Self> { get }/*@END_HIGHLIGHT@*/
}
```
Now we need a way to propagate styles through the environment.
```swift
extension EnvironmentValues {
	var style: ??? {
		get { ??? }
		set { ??? }
	}
}
```
Because our styles are generic, we can't just use properties to store them. We need a future-proof way to store any type of style. If you read the [[keypaths|previous article]], you know that `KeyPath`s (that we use to access `@Environment`) can represent `subscript` access, **and** we can parametrize them with types. So let's try to implement one for storing our styles:
```swift
struct AnyComponentStyle<Component: StylableComponent> {
	let base: any ComponentStyle<Component>
	let body: (Component.Configuration) -> AnyView

	init(base: some ComponentStyle<Component>) {
		self.base = base
		body = { base.erasedBody(configuration: $0) }
	}

	func erasedBody(configuration: Component.Configuration) -> AnyView {
		body(configuration)
	}
}

struct ComponentStyleKey<C: StylableComponent>: EnvironmentKey, Hashable {
	static var defaultValue: AnyComponentStyle<C> { 
		.init(base: C.defaultStyle)
	}

	init(_ type: C.Type) {}
}

extension EnvironmentValues {
	subscript<Component: StylableComponent>(
		componentStyle key: ComponentStyleKey<Component>
	) -> AnyComponentStyle<Component> {
		get { self[ComponentStyleKey<Component>.self] }
		set { self[ComponentStyleKey<Component>.self] = newValue }
	}
}
```
We use the generic `ComponentStyleKey` as an `EnvironmentKey` to store the styles in `EnvironmentValues`, and it's `Hashable` for us to pass it as a parameter in `KeyPath`s. We also wrap the style in a special intermediate type-erased representation; we'll focus on why it's needed later. Now we can use it in our components, but since we can define our own property wrappers that conform to `DynamicProperty`, let's do just that to simplify client code. We're going to need it later:
```swift
@propertyWrapper
struct StyleWrapper<Component: StylableComponent>: DynamicProperty {
	@Environment(\.[componentStyle: .init(Component.self)])
	var style

	var wrappedValue: AnyComponentStyle<Component> { style }

	init() {}
}

extension StylableComponent {
	typealias Style = StyleWrapper<Self>
}
```
And now our components look like this:
```swift
struct Badge: StylableComponent {
	struct Configuration { 
		let text: String
		let image: Image?
	}

	static var defaultStyle: any ComponentStyle<Badge> { DefaultBadgeStyle() }

	@Style
	var style // : AnyComponentStyle<Self>

	var body: some View { 
		style.erasedBody(configuration: configuration)
	}

	var configuration: Configuration

	init(text: String, image: Image? = nil) {
		configuration = .init(text: text, image: image)
	}
}

struct DefaultBadgeStyle: ComponentStyle {
	typealias Component = Badge

	func makeBody(configuration: Badge.Configuration) -> some View {
		HStack {
			Text(configuration.text)
			configuration.image
		}
		.padding()
		.background {
			Capsule().fill(.background)
		}
	}
}
```

For the simple components that give all their layout to the corresponding style, the `body` and the `style` properties will always be the same. So we can abstract them away as well.
```swift
struct DefaultComponentBody<Component: StylableComponent>: View {
	@StyleWrapper<Component>
	var style
	let configuration: Component.Configuration

	var body: some View {
		style.erasedBody(configuration: configuration)
	}
}

extension StylableComponent where Body == DefaultComponentBody<Self> {
	var body: Body {
		DefaultComponentBody(configuration: configuration)
	}
}
```
Here, we define the view that will be our components' default `Body` and use it to implement the `body` property on the components. The `where` constraint is actually a really powerful thing; it specializes the default `Body`, so if the component doesn't implement the `body` property, the compiler will know what type to use:
```swift
struct Badge: StylableComponent {
	// inferred Body == DefaultComponentBody<Badge>
	struct Configuration {
		let text: String
		let image: Image?
	}
	static var defaultStyle: any ComponentStyle<Badge> { DefaultBadgeStyle() }

	var configuration: Configuration
	init(text: String, image: Image?) {
		configuration = .init(text: text, image: image)
	}
}
```
Pretty cool, huh? Now we need a way to override the default style:
```swift
extension View {
	func style<C: StylableComponent, S: ComponentStyle<C>>(
		_ style: S
	) -> some View {
		environment(\.[componentStyle: .init(C.self)], .init(base: style))
	} 
}
```

## UX
Another thing I want to address is the UX of our API. Right now, we have the only `style(_:)` modifier that accepts any component style. This is good in a sense that we won't get confused with a lot of modifiers for different components, but now we get confused with all the styles that we can pass as parameters. Let's fix that real quick. We need an intermediate structure to group our styles by the component:
```swift
struct GroupedComponentStyle<C: StylableComponent, S: ComponentStyle<C>> {
	let style: S
}
```
And now we change our `style(_:)` modifier to accept the grouped style:
```swift
extension View {
	func style<C: StylableComponent, S: ComponentStyle>(
		_ grouped: GroupedComponentStyle<C, S>
	) -> some View {
		environment(
			\.[componentStyle: .init(C.self)],
			.init(base: grouped.style)
		)
	}
}
```
Now the code completion works as intended:
```swift
extension GroupedComponentStyle where C == Badge {
	static func badge(_ style: S) -> Self {
		.init(style: style)
	}
}

extension ComponentStyle where Self == DefaultBadgeStyle {
	static var `default`: Self { .init() }
}

struct ContentView: View {
	var body: some View {
		Badge()
			.style(.badge(.default)) 
			// code completion only shows the appropriate properties now
	}
}
```
## View updates
The last thing I want to address before we get to more complicated stuff is unnecessary view updates. If you write `let _ = Self._printChanges()` here and there, you'll notice that our component's `body` is rebuilt every time the external state updates, even if the component itself is not dependent on this state. This happens because of our `@Environment` variable. The type of property is quite complex, and SwiftUI can't understand whether it really changed or not. We can fix that by making our style `Equatable`. But how do we do that? We could make all our styles `Equatable`, but that means the conforming types will need to implement it every time they use `@Environment` or other dynamic properties. We don't want that. We need a way to make it universal and not expose the new requirement to every user. Remember we wrapped the styles in `AnyComponentStyle`? Now we can make it `Equatable` and everything starts to work as expected, but we need to implement it ourselves:
```swift
extension AnyComponentStyle: Equatable {
	static func ==(lhs: Self, rhs: Self) -> Bool {
		/*...*/
	}
}
```
But how do we implement it for custom types? We can use `Mirror` to get all the stored properties of our styles, check if they are `Equatable` and compare them. We also need to check them for `DynamicProperty` conformance and return `true` in that case. SwiftUI's diffing mechanism is pretty powerful; it rebuilds only the parts of the hierarchy that really changed, so we don't need to check dynamic properties as they will be checked by SwiftUI in place.
```swift
private extension Equatable {
	func isEqual(to other: any Equatable) -> Bool {
		guard let other = other as? Self else { return false }
		return self == other
	}
}

extension AnyComponentStyle: Equatable {
	static func ==(lhs: Self, rhs: Self) -> Bool {
		guard type(of: lhs.base) == type(of: rhs.base) else {
			return false
		}
		let lhsChildren = Mirror(reflecting: lhs.base).children
		let rhsChildren = Mirror(reflecting: rhs.base).children
		return zip(lhsChildren, rhsChildren).allSatisfy { lhs, rhs in
			lhs.label == rhs.label && equal(lhs.value, rhs.value)
		}
	}

	private static func equal(_ lhs: Any, _ rhs: Any) -> Bool {
		if let lhs = lhs as? any Equatable, let rhs = rhs as? any Equatable {
			lhs.isEqual(to: rhs)	
		} else if lhs is any DynamicProperty, rhs is any DynamicProperty {
			true
		} else {
			false
		}
	}
}
```
Now our `AnyComponentStyle` is `Equatable` and SwiftUI doesn't rebuild the hierarchy if it doesn't change. It's worth noting that we also might want to do the same for `Configuration` types, but I'll leave it to you and won't cover it here.

And that's it. Our components can support our styling API, and the code that implements it is written once for all of them. But there is much more space to go further. Let's dive deeper

# More complex use cases
To make our API more flexible and powerful, we're going to look at another example of styling in SwiftUI. And it's `Button` again. 

## `PrimitiveButtonStyle`
Besides `ButtonStyle`, you can use another protocol to style a button, which is `PrimitiveButtonStyle`. It uses the same approach, but its `Configuration` type is slightly different; it has a function named `trigger()` that is used to call the action of the button. Now, how can we also support two protocols for a single component? Well, there are two ways in our current implementation. We can use nested components, or we can define another protocol that mimics the behavior of our `ComponentStyle`. The first one has a major disadvantage: we can define multiple styles for a single button, and we need to handle that somehow. So we won't implement that, let's focus on the second one. So, the button has two protocols, and if we look closer, we can see that `PrimitiveButtonStyle` is kind of a superset of `ButtonStyle`; we can implement any `ButtonStyle` using `PrimitiveButtonStyle`, but not the other way. So our alternative to `PrimitiveButtonStyle` will be `ComponentStyle` itself:
```swift
// short for DesignSystemButton
struct DSButton: StylableComponent {
	struct Configuration {
		let trigger: () -> Void
		let label: AnyView
	}
	let label: AnyView
	let action: () -> Void

	init(action: @escaping () -> Void, label: some View) {
		self.action = action
		self.label = AnyView(label)
	}

	var configuration: Configuration { 
		.init(trigger: action, label: AnyView(label))
	}

	static var defaultStyle: any ComponentStyle<DSButton> {
		DefaultDSButtonStyle()
	}
}

struct DefaultDSButtonStyle: ComponentStyle {
	typealias Component = DSButton

	func makeBody(configuration: DSButton.Configuration) -> some View {
		configuration.label
			.onTapGesture {
				configuration.trigger()
			}
	}
}

extension GroupedComponentStyle where C == DSButton {
	static func button(_ style: S) -> Self {
		.init(style: style)
	}
}
```
And our `DSButtonStyle` will be a separate protocol with similar requirements:
```swift
extension DSButton {
	struct RegularConfiguration {
		let label: AnyView
	}
}

protocol DSButtonStyle {
	associatedtype Body: View
	typealias Configuration = DSButton.RegularConfiguration

	@ViewBuilder
	func makeBody(configuration: Self.Configuration) -> Body
}
```
Now we need a way to transform our `DSButtonStyle` to `PrimitiveDSButtonStyle`. We can easily do that with a special wrapper:
```swift
struct DSButtonStyleWrapper<Base: DSButtonStyle>: ComponentStyle {
	typealias Component = DSButton

	let base: Base
	
	func makeBody(configuration: DSButton.Configuration) -> some View {
		base.makeBody(
			configuration: DSButton.RegularConfiguration(
				label: configuration.label
			)
		)
		.onTapGesture {
			configuration.trigger()
		}
	}
}
```
And we need to overload the style method so that it can accept our `DSButtonStyle`:
```swift
extension GroupedComponentStyle where C == DSButton {
	static func button<Style: DSButtonStyle>(
		_ style: Style
	) -> Self where S == DSButtonStyleWrapper<Style> {
		.init(style: DSButtonStyleWrapper(base: style))
	}
}
```
And we're done. Now we have two protocols for styling our button. This approach requires some boilerplate, but the case is pretty rare, so it's acceptable.
## Composability

If you refer to the `Button` documentation, you'll find a special initializer there:
```swift
init(_ configuration: PrimitiveButtonStyleConfiguration)
```
This one is a bit tricky. Old `PrimitiveButtonStyle`s are preserved when you apply the new one. And this particular `init` gives us the ability to use the previously applied style. The example should be more demonstrative. This code:
```swift
struct ContentView: View {
	var body: some View {
		Button("Test") {
			// action
		}
		.buttonStyle(Bordered(color: .blue))
		.buttonStyle(Padded())
		.buttonStyle(Bordered())
	}
}

struct Bordered: PrimitiveButtonStyle {
	var color = Color.red

	func makeBody(configuration: Configuration) -> some View {
		Button(configuration)
			.border(color)
	}
}

struct Padded: PrimitiveButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		Button(configuration)
			.padding()
	}
}
```
Gives us the following result:
![[styling-image-0.png]]
Note that the order of the applied modifiers is reversed. This is due to environment propagation. Suppose we have an array in the environment, and we add a value to the array with a special modifier:
```swift
extension EnvironmentValues {
	private enum Key: EnvironmentKey {
		static var defaultValue: [Int] { [] }
	}

	var array: [Int] {
		get { self[Key.self] }
		set { self[Key.self] = newValue }
	}
}

extension View {
	func addValue(_ int: Int) -> some View {
		transformEnvironment(\.array) {
			$0.append(int)
		}
	}
}
```
And we use this modifier multiple times in a view:
```swift
var body: some View {
	Color.clear
		.addValue(1)
		.addValue(2)
		.addValue(3)
}
```
As you might have guessed, the order of the `array` values in the leaf view (`Color`) will be `[3, 2, 1]`.  Because the environment is transformed from parent to child, we need to read the transformations from the root elements of the hierarchy to the leaves:
```swift
// Read the code in body from the bottom
var body: some View {
	Color.clear
		.addValue(1) // <- We add 1 and the result is [3, 2, 1]
		.addValue(2) // <- We add another Int and have [3, 2]
		.addValue(3) // <- We add a value to the array and have [3]
		// <- Here we have a default value of []
}
```
`PrimitiveButtonStyle` behaves in a similar way:
```swift
// Read the code in body from the bottom
var body: some View {
	Button("Test") {
		// action
	}
	// [.default, Bodrdered, Padded, Bordered(.blue)]
	.buttonStyle(Bordered(color: .blue))
	// [.default, Bodrdered, Padded]
	.buttonStyle(Padded())
	// [.default, Bordered]
	.buttonStyle(Bordered())
	// Here we have DefaultButtonStyle
}
```
And the styles are applied from the last to the first, meaning that when we use `Button(configuration)`, we have all the styles but last applied to it. And it seems like every `PrimitiveButtonStyleConfiguration` has all the previous styles embedded in it. This is a little confusing, but it is useful sometimes as it gives us the ability to compose the styles. Now let's implement something similar for our components. 

### Style propagation
Although it seems like the `PrimitiveButtonConfiguration` contains all the styles, they are actually propagated the same way, through the environment. But first, we need to store them as an array instead of a single style:
```swift
struct ComponentStylesKey<C: StylableComponent>: EnvironmentKey, Hashable {
	static var defaultValue: [AnyComponentStyle<C>] { 
		[]
	}

	init(_ type: C.Type) {}
}

struct AnyComponentStyle<Component: StylableComponent> {
	let base: any ComponentStyle<Component>
	let body: (Component.Configuration) -> AnyView

	init(base: some ComponentStyle<Component>) {
		self.base = base
		body = { base.erasedBody(configuration: $0) }
	}

	func erasedBody(configuration: Component.Configuration) -> AnyView {
		body(configuration)
	}
}

extension EnvironmentValues {
	subscript<Component: StylableComponent>(
		componentStyles key: ComponentStylesKey<Component>
	) -> [AnyComponentStyle<Component>] {
		get { self[ComponentStylesKey<Component>.self] }
		set { self[ComponentStylesKey<Component>.self] = newValue }
	}
}
```
Now our code doesn't compile, and there are many reasons why. So we'll fix all the errors. First, our `StyleWrapper`:
```swift
@propertyWrapper
struct StyleWrapper<Component: StylableComponent>: DynamicProperty {
	@Environment(\.[componentStyles: .init(Component.self)])
	var styles

	var wrappedValue: AnyComponentStyle<Component> {
		styles.last ?? .init(base: Component.defaultStyle)
	}

	init() {}
}

extension StylableComponent {
	typealias Style = StyleWrapper<Self>
}
```
Then, with our `style(_:)` modifier, we now add a value to the array rather than store it by itself:
```swift
extension View {
	func style<C: StylableComponent, S: ComponentStyle>(
		_ grouped: GroupedComponentStyle<C, S>
	) -> some View {
		transformEnvironment(\.[componentStyles: .init(C.self)]) {
			$0.append(.init(base: grouped.style))
		}
	}
}
```
Now the code compiles, but it works exactly the same. Now we need a way to propagate our previous styles. But we want to make it opt-in because some components don't need style composability. We need a separate `ComposableStyling` protocol:
```swift
protocol ComposableStyling: StylableComponent
	where Body == DefaultComponentBody<Self> {
	init(_ configuration: Configuration)
}
```
Our `ComposableStyling` requires that the `Body` type is `DefaultComponentBody<Self>`. This is similar to the built-in SwiftUI components. The ones that support styling composability give the layout to styles completely. Now the components that support composable styles just need to implement the `init(_:)` from the `ComposableStyling` protocol. Now we want to propagate previously applied styles to the component created with our new `init`. We know that we'll do it with the environment, but where do we apply the modifier? Well, let's see where we have access to all the styles now. And this place is the only one - our `StyleWrapper`. But it doesn't really have access to the view; it only returns a style to the view. This is easily fixed. It returns the style itself, and the only thing we do with it is call the method `erasedBody(for:)` to get the view with the style applied. Instead, our `wrappedValue` can be a special type that has the same method but returns the view with the rest of the styles applied:
```swift
@propertyWrapper
struct StyleWrapper<Component: StylableComponent>: DynamicProperty {
	struct WrappedValue {
		let currentStyle: AnyComponentStyle<Component>
		let rest: [AnyComponentStyle<Component>]

		func erasedBody(
			configuration: Component.Configuration
		) -> some View {
			currentStyle.erasedBody(configuration: configuration)
				.environment(\.[componentStyles: .init(Component.self)], rest)
		}
	}

	@Environment(\.[componentStyles: .init(Component.self)])
	var styles

	var wrappedValue: WrappedValue {
		.init(
			currentStyle: styles.last ?? .init(base: Component.defaultStyle),
			rest: styles.dropLast()
		)
	}

	init() {}
}

extension StylableComponent {
	typealias Style = StyleWrapper<Self>
}
```
And it works like a charm. But before we get to the conclusion, let's also address a few things.

# Side notes
## General API feel
Our API looks pretty neat as is, but for it to be more SwiftUI-like (for better or worse), we might need some boilerplate. For example, `Button` is generic by its `Label`. But the `ButtonStyle` is universal for all buttons. For us to make our components that way, we need to make separate protocols for the styles, just as we did in our `PrimitiveButtonStyle` [[styling#`PrimitiveButtonStyle`|example]]. Otherwise, the user might change the label's type accidentally. This is not a big problem. Though you (and your users) should be aware of that.

## Type erasure
Another thing I want to talk about is our usage of type erasure. Basically, we can't do our styling without it. Whether it's `AnyView` or `any ComponentStyle<Component>`. But SwiftUI uses it too. If you ask yourself how the `ButtonStyle` is a universal style for a generic `Button`, you'll come to the conclusion that there is type erasure involved. But it's okay. As long as you use it right, you won't see any performance issues or other problems. There are rules of thumb, though:
- Type erasure usage in the leaf elements of the hierarchy is fine because they won't get rebuilt when the views in the higher levels of the hierarchy aren't changed.
- Type erasure usage in the root elements of the hierarchy is fine because the type of the root element will most probably stay the same, and it's inexpensive to check if the underlying view is actually changed.

You might think that the rules allow for type erasure anywhere because every view is some other's leaf and, at the same, time some other's root. Well, that's true, but the rules are not for allowing or forbidding you to use `AnyView`, but rather for guiding you to where to use it. For example, if you have a complex view that has a big body and lots of state that is expensive to rebuild or update, you might not want to wrap it in `AnyView`, but if you have a primitive design system component that is guaranteed to be the leaf of the mentioned view, it's fine to wrap that in `AnyView`. Similarly, if you have your `ContentView` wrapped in `AnyView` (for some reason), it might be okay because the `ContentView` is rebuilt very infrequently and `AnyView` won't affect the performance.

# Conclusion
Today we basically recreated SwiftUI styling APIs, but we also made it generic so that any stylable component can support it with minimum code at the client side; the only thing the component needs to support it is to define a default style and conform to a protocol (or two protocols if it needs style composability). The final code is quite complex, but it's future-proof and written once for all the components, whether there are dozens or hundreds of them. Next time we'll talk a little about `async/await`, so stay tuned. See you in the [[serialize-this|next article]].