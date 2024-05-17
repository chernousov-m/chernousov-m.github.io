---
title: The missing concept from the pre-concurrency world - serialization
date: 2024-05-13
description: Today we'll implement the missing concept in modern concurrency - serialized execution. And we'll talk about its use cases in our apps
---
# Serialization in `async/await` world
In the pre-concurrency world, we had a useful concept of serialization when we worked with dispatch queues. But in `async/await` this concept seems to be missing. Let's implement execution serialization ourselves.

---
# What is serialization?
A good example of the use case for serialization is a token refresh mechanism. Our server requests might be parallel to speed up the loading of the screen, but the token refresh must be performed exclusively; all the other requests must wait for the refresh to complete before they can proceed. Typically, this is implemented using concurrent `DispatchQueue` and a barrier to refresh the token. Here is a toy example:
```swift
struct Request { /*...*/ }
struct Response { /*...*/ }
enum Error: Swift.Error { case unauthorized }

class Service {
	var token: String = ""
	let synchronizationQueue = DispatchQueue(
		label: "service.queue",
		attributes: .concurrent
	)

	func perform(request: Request) -> Response {
		let token = synchronizationQueue.sync { self.token }

		// perform the request

		return Response()
	}

	func refreshToken() {
		synchronizationQueue.async(flags: .barrier) {
			// .barrier means the block is executed on the queue
			// exclusively, without any other executing at the same time

			// refresh token
		}
	}
}
```
But in modern concurrency, there is no such concept as serialization. One can think that actors give us just that since they eliminate the data race and the code in `actor` is guaranteed to be executed exclusively, but it's not enough.
```swift
actor Service {
	var token: String = ""

	func perform(request: Request) async throws -> Response {
		try /*@START_HIGHLIGHT@*/await/*@END_HIGHLIGHT@*/ /*@START_MENU_TOKEN@*/actualFunctionThatPerforms(request: request, token: token)/*@END_MENU_TOKEN@*/
	}

	func refreshToken() async throws {
		try /*@START_HIGHLIGHT@*/await/*@END_HIGHLIGHT@*/ /*@START_MENU_TOKEN@*/actualFunctionThatRefreshes(token: token)/*@END_MENU_TOKEN@*/
	}
}
```
Every `await` in the code above is a suspension point. Even though data race is not possible when using actors, race condition is. When we wait for some function, the execution on the actor suspends, and now it's free to execute other code that is scheduled. It's easy to see that when we await a request in `refreshToken()`, the execution suspends, and the actor is now free to execute any other requests or even other calls to `refreshToken()` with the same expired token. We need a way to serialize the execution while using modern concurrency to make sure that our `refreshTokens()` finished before we can proceed. First, let's imagine how it would look.

# The suggested API
Here is what our serialization service will look like: we have `serialize(_:)` method that accepts the closure to be executed exclusively in the serialized context.
```swift
// WARNING: This code does not compile yet. It is only
// for you to see the possible usage of our API
actor SerializationService {
	/// The method for execution serizalization. Every subsequent
	/// call suspends execution before the first one finishes, then the next
	/// one continues, and so on.
	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		/* to be implemented */
	}
}
```
## `@Sendable`
`@Sendable` is a special attribute signaling to the compiler that our closure is safe to use in the async context. It means that it only interacts with other `Sendable` types, the values it captures are `Sendable` and copied. Think of it as async-safe, similarly to thread-safe.
# Implementing serialization
Now, how do we actually implement it? Well, let's start simple and refine our solution as we go further. First, we need a way to know if the operation is going already:
```swift
actor SerializationService {
	var operationGoing = false

	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		if operationGoing {
			// wait until it's done
		}
		defer { operationGoing = false }

		operationGoing = true
		return await closure()
	}
}
```
But how do we wait until the current task is done? Well, we can wrap our operation in the `Task` and await its value:
```swift
actor SerializationService {
	var currentTask: Task<Void, Never>?

	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		if let currentTask {
			await currentTask.value
		}
		defer { currentTask = nil }
		let task = Task {
			await closure()
		}
		// we create a new one for subsequent calls to await on
		currentTask = Task { 
			_ = await task.value
		}
		return await task.value
	}
}
```
Now we know if something is already going on. Our method works fine for two subsequent calls, but if we call it three times, our second and third calls will awaken after the first one finishes. This is easily fixed by rewriting our `if` statement to be `while` instead:
```swift
actor SerializationService {
	var currentTask: Task<Void, Never>?

	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		while let currentTask {
			await currentTask.value // 1
		}
		defer { currentTask = nil }
		let task = Task {
			await closure()
		}
		currentTask = Task { 
			// we cannot just cast our task, so we create a new one for 
			// subsequent calls to await
			_ = await task.value
		}
		return await task.value // 2
	}
}
```
If there is a task going, we wait until it's finished, and then one of the subsequent tasks continues. It might seem fine, but there is a catch. You see, the order in which the tasks awaiting a value are awakened is not guaranteed by the framework, and we can easily get ourselves into a situation where our first await will gain control before the second, and there will be an infinite loop because the `currentTask` will never be nilled. We need a way to transfer the control back to the second one in that case, and it turns out there is a special method for just that.
```swift
actor SerializationService {
	var currentTask: Task<Void, Never>?

	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		while let currentTask {
			await currentTask.value // 1
			await Task.yield()
		}
		defer { currentTask = nil }
		let task = Task {
			await closure()
		}
		currentTask = Task { 
			// we cannot just cast our task, so we create a new one for 
			// subsequent calls to await on
			_ = await task.value
		}
		return await task.value // 2
	}
}
```
`Task.yield()` suspends the current function and transfers control to another task, and, at some point in the future, the code after our second `await` will continue. And now we don't even need a task to await in subsequent calls; we can replace it with a `Bool` value indicating that there is an ongoing operation in progress:
```swift
actor SerializationService {
	var operationRunning = false

	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		while operationRunning {
			await Task.yield()
		}
		defer { operationRunning = false }

		operationRunning = true
		return await closure()
	}
}
```
We can also remove the `@escaping` attribute since our closure is called directly in the method.
```swift
actor SerializationService {
	var operationRunning = false

	func serialize<T>(
		_ closure: @Sendable () async -> T
	) async -> T {
		while operationRunning {
			await Task.yield()
		}
		defer { operationRunning = false }

		operationRunning = true
		return await closure()
	}
}
```
Now that we have a basic implementation, let's enhance it.
# Reentrancy
What if our serialized function at some point calls another one that also serializes its execution? Then we get an `async/await` version of a deadlock. We need to make the `serialize(_:)` method reentrant. First, we want to store multiple current tasks. Second, we need a way to know if we're in a serialized context right now. Let's define our `currentTasks` as a dictionary instead of a single task:
```swift
actor SerializationService {
	var operationRunning: [/*@START_MENU_TOKEN@*/Key/*@END_MENU_TOKEN@*/: Bool] = [:]

	func serialize<T>(
		_ closure: @Sendable () async -> T
	) async -> T {
		let key = /*@START_MENU_TOKEN@*/Key()/*@END_MENU_TOKEN@*/
		while operationRunning[key, default: false] {
			await Task.yield()
		}
		defer { operationRunning[key] = false }

		operationRunning[key] = true
		return await closure()
	}
}
```
Now what about the key? Let's have the depth of the recursive calls as the key to our dictionary:
```swift
actor SerializationService {
	var operationRunning: [/*@START_MENU_TOKEN@*/Key/*@END_MENU_TOKEN@*/: Bool] = [:]

	func serialize<T>(
		_ closure: @Sendable () async -> T
	) async -> T {
		let key = /*@START_MENU_TOKEN@*/currentDepth/*@END_MENU_TOKEN@*/
		while operationRunning[key, default: false] {
			await Task.yield()
		}
		defer { operationRunning[key] = false }

		operationRunning[key] = true
		return await closure()
	}
}
```
But how do we get the current depth? `TaskLocal`s can help!
## `TaskLocal`
`TaskLocal` is a special property wrapper for storing data in unique storage for each task. It is similar to thread local variables. The difference between task locals and thread locals is that task local values are inherited (copied) by the child task. And we can change the task local variable for the concrete task using `TaskLocal`'s projected value's method `withValue(_:operation:)` to override the value for the given operation. Let's do just that.
```swift
actor SerializationService {
	@TaskLocal
	static var currentDepth = 0

	var operationRunning: [Int: Bool] = [:]

	func serialize<T>(
		_ closure: @Sendable () async -> T
	) async -> T {
		let key = SerializationService.currentDepth
		while operationRunning[key, default: false] {
			await Task.yield()
		}
		defer { operationRunning[key] = false }

		operationRunning[key] = true
		return await SerializationService.$currentDepth.withValue(key + 1) {
			await closure()
		}
	}
}
```
Now our serialization method allows reentrancy, but it only accepts closures that don't throw, yet most of the time the functions we'll pass here will be throwing, so let's fix that.
# Making our closure throwing
If we simply make our method throwing, we lose the ability to use it with non-throwing functions. One possible alternative is `rethrows`.
## `rethrows`
One of the coolest Swift features is the transparent conversion of non-throwing functions to throwing ones. And the `rethrows` keyword allows us to write a single method for both of them. Take a look at `Array`'s `map(_:)` method's signature:
```swift
func map<T>(_ transform: (Element) throws -> T) rethrows -> [T]
```
It accepts a throwing function, yet it does not throw itself when we pass it a non-throwing one:
```swift
let array = [0, 1, 2, 3]
let increased = array.map { $0 + 1 } // no try keyword needed
```
This is cool, but its semantics are slightly different than it might seem. When you call `Array`'s `map(_:)` with a throwing parameter, you know that it will only throw the error you throw in the closure, but it's not necessary that the type of error be the same. The function that accepts throwing closure and has `rethrows` in its signature may actually substitute the error:
```swift
```swift
struct MapError<Element>: Error {
  var failedElement: Element
  var underlyingError: any Error
}

extension Collection {
  func mapEnriched<T>(body: (Element) throws -> T) rethrows -> [T] {
    var result: [T] = []
    for element in self {
      do {
        result.append(try body(element))
      } catch {
        // Provide more information about the failure
        throw MapError(failedElement: element, underlyingError: error)
      }
    }
    return result
  }
}
```
Right now, `rethrows` is the only option for us, but there is another way in the future version of Swift. To use it, you need to change the Swift toolchain and enable the feature, but let's talk about it now, so that I don't need to edit this article once this feature is available. And this feature is typed `throws`.
## Typed `throws`
This feature allows us to specialize the type of error thrown from a function, and we can write a function that rethrows the same type of error:
```swift
func select<P, R, E: Swift.Error>(
	_ parameter1: P,
	_ parameter2: P
	operation: (P) throws(E) -> R
) throws(E) -> T {
	do {
		return try operation(parameter1)
	} catch {
		return try operation(parameter2)
	}
}
```
It works the same way as `rethrows` in the sense that it doesn't throw if the `operation` doesn't, but when it does, it throws exactly the same type of error that `operation` throws. So we can utilize typed `throws` at the call site:
```swift
enum Error: Swift.Error {
	case parameterInvalid
	case somethingWrong
}

func inverse(number: Double) throws(Error) -> Double {
	guard number != 0 else { throw .parameterInvalid }
	guard !Task.isCancelled else { throw .somethingWrong }

	return 1 / number
}

do {
	print(try select(0, 0, operation: inverse(number:)))
} catch {
	switch error {
	case .parameterInvalid:
		print("Invalid parameters")
	case .somethingWrong:
		print("Task is cancelled")
	}
}
```
We can do the same for our serialization method, as it doesn't have its own errors. But this feature is not live yet, so let's stick to the `rethrows`. To start supporting throwing functions, we only need to mark the `closure` and the method as `throws` and `rethrows` respectively, and put the `try` operator in the places it needs to be in.
```swift
actor SerializationService {
	@TaskLocal
	static var currentDepth = 0

	var operationRunning: [Int: Bool] = [:]

	func serialize<T>(
		_ closure: @Sendable () async throws -> T
	) async rethrows -> T {
		let key = SerializationService.currentDepth
		while operationRunning[key, default: false] {
			await Task.yield()
		}
		defer { operationRunning[key] = false }

		operationRunning[key] = true
		return try await SerializationService.$currentDepth.withValue(key + 1) {
			try await closure()
		}
	}
}
```
That's it. We have a working serialization mechanism. Although there is one minor optimization we're about to make. Right now, whenever our code is awakened in the `while` cycle, we immediately yield control back if there is an already going task. This might be okay, as it's really inexpensive, but it's not free. If you have lots of long running tasks and lots of them are in queue for serialization, you might want to remove all the unnecessary control transfers because it adds a lot of overhead in that case. We need a way to only awaken the waiting methods if the task is finished.
# Waiting before the task finishes
We can't just put our operation in a task to await in subsequent calls, as we did earlier, because our closure must not escape. There is a special global function `withoutActuallyEscaping(_:do:)` that transforms a non-escaping closure into an escaping one. It's there for cases just like this, when we know our closure does not escape even if we use the code that only accepts escaping closure. But, unfortunately, there is no such function for `async` closures. We need another way to create a reference to our ongoing operation. And there is a special instrument that will help us, continuations.
## Continuations
Continuation is basically the state of the program at some point in time. Actually, when we write async code, the compiler splits our functions into multiple continuations:
```swift
func performSomeWork() async {
	try? await Task.sleep(nanoseconds: NSEC_PER_SEC)
}

func asyncFunc() async {
	// /*@START_HIGHLIGHT@*/1/*@END_HIGHLIGHT@*/
	await performSomeWork()
	// /*@START_HIGHLIGHT@*/2/*@END_HIGHLIGHT@*/
	await preformSomeWork()
	// /*@START_HIGHLIGHT@*/3/*@END_HIGHLIGHT@*/
}
```
Our `asyncFunc` is split by the compiler into three parts. The first part just gets executed when we call the function; the parts ==2== and ==3== are continuations. They encapsulate all the state (task locals, stack, call stack, etc.), and when the `performSomeWork` finishes and returns control back, the continuation is resumed and the program continues where it left off. In Swift, we can create our own continuation. Their primary use case is wrapping old callback-based asynchronous functions to use them in async code as if they were async.
```swift
func loadInt(then operation: @escaping (Int) -> Void) {
	// Imitate loading
	DispatchQueue.global().async {
		operation(1)
	}
}

func loadInt() async -> Int {
	await withCheckedContinuation { c in
		loadInt(then: c.resume(returning:))
	}
}
```
But we can also store the continuation and resume it later, when our operation is complete. Let's try:
```swift
actor SerializationService {
	@TaskLocal
	static var currentDepth = 0

	var currentTasks: [Int: Task<Void, Never>] = [:]

	func serialize<T>(
		_ closure: @Sendable () async throws -> T
	) async rethrows -> T {
		let key = SerializationService.currentDepth
		while let current = currentTasks[key] {
			await current.value
			await Task.yield()
		}
		var continuation: CheckedContinuation<Void, Never>?
		let task = Task {
			await withCheckedContinuation { c in
				continuation = c // error
			}
		}

		defer { 
			currentTasks[key] = nil
			continuation?.resume()
		}
		
		currentTasks[key] = task
		return try await SerializationService.$currentDepth
			.withValue(key + 1) {
				try await closure()
			}
	}
}
```
But we can't do just that:
>[!error]
>Mutation of captured var 'continuation' in concurrently-executing code

Our `continuation` is captured by the closure we pass in the `withCheckedContinuation` function, but we cannot mutate it because the compiler can't guarantee that it's accessed exclusively. But as we know, there is a special type designed for eliminating data races, and our `SerializationService` is an example of that type. Actors prevent data races by guaranteeing exclusive access to their properties. And `Task`s inherit not only task local values but also so-called actor context. Basically, it means that the closure you pass to `Task.init` is executed on the same actor you call `Task.init` from. Which means we can mutate its properties freely. So we need to store the `continuation` somewhere in our actor. Let's do just that:
```swift
actor SerializationService {
	typealias AwaitableTask = Task<Void, Never>
	typealias Continuation = CheckedContinuation<Void, Never>

	@TaskLocal
	static var currentDepth = 0

	var currentTasks: [Int: AwaitableTask] = [:]
	var currentContinuations: [Int: Continuation] = [:]

	func serialize<T>(
		_ closure: @Sendable () async throws -> T
	) async rethrows -> T {
		let key = SerializationService.currentDepth
		while let current = currentTasks[key] { // /*@START_HIGHLIGHT@*/1/*@END_HIGHLIGHT@*/
			await current.value
			await Task.yield()
		}

		let task = Task { // /*@START_HIGHLIGHT@*/2/*@END_HIGHLIGHT@*/
			await withCheckedContinuation { c in
				currentContinuations[key] = c
			}
		}

		defer { // /*@START_HIGHLIGHT@*/3/*@END_HIGHLIGHT@*/
			let continuation = currentContinuations[key]
			currentTasks[key] = nil
			currentContinuations[key] = nil
			continuation?.resume()
		}
		
		currentTasks[key] = task // /*@START_HIGHLIGHT@*/4/*@END_HIGHLIGHT@*/
		return try await SerializationService.$currentDepth
			.withValue(key + 1) {
				try await closure()
			}
	}
}
```
Before we fix some non-obvious mistakes, let's go through the code to see them. The code before the creation of the task (==1==) is almost the same, and it works as expected. When we create a task (==2==), we might think that the closure we pass in the `init` is called immediately, but it's not. You see, the closure must be performed in the same actor context (i.e., on the same actor), but the `Task.init` is not `async` and it doesn't suspend our method when we call it. This means that the closure we pass in the `init` is actually _scheduled_ to run on the same actor somewhere in the future. Let's remember that. Next, in the `defer` body (==3==), we get the continuation for the task we created, nil out the task, and then call `resume()` method to awaken all the awaiting tasks. Then, we set the created task in our dictionary (==4==) and perform the operation. You might already see the problem, but if not, let me highlight it. The default value for our `continuation` is nil when we set it (==4==), and because the `Task` (==2==) does not execute its closure immediately, we might find ourselves in a situation where we have already finished running our operation, but there is still no continuation for us to resume. We need to wait until the continuation is present before finishing our method; luckily, we already know how to do it. We can use `Task.yield` to give up control until we get the continuation.
```swift
actor SerializationService {
	typealias AwaitableTask = Task<Void, Never>
	typealias Continuation = CheckedContinuation<Void, Never>

	@TaskLocal
	static var currentDepth = 0

	var currentTasks: [Int: AwaitableTask] = [:]
	var currentContinuations: [Int: Continuation] = [:]

	func serialize<T>(
		_ closure: @Sendable () async throws -> T
	) async rethrows -> T {
		let key = SerializationService.currentDepth
		while let current = currentTasks[key] { // /*@START_HIGHLIGHT@*/1/*@END_HIGHLIGHT@*/
			await current.value
			await Task.yield()
		}

		let task = Task { // /*@START_HIGHLIGHT@*/2/*@END_HIGHLIGHT@*/
			await withCheckedContinuation { c in
				currentContinuations[key] = c
			}
		}

		defer { // /*@START_HIGHLIGHT@*/3/*@END_HIGHLIGHT@*/
			let continuation = currentContinuations[key]
			currentTasks[key] = nil
			currentContinuations[key] = nil
			continuation?.resume()
		}
		
		currentTasks[key] = task // /*@START_HIGHLIGHT@*/4/*@END_HIGHLIGHT@*/
		let result =  try await SerializationService.$currentDepth
			.withValue(key + 1) {
				try await closure()
			}
		while currentContinuations[key] == nil {
			await Task.yield() // /*@START_HIGHLIGHT@*/5/*@END_HIGHLIGHT@*/
		}

		return result
	}
}
```
Now we fixed the continuation mistake, and the code might seem fine as is, but there is another problem.
## Priority inversion
Priority inversion is a scenario in which a higher-priority task is waiting for a lower-priority task before it can proceed. We want to avoid such situations as much as we can. One might think that priority inversion is not possible since a task's priority can be escalated if another task with a higher priority is awaiting it. Well, yes, but the important thing here is that we need to await the task's `value` in order to escalate its priority. In the code above, the only place where we await on the task we create is the `while` loop (==1==), but it happens in the other context, and the priority escalation only happens up to the subsequent call's priority. Although it's not easy, we can run in the situation where our code waiting for the continuation to be present will be awakened multiple times while the `Task` that creates the continuation won't run because it has a lower priority. We can fix it by assigning `.high` priority to the task we create:
```swift
actor SerializationService {
	typealias AwaitableTask = Task<Void, Never>
	typealias Continuation = CheckedContinuation<Void, Never>

	@TaskLocal
	static var currentDepth = 0

	var currentTasks: [Int: AwaitableTask] = [:]
	var currentContinuations: [Int: Continuation] = [:]

	func serialize<T>(
		_ closure: @Sendable () async throws -> T
	) async rethrows -> T {
		let key = SerializationService.currentDepth
		while let current = currentTasks[key] {
			await current.value
			await Task.yield()
		}

		let task = Task(/*@START_HIGHLIGHT@*/priority: .high/*@END_HIGHLIGHT@*/) {
			await withCheckedContinuation { c in
				currentContinuations[key] = c
			}
		}

		defer {
			let continuation = currentContinuations[key]
			currentTasks[key] = nil
			currentContinuations[key] = nil
			continuation?.resume()
		}
		
		currentTasks[key] = task
		let result =  try await SerializationService.$currentDepth
			.withValue(key + 1) {
				try await closure()
			}
		while currentContinuations[key] == nil {
			await Task.yield()
		}

		return result
	}
}
```
# On task locals and structured concurrency
Because we use task local values, our implementation is now constrained to be used from either a structured concurrency context or unstructured tasks using `Task.init`. If you use `Task.detached`, your task will not inherit task local values, and our method won't work properly, so be aware.

# Conclusion
Today we implemented the missing concept from the pre-concurrency world: execution serialization. We made a service that can queue async closures and wait until the previous one is finished before starting another one. The concept is really useful in our work, and once we have it implemented, we can migrate to `async/await` even more easily. Next time, we'll talk about an interesting SwiftUI case I stumbled upon at work. See you in the [[let-swiftui-do-it|next article]].
