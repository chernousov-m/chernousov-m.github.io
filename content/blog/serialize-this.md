---
title: The missing concept from the pre-concurrency world - serialization
date: 2024-05-02
description: Today we'll implement the missing concept in modern concurrency - serialized execution. And we'll talk about its use cases in our apps
show-content-meta: "false"
---
# Serialization in `async/await` world
In pre-concurrency world we had a useful concept of serialization when we worked with dispatch queues. But in `async/await` this concept seems to be missing. Let's implement execution serialization ourselves and discuss the use cases

# What is serialization?
A good example of the use case for serialization is a token refresh mechanism. Our server requests might be parallel to speed up the loading of the screen, but the token refresh must be performed exclusively; all the other requests must wait for the refresh to complete before they can proceed. Typically this is implemented using concurrent `DispatchQueue` and a barrier to refresh the token. Here is the toy example:
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
But in modern concurrency there is no such concept as serialization. One can think that actors give us just that since they eliminate data race and the code in `actor` is guaranteed to be executed exclusively, but it's not enough.
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
Every `await` in the code above is a suspension point. Even though data race is not possible when using actors, race condition is. When we await for some function, the execution on the actor suspends and now it's free to execute other code that is scheduled. It's easy to see that when we await on request in `refreshToken()`, the execution suspends and the actor is now free to execute any other requests or even other calls to `refreshToken()` with the same expired token. We need a way to serialize the execution while using modern concurrency to make sure that our `refreshTokens()` finished before we can proceed. First let's imagine how would it look.

# The suggested API
Here is how our serialization service will look like. We have a method that is similar 
```swift
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

actor Service {
	var token: String?
	let serializationService = SerializationService()

	func perform(request: Request) async throws -> Response {
		while token == nil {
			await refreshToken()
		}
		guard let token else { throw Error.unauthorized }

		do {
			return try await actualFunctionThatPerforms(
				request: request,
				token: token
			)
		} catch /* unauthorized */ {
			token = nil
			return try await perform(request: request)
		}
	}

	func refreshToken() async throws {
		await serializationService.serialize {
			self.token = await self.actualFunctionThatRefreshes(
				token: self.token
			)
		}
	}

	func actualFunctionThatRefreshes(
		token: String?
	) async -> String {
		guard let token else { 
			// aquire token
			return /*@START_MENU_TOKEN@*/token/*@END_MENU_TOKEN@*/
		}

		// perform the actual refresh
		return /*@START_MENU_TOKEN@*/token/*@END_MENU_TOKEN@*/
	}
}
```
The code has a lot of room for improvement; for example it refreshes the token multiple times if there were lots of requests when the token expired, but the token refresh flow is not the topic of this article. The important part for us is the serialization of the token refresh. Our `refreshTokens()` method serializes its execution so that only one refresh at the time happens. Now let's implement it.
# Implementing serialization

