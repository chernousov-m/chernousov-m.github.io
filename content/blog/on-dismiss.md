---
title: "Implementing missing SwiftUI functionality: onDismiss modifier"
date: 2025-05-25
description: Today we'll add the missing piece to SwiftUI. The onDismiss modifier
---
## Implementing missing SwiftUI functionality: onDismiss modifier

When you develop an app with SwiftUI, you need a way to know whether a view is present in the hierarchy or not. Yet we don't have any API to find it out. The only lifecycle modifiers SwiftUI gives us are `onAppear(perform:)` and `onDisappear(perform:)`. You might think it's because those modifiers are enough, but it's not the case. Every once in a while, you need to cancel some asynchronous task or invalidate some global state when the view lifecycle ends, but the problem is you can't tell for sure whether the view is dismissed or not. Today we'll create a special modifier that lets us know when the view's lifecycle is over.

---
# Why onDisappear can't help us?
Well, as the name (and the documentation) states, the closure we pass into `onDisappear(perform:)` is called when a view disappears. Most of the time "disappears" means that the view is removed from the hierarchy. But there are cases when the view disappears from the screen only. One example would be stack navigation. When you push a new screen over the current one (whether in `NavigationView` or `NavigationStack`), the view disappears and the handler is called. We need to address that.

# Implementing onDismiss
To know when the view is removed from the hierarchy, we need a way to see the hierarchy itself. For better or worse, SwiftUI doesn't provide us this level of control. But UIKit does. Not only does it give us the opportunity to see and inspect the hierarchy, it gives us the APIs for just that: observing the lifecycle. Those exist on `UIViewController`s. 

Since SwiftUI is interoperable with UIKit, we can inject any UIKit view controller into SwiftUI views and hence create an observable part of the view hierarchy. Let's begin.

```swift
public extension View {
	/// onDismiss modifier. Provided action is called when the View is removed from the hierarchy
	func onDismiss(perform handler: (() -> Void)? = nil) -> some View {
		background {
			OnDismissRepresentable(onDismiss: handler)
				.allowsHitTesting(false)
		}
	}
}

private struct OnDismissRepresentable: UIViewControllerRepresentable {
	let onDismiss: (() -> Void)?

	func makeUIViewController(context: Context) -> ViewController {
		ViewController()
	}

	func updateUIViewController(_ uiViewController: ViewController, context: Context) {
		/* ... */
	}

	class ViewController: UIViewController {
		/* ... */
	}
}
```

We have the `onDismiss(perform:)` modifier, which just adds an overlay with our `OnDismissRepresentable`. We set allowsHitTesting to false so that the view controller does not interfere with handling touches in any way. Now we need a way to see if the view controller is removed from the hierarchy. To make the semantics of the modifier more aligned with the standard lifecycle modifiers, we're going to call the handler in the `viewDidDisappear()` method.

```swift
class ViewController: UIViewController {
	var handler: (() -> Void)?

	override func viewDidDisappear(_ animated: Bool) {
		super.viewDidDisappear(animated)

		var needToCallHandler = false
		/* ... */
		if needToCallHandler {
			handler?()
		}
	}
}
```
We need a way to know whether the view controller is a part of the hierarchy at the moment the method is called. SwiftUI combines the view controller with its own hierarchy using the same rules as in UIKit. It means the view controller and its `parent` property behave the same way they do in UIKit. We can check if it's nil after disappearing to find out whether our view controller is still in the hierarchy.
```swift
class ViewController: UIViewController {
	var handler: (() -> Void)?

	override func viewDidDisappear(_ animated: Bool) {
		super.viewDidDisappear(animated)

		var needToCallHandler = /*@START_HIGHLIGHT@*/parent == nil/*@END_HIGHLIGHT@*/
		/* ... */
		if needToCallHandler {
			handler?()
		}
	}
}
```
And it works. With a notable exception. Indeed, it works in the simple hierarchies, but when we mix navigation in, we get different behavior; our handler isn't called. It behaves like that because when the presented or pushed view controller is dismissed, the hierarchy is not destroyed immediately, and the controllers do not lose their parents before disappearing. They do lose their `navigationController`s and `presentingViewController`s, though. So we can check those and determine if we need to call the handler. We need to note that the presenting view controller is not there if we don't present the view modally; the same goes for the navigation controller. So we can't just check whether or not it is `nil`. We need to check it both when appearing and disappearing. With that in mind, we get the following implementation.
```swift
class ViewController: UIViewController {
	var handler: (() -> Void)?
	var wasInNavigation = false
	var wasInPresentation = false

	override func viewDidAppear(_ animated: Bool) {
		super.viewDidAppear(animated)

		wasInNavigation = navigationController != nil
		wasInPresentation = presentingViewController != nil
	}

	override func viewDidDisappear(_ animated: Bool) {
		super.viewDidDisappear(animated)

		var needToCallHandler = parent == nil

		if wasInNavigation, navigationController == nil {
			needToCallHandler = true
		} else if wasInPresentation, presentingViewController == nil {
			needToCallHandler = true
		}

		if needToCallHandler {
			handler?()
		}
	}
}
```
Now we modify our `OnDismissRepresentable` so that it gives the view controller the actual handler.
```swift
public extension View {
	/// onDismiss modifier. Provided action is called when the View is removed from the hierarchy
	func onDismiss(perform handler: (() -> Void)? = nil) -> some View {
		background {
			OnDismissRepresentable(onDismiss: handler)
				.allowsHitTesting(false)
		}
	}
}

private struct OnDismissRepresentable: UIViewControllerRepresentable {
	let onDismiss: (() -> Void)?

	func makeUIViewController(context: Context) -> ViewController {
		let controller = ViewController()
		controller.handler = onDismiss
		return controller
	}

	func updateUIViewController(_ uiViewController: ViewController, context: Context) {
		uiViewController.handler = onDismiss
	}

	class ViewController: UIViewController {
		var handler: (() -> Void)?
		var wasInNavigation = false
		var wasInPresentation = false

		override func viewDidAppear(_ animated: Bool) {
			super.viewDidAppear(animated)

			iwasInNavigation = navigationController != nil
			wasInPresentation = presentingViewController != nil
		}

		override func viewDidDisappear(_ animated: Bool) {
			super.viewDidDisappear(animated)

			var needToCallHandler = parent == nil

			if wasInNavigation, navigationController == nil {
				needToCallHandler = true
			} else if wasInPresentation, presentingViewController == nil {
				needToCallHandler = true
			}

			if needToCallHandler {
				handler?()
			}
		}
	}
}
```

# Conclusion
SwiftUI doesn't tell us when a view is actually removed from the hierarchy—and `onDisappear` just isn't enough. By dropping down to UIKit and using a custom `UIViewController`, we can detect the real end of a view’s lifecycle and run cleanup code reliably. 