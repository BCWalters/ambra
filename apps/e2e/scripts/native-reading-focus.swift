import ApplicationServices
import AppKit
import Foundation

func fail(_ message: String) -> Never {
  fputs(message + "\n", stderr)
  exit(1)
}

guard CommandLine.arguments.count >= 2,
  let pid = Int32(CommandLine.arguments[1]) else { fail("Expected owned browser PID") }
guard AXIsProcessTrusted() else { fail("Existing accessibility permission required") }
let app = AXUIElementCreateApplication(pid)

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  AXUIElementCopyAttributeValue(element, name as CFString, &value)
  return value
}

func parameter(_ element: AXUIElement, _ name: String, _ value: CFTypeRef) -> CFTypeRef? {
  var result: CFTypeRef?
  AXUIElementCopyParameterizedAttributeValue(element, name as CFString, value, &result)
  return result
}

func element(_ value: CFTypeRef?) -> AXUIElement? {
  guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
  return (value as! AXUIElement)
}

func webArea(_ target: AXUIElement) -> AXUIElement? {
  var current: AXUIElement? = target
  for _ in 0..<50 {
    guard let candidate = current else { return nil }
    if attribute(candidate, kAXRoleAttribute) as? String == "AXWebArea" { return candidate }
    current = element(attribute(candidate, kAXParentAttribute))
  }
  return nil
}

func url(_ target: AXUIElement) -> String {
  (attribute(target, "AXURL") as? URL)?.absoluteString ?? ""
}

func nativeState() -> [String: Any] {
  guard let focus = element(attribute(app, kAXFocusedUIElementAttribute)),
    let area = webArea(focus),
    let rawRange = attribute(area, "AXSelectedTextMarkerRange"),
    CFGetTypeID(rawRange) == AXTextMarkerRangeGetTypeID() else { return [:] }
  let range = rawRange as! AXTextMarkerRange
  let start = AXTextMarkerRangeCopyStartMarker(range)
  let end = AXTextMarkerRangeCopyEndMarker(range)
  guard let owner = element(parameter(area, "AXUIElementForTextMarker", start)),
    let ownerArea = webArea(owner) else { return [:] }
  var focusPid: pid_t = 0
  AXUIElementGetPid(focus, &focusPid)
  return [
    "focusPid": focusPid,
    "frontmostPid": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
    "focused": attribute(focus, kAXFocusedAttribute) as? Bool ?? false,
    "focusRole": attribute(focus, kAXRoleAttribute) as? String ?? "",
    "focusTitle": attribute(focus, kAXTitleAttribute) as? String ?? "",
    "webAreaURL": url(area),
    "selectionOwnerURL": url(ownerArea),
    "selectionOwnerRole": attribute(owner, kAXRoleAttribute) as? String ?? "",
    "selectionOwnerText": attribute(owner, kAXValueAttribute) as? String ?? "",
    "selectionCollapsed": CFEqual(start, end),
    "selectionIndex": parameter(area, "AXIndexForTextMarker", start) as? NSNumber ?? -1,
  ]
}

func findButton(_ target: AXUIElement, _ sourceURL: String, _ depth: Int = 0) -> AXUIElement? {
  if depth > 50 { return nil }
  if attribute(target, kAXRoleAttribute) as? String == kAXButtonRole,
    (attribute(target, kAXTitleAttribute) as? String == "Next section" ||
      attribute(target, kAXDescriptionAttribute) as? String == "Next section"),
    let area = webArea(target), url(area) == sourceURL { return target }
  for child in attribute(target, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
    if let found = findButton(child, sourceURL, depth + 1) { return found }
  }
  return nil
}

let before = nativeState()
if CommandLine.arguments.count > 2 {
  let sourceURL = CommandLine.arguments[2]
  guard let button = findButton(app, sourceURL) else { fail("Source document's native Next section button not found") }
  let result = AXUIElementPerformAction(button, kAXPressAction as CFString)
  guard result == .success else { fail("AXPress failed: \(result)") }
  for _ in 0..<50 {
    if let destination = nativeState()["webAreaURL"] as? String,
      !destination.isEmpty && destination != sourceURL { break }
    usleep(100000)
  }
}
let result: [String: Any] = ["before": before, "after": nativeState()]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