Now, how do we actually implement it? Well, let's start simple and refine our solution as we go further. First, we need a way to know if the operation is going already:
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
		currentTask = Task { 
			// we cannot just cast our task, so we create a new one for 
			// subsequent calls to await on
			_ = await task.value
		}
		return await task.value
	}
}
```
Now we know if something is already going on. Our method works fine for two subsequent calls, but if we call it thrice our second and third call will awake after the first one finishes. This is easily fixed by rewriting our `if` statement to be `while` instead:
```swift
actor SerializationService {
	var currentTask: Task<Void, Never>?

	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		while let currentTask {
			await currentTask.value
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
		return await task.value
	}
}
```
Now if there is a task going we wait before it's finished and then one of the subsequent tasks continues. It might seem fine, but there is a catch. You see, the order in which the tasks awaiting on a value are awaken is not guaranteed by the framework and we can easily get ourselves in a situation where our first await will gain control before the second and there will be infinite loop because the `currentTask` will never be nilled. We need a wait to transfer the control back to the second one in that case, and it turns out there is a special method for just that.
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
`Task.yield()` suspends current function and transfers control to another task and, at some point in future, the code after our second `await` will continue. Now that we have a working implementation let's enhance it with other features.

# Reentrancy
What if our serialized function at some point calls another one that also serializes its execution? Then we get an `async/await` version of a deadlock. We need to make the `serialize(_:)` method reentrant. First, we want to store multiple current tasks. Second, we need a way to know if we're in serialized context right now. Let's define our `currentTasks` as a dictionary instead of a single task:
```swift
actor SerializationService {
	var currentTasks: [/*@START_MENU_TOKEN@*/Key/*@END_MENU_TOKEN@*/: Task<Void, Never>] = [:]

	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		let key = /*@START_MENU_TOKEN@*/Key()/*@END_MENU_TOKEN@*/
		while let current = currentTasks[key] {
			await current.value
			await Task.yield()
		}
		defer { currentTasks[key] = nil }
		let task = Task {
			await closure()
		}
		currentTasks[key] = Task { 
			_ = await task.value
		}
		return await task.value
	}
}
```
Now what about the key? Let's have the depth of the recursive calls as the key for our dictionary:
```swift
actor SerializationService {
	var currentTasks: [Int: Task<Void, Never>] = [:]

	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		let key = /*@START_MENU_TOKEN@*/currentDepth/*@END_MENU_TOKEN@*/
		while let current = currentTasks[key] {
			await current.value
			await Task.yield()
		}
		defer { currentTasks[key] = nil }
		let task = Task {
			// somehow increase current depth for the closure
			await closure()
		}
		currentTasks[key] = Task { 
			_ = await task.value
		}
		return await task.value
	}
}
```
But how do we get the current depth? `TaskLocal`s can help!

## `TaskLocal`
`TaskLocal` is a special property wrapper for storing data in a unique for each task storage. It is similar to thread local variables. What it means is that every task we create has its own storage for task locals. And we can change the task local variable for the concrete task, using `TaskLocal`'s projected value's method `withValue(_:operation:)` to override the value for the given operation. Let's do just that.
```swift
actor SerializationService {
	@TaskLocal
	static var currentDepth = 0

	var currentTasks: [Int: Task<Void, Never>] = [:]

	func serialize<T>(
		_ closure: @escaping @Sendable () async -> T
	) async -> T {
		let key = SerializationService.currentDepth
		while let current = currentTasks[key] {
			await current.value
			await Task.yield()
		}
		defer { currentTasks[key] = nil }
		let task = Task {
			await SerializationService.$currentDepth.withValue(key + 1) {
				await closure()
			}
		}
		currentTasks[key] = Task { 
			_ = await task.value
		}
		return await task.value
	}
}
```
Now our serialization method allows reentrancy, but it only accepts `@escaping` closures that don't throw, yet most of the times the functions we'll pass here will throw, so let's fix that.
# Making our closure throwing
If we simply make our closure and the `serialize(_:)` method throwing, we lose the ability to use it with non-throwing functions. One possible alternative is `rethrows`.
## `rethrows`
One of the coolest swift features is transparent conversion of non-throwing functions to throwing ones. And `rethrows` keyword allows us to write a single method for both of them. Take a look at `Array`s `map(_:)` method's signature:
```swift
func map<T>(_ transform: (Element) throws -> T) rethrows -> [T]
```
It accepts throwing function, yet it does not throw itself when we pass it a non-throwing one:
```swift
let array = [0, 1, 2, 3]
let increased = array.map { $0 + 1 } // no try keyword needed
```
This is cool, but its semantics is slightly different than it might seem. When you call `Array`'s `map(_:)` with a throwing parameter you know that it will only throw the error you throw in the closure, but it's not necessary that the type of error will be the same. The function that accepts throwing closure and has `rethrows` in its signature may actually substitute the error:
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
Right now, `rethrows` is the only option for us, but there is another way in the future version of Swift. To use it you need to change the Swift toolchain and enable the feature, but let's talk about it now, so that I don't need to edit this article once this feature is available. And this feature is typed `throws`.
## Typed `throws`
This feature allows us to specialize the error thrown from a function. 
## Continuation

