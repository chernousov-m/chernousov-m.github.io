---
title: Generalizing styling APIs for SwiftUI components
date: 2024-04-28
description: When you need to develop an app using SwiftUI, you will inevitably end up building your design system. And your components will require their own styling. Let's design the API for that
---
# Generalizing styling APIs for SwiftUI components.
When you need to develop an app using SwiftUI, you will inevitably end up building your design system. And your components will require their own styling. Let's design the API for that.

# SwiftUI style's anatomy
There are plenty of built-in styles in SwiftUI. `ButtonStyle`, `LabelStyle`, `ProgressViewStyle` and many others. And almost all of them follow the same pattern:
```swift
public struct ButtonStyleConfiguration {
	public struct Label : View { /*...*/ }

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
What we have here is a protocol for a style that makes a `View` out of the configuration. In `ButtonStyle` case the configuration contains its label and `isPressed` property indicating whether the button is pressed at the moment. First, let's recreate that and then we'll try to make it universal for all of our components.

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
Now, we are already able to change the background color with `backgroundStyle(_:)` modifier. But we also want to let users of our design system change the layout of our badge. Perhaps they want to change the padding or the order of the views in `HStack` or even replace the `HStack` with `VStack`. Instead of putting all the imaginable properties in environment let's create a `BadgeStyle` protocol to make it configurable the SwiftUI way:
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
As you might know already, the `ButtonStyle` can be applied to any view in the view hierarchy. That means there is environment involved. We also need that because we might want to specify a style for multiple badges at once somewhere higher in the hierarchy, so we create our environment value:
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
Note that we use `any BadgeStyle`. We can't know the concrete type of the style that will be applied by the user, so we store it as `any`.
Now let's change our badge to use the style from the environment:
```swift
public struct Badge: View {
	public let text: String
	public let image: Image?

	@Environment(\.badgeStyle)
	var style

	public var body: some View {
		style.makeBody(configuration: .init(text: text, image: image))
	}
}
```
And we get the error: 
> [!failure] Type 'any View' cannot conform to 'View'.

Because we use `any BadgeStyle` our `makeBody(configuration:)` method now also returns `any View`. The reason is the same - we can't know the concrete type, and even if we knew - it can change, so the return type of our method is erased as well. We can easily fix this by using `AnyView`:
```swift
public struct Badge: View {
	public let text: String
	public let image: Image?

	@Environment(\.badgeStyle)
	var style

	public var body: some View {
		AnyView(
			style.makeBody(configuration: .init(text: text, image: image))
		)
	}
}
```
Now our code compiles. Cool, we can define our own styles and use them to style our badge. We can use this pattern to build styling for every component in our design system with a few lines of code for each component. But there's a problem though. At some point in future some user of your design system comes to you with the following code which doesn't work:
```swift
struct ColorSchemeBadgeStyle: BadgeStyle {
	@Environment(\.colorScheme)
	var colorScheme

	func makeBody(configuration: Configuration) -> some View {
		HStack {
			Text(text)
			image
		}
		.padding()
		.background {
			Capsule().fill(colorScheme == .light ? Color.blue : .red)
		}
	}
}
```
The `Environment` property wrapper doesn't work with our `BadgeStyle`, nor do any other SwiftUI property wrappers. 















Всем привет. Styling API для произвольного компонента, который хочет его поддерживать (65 строк кода!):
```swift
protocol StylableComponent: View {
	associatedtype Content
    
	static var defaultStyle: AnyComponentStyle<Self> { get }
}

protocol ComponentStyle<Component>: DynamicProperty {
    associatedtype Component: StylableComponent
    associatedtype Body: View
    
    func body(content: Component.Content) -> Body
}

extension ComponentStyle {
    func erasedBody(content: Component.Content) -> AnyView {
        AnyView(StyledComponent(style: self, content: content))
    }
}

struct AnyComponentStyle<Component: StylableComponent>: ComponentStyle {
    init<Style: ComponentStyle>(base: Style) where Style.Component == Component {
        self.base = base
        bodyCl = { ($0 as! Style).erasedBody(content: $1) }
    }

    let base: any ComponentStyle
    let bodyCl: (any ComponentStyle, Component.Content) -> AnyView
    
    func body(content: Component.Content) -> some View {
        bodyCl(base, content)
    }
}

struct StyledComponent<Component: StylableComponent, Style: ComponentStyle>: View where Style.Component == Component {
    let style: Style
    let content: Component.Content

    var body: some View {
        style.body(content: content)
    }
}

struct StyleKey<Component: StylableComponent>: EnvironmentKey, Hashable {
    static var defaultValue: AnyComponentStyle<Component> {
        Component.defaultStyle
    }
    
    init(_ type: Component.Type = Component.self) {}
}

extension View {
    func style<Component: StylableComponent>(
        _ style: AnyComponentStyle<Component>
    ) -> some View {
        environment(\.[style: StyleKey(Component.self)], style)
    }
}

extension EnvironmentValues {
    subscript<Component: StylableComponent>(
        style style: StyleKey<Component>
    ) -> AnyComponentStyle<Component> {
        get { self[StyleKey<Component>.self] }
        set { self[StyleKey<Component>.self] = newValue }
    }
}
```

Используется так:

```swift
extension AnyComponentStyle<ActionButton> {
    static func button<Style: ComponentStyle>(_ style: Style) -> AnyComponentStyle<ActionButton> where Style.Component == ActionButton {
        .init(base: style)
    }
}

struct PrimaryButtonStyle: ComponentStyle {
    typealias Component = ActionButton

    @Environment(\.colorScheme)
    var colorScheme
    
    func body(content: ActionButton.Content) -> some View {
        content
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 16)
                    .fill(colorScheme == .dark ? .blue : .yellow)
            }
    }
}

extension ComponentStyle where Self == PrimaryButtonStyle {
    static var primary: Self { .init() }
}

struct ActionButton: StylableComponent {
    @Environment(\.[style: .init(Self.self)])
    var style
    
    var body: some View {
        style.erasedBody(content: Content())
    }
    
    struct Content: View {
        var body: some View {
            Text("Купил мужик шляпу")
        }
    }
    
    static var defaultStyle: AnyComponentStyle<ActionButton> { .button(.primary) }
}

@main
struct TestSwiftUIApp: App {
    var body: some Scene {
        WindowGroup {
            ActionButton()
                .style(.button(.primary))
        }
    }
}
```
Немного о характеристиках подхода:
- Возможность использовать `Environment` и любые другие `DynamicProperty` в стилях (так же как в стандартных)
- AnyView только в листовых элементах иерархии (так же как в стандартных)
- Стили группируются по типу компонента (не запутаемся в модификаторах - он только один)

Дополнительно можно сделать применение стиля через кастомный модификатор, что позволит создавать протоколы для контента и констрейнтить компоненты по типу принимаемого контента (возможно завтра покажу как сделать такое)