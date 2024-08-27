---
title: Implementing a countdown timer in pure SwiftUI
date: 2024-05-19
description: Today we'll implement a simple countdown timer in pure SwiftUI in a robust, glitch-free way.
---
# Implementing a countdown timer in SwiftUI
Recently at work during code review, I stumbled upon an interesting component in our design system: a countdown timer. It was implemented using the `Timer` type, but this brought an unwanted side effect. Eventually, I came up with a more robust solution, which I'm going to share with you today.

---
# Initial implementation
First, let's review the initial implementation.
```swift
public struct CountdownTimer: View {
    @State 
    var timeRemaining: Int
	@State 
	var timer: Timer?

	let seconds: Int
	let completionHandler: (() -> Void)?

	public init(
		_ seconds: Int = 5,
		completionHandler: (() -> Void)? = nil
	) {
		self.seconds = seconds
		self.completionHandler = completionHandler
		timeRemaining = seconds
	}

	public var body: some View {
		VStack {
			Circle()
				// /*@START_HIGHLIGHT@*/1/*@END_HIGHLIGHT@*/
				.trim(from: CGFloat(1 - (timeRemaining / seconds)), to: 1)
				.stroke(.foreground)
				.rotationEffect(.degrees(-90))
				.animation(
					// /*@START_HIGHLIGHT@*/2/*@END_HIGHLIGHT@*/
					.linear(duration: TimeInterval(seconds)),
					value: timeRemaining
				)
				.frame(width: 25, height: 25)

			Text("\(timeRemaining)")
				// /*@START_HIGHLIGHT@*/3/*@END_HIGHLIGHT@*/
				.id(timeRemaining)
				.transition(transition)
		}
		.animation(.default, value: timeRemaining)
		// /*@START_HIGHLIGHT@*/4/*@END_HIGHLIGHT@*/
		.onAppear {
			startTimer()
		}
	}

	var transition: AnyTransition {
		.asymmetric(
			insertion: .opacity.combined(with: .move(edge: .top)),
			removal: .opacity.combined(with: .move(edge: .bottom))
		)
	}

	// /*@START_HIGHLIGHT@*/5/*@END_HIGHLIGHT@*/
	func stopTimer() {
		timer?.invalidate()
	}

	func startTimer() {
		guard timer == nil else { return }
		timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
			guard timeRemaining > 0 else {
				completionHandler?()
				stopTimer()
				return
			}
			timeRemaining -= 1
		}
	}
}
```
First, the `trim(from:to:)` modifier (==1==). The `from` parameter equals `1 - (timeRemaining / seconds)`, which is basically either 0 or 1 because we're working with `Int`s here. We can rewrite it using a ternary operator. Then we're animating the change of this parameter using linear animation with the `duration` set to the initial time (==2==). What we have here is a full-length animation of our timer. This is cool because SwiftUI controls it entirely, and SwiftUI is responsible for the correctness of the animation. Then we have `Text` with the textual representation of the time remaining (==3==). It has the `id(_:)` modifier to reset its identity when the `timeRemaining` changes so that our `transition(_:)` modifier works and our digits animate as we want them to. What caught my attention though is the `Timer` (==4==, ==5==). You see, timers are tricky; one of their features is that they stop when the app moves to the background, so when we hide the application, our text and the trimmed circle go out of sync:
![[let-swiftui-do-it-image-0.webp|16x9]]
Also, did you see that glitch when we returned back to the app? It also happens because of the `Timer`. We need a way to get rid of it. But first, let's dive a little into how animations work.
# Animation
Basically, any animation works by **interpolating** some value over time. Interpolation is a gradual change of the value depending on the progress of the animation. So if we interpolate from `0.0` to `4.0` with five ticks, we get the array of values of `[0.0, 1.0, 2.0, 3.0, 4.0]`. The same thing happens with all the values that animate in SwiftUI. The number of ticks varies depending on the time passed and the actual FPS; if you load the main thread too much, the ticks might not even be of the same length. But that's not important for us. Timer is good, but it's not reliable, or, at least, not as reliable as the SwiftUI animation engine. Most of the things in SwiftUI animate implicitly; all we need to do is use one of the `.animation` modifiers in a view or use `withAnimation` function to animate the state change. But how does SwiftUI understand which values to interpolate? Well, there is a special protocol for it.
# `Animatable`
`Animatable` is a protocol that lets us tell SwiftUI which values it can animate for our entities. I said "entities" because SwiftUI can animate not only `View`s, but also `ViewModifier`s, `Shape`s (which are also `View`s), `Layout`s, etc. All we need to do is conform our type to `Animatable` and SwiftUI will do its thing. The protocol has two requirements: a type of animatable data that conforms to `VectorArithmetic` so that its values can be interpolated, and a property of that type named `animatableData`. The value of `animatableData` is interpolated between an old state and the new one, and the `body` is called for every tick of interpolation to draw the actual view. What's interesting is that `Animatable` is one of the few things in SwiftUI that has mutation in its API: the `animatableData` property is allowed to mutate `self` when the new value is set. There are also two auxiliary types to help us deal with the animatable data. One of them is `EmptyAnimatableData` for the cases when we don't really animate anything; it is the default type of `animatableData`. The other is `AnimatablePair` for the cases when we have more than one value to animate. Now, how do we use it?
```swift
struct TrimmedCircle: Animatable, View {
	let from: Double
	let to: Double

	var animatableData: AnimatablePair<Double, Double> {
		get { .init(from, to) }
		set {
			from = newValue.first
			to = newValue.second
		}
	}

	var body: some View {
		Circle()
			.trim(from: from, to: to)
	}
}
```
And now our `TrimmedCircle` can be animated with either `.animation` modifier or `withAnimation` function. And actually, the body of our `TrimmedCircle` is already animatable, and we can even find its `AnimatableData`:
```swift
print(type(of: Circle().trim(from: 0, to: 0).animatableData))
// AnimatablePair<EmptyAnimatableData, AnimatablePair<CGFloat, CGFloat>>
```
`Shape`s conform to `Animatable` by default. The `trim` modifier is a special wrapper shape that is also `Animatable`, that takes the other shape and adds to its `animatableData` its own animatable properties. Namely, `from` and `to` parameters. That's why its `AnimatableData` has this nested structure: the first type-parameter is the `AnimatableData` of the wrapped shape. Now we have a basic understanding of how animations work, but how do we actually use them for our countdown timer? Let's see.
# Interpolate this
Our circle indicating progress works fine as is, but how do we animate our text using `Animatable`? We can't just interpolate strings. But the string we pass in `Text`'s initializer is not just plain text. It's a textual representation of the time remaining, which is `Double`, that can be interpolated. Let's rewrite our `CountdownTimer` so that it uses an `Animatable` view. We can't just make `CountdownTimer` itself `Animatable` because, in that case, we would need to apply the `animation` outside.
```swift
struct CountdownTimer: View {
	let seconds: TimeInterval
	let completion: () -> Void
	@State
	var progress = 1.0

	var body: some View {
		Internal(seconds: seconds, progress: progress) {
			completion()
		}
		.onAppear {
			withAnimation(.linear(duration: seconds)) {
				progress = .zero
			}
		}
	}
}

private struct Internal: Animatable, View {
	var animatableData: Double

	let seconds: TimeInterval
	var progress: Double { animatableData }
	let completion: () -> Void

	init(
		seconds: TimeInterval,
		progress: Double,
		completion: @escaping () -> Void
	) {
		self.seconds = seconds
		animatableData = progress
		self.completion = completion
	}

	var body: some View { /*...*/ }
}
```
Now our `CountdownTimer` uses a private `Animatable` view that will handle the animation. In the `.onAppear` block, we set the `progress` to zero to start animating the timer. Now let's write our `Internal` view.
```swift
private struct Internal: Animatable, View {
	var animatableData: Double

	let seconds: TimeInterval
	var progress: Double { animatableData }
	let completion: () -> Void

	init(
		seconds: TimeInterval,
		progress: Double,
		completion: @escaping () -> Void
	) {
		self.seconds = seconds
		animatableData = progress
		self.completion = completion
	}

	var body: some View {
		VStack {
			Circle()
				.trim(from: CGFloat(1 - progress), to: 1)
				.stroke(.foreground)
				.rotationEffect(.degrees(-90))
				.animation(.none, value: progress)
				.frame(width: 25, height: 25)
			Text(text)
				.transition(transition)
				.id(text)
		}
		.animation(.default, value: text)
	}

	var text: String {
		let secondsValue = seconds * progress
		let rounded = secondsValue.rounded(.toNearestOrAwayFromZero)
		return String(Int(rounded))
	}

	var transition: AnyTransition {
		.asymmetric(
			insertion: .opacity.combined(with: .move(edge: .top)),
			removal: .opacity.combined(with: .move(edge: .bottom))
		)
	}
}
```
A note on `.animation` usage. We override the animation for our text, but we can't just do it on the text itself. You see, the transitions are animated by the container views, so we need to apply the animation to the container. And since we applied the animation to the container, now our `Circle` also has that animation, so we reset it to `.none` because we simply don't need it; our `progress` value is already interpolated by SwiftUI. All we need to do now is call the `completion` closure when the timer ends. This is done using `.onChange(of:perform:)` modifier:
```swift
private struct Internal: Animatable, View {
	var animatableData: Double

	let seconds: TimeInterval
	var progress: Double { animatableData }
	let completion: () -> Void

	init(
		seconds: TimeInterval,
		progress: Double,
		completion: @escaping () -> Void
	) { /*...*/ }

	var body: some View {
		VStack { /*...*/ }
		.animation(.default, value: text)
		/*@START_HIGHLIGHT@*/.onChange(of: progress)/*@END_HIGHLIGHT@*/ {
			if $0.isZero {
				completion()
			}
		}
	}

	var text: String { /*...*/ }

	var transition: AnyTransition { /*...*/ }
}
```
This needs an explanation. We change our progress directly to `.zero`, but SwiftUI only uses the value to get the points to interpolate between them, and the closure we pass in `.onChange(of:perform:)` is only called for interpolated values, so it'll be called with a `.zero` value only when the timer reaches zero. Now we have a fully functional implementation.

# Conclusion
Today we implemented a countdown timer, but we made it in such a way that we delegated all the complex stuff to SwiftUI. And now SwiftUI is responsible for synching our animations, measuring the time, and calling the completion. The solution is robust and effective. If you (or your colleague) block the main thread, the animatiipfson engine will just skip a couple of values during interpolation, but the animations will still be in sync. Next time, we'll talk a little about the newer SwiftUI APIs. It is often impossible to use them because we have to support earlier versions of the operating system. Often, but not always. See you in the [[backport|next article]].