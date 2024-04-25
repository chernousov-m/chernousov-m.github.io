---
title: Trailing closure parameter completion
date: 2024-04-26
description: Xcode allows us to code complete closure parameters at call site
---
Xcode has a cool feature, closure parameters completion. You can predefine parameter names for the trailing closure syntax:
```swift
func myFunction(
	_ operation: /*@START_HIGHLIGHT@*/(_ int: Int) -> Void/*@END_HIGHLIGHT@*/
) {
	operation(1)
}
```
And then when you call the function:
```swift
myFunction(/*@START_MENU_TOKEN@*/operation: (Int) -> Void/*@END_MENU_TOKEN@*/)
```
You press Enter and Xcode automatically names the parameter:
```swift
myFunction { int in

}
```
For the parameters that the user needs to pick the name for, you can omit the label and Xcode will let the user pick the name:
```swift
func myFunction(
	_ operation: /*@START_HIGHLIGHT@*/(_ int: Int, Int) -> Void/*@END_HIGHLIGHT@*/
) {
	operation(1, 2)
}

myFunction(/*@START_MENU_TOKEN@*/operation: (Int, Int) -> Void/*@END_MENU_TOKEN@*/)

myFunction { int, /*@START_MENU_TOKEN@*/Int/*@END_MENU_TOKEN@*/ in

}
```