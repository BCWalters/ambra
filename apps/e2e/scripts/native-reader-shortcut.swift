import ApplicationServices
import AppKit
import Carbon.HIToolbox
import Foundation

func fail(_ message: String) -> Never {
  fputs(message + "\n", stderr)
  exit(1)
}

func locked() -> Bool {
  guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return true }
  // macOS omits this key in an unlocked session; a missing session is still unsafe.
  return session["CGSSessionScreenIsLocked"] as? Bool ?? false
}

func emit(_ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
}

if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--check" {
  emit(["locked": locked(), "accessibilityTrusted": AXIsProcessTrusted(),
    "eventPostingAllowed": CGPreflightPostEventAccess()])
  exit(0)
}

guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]) else {
  fail("Expected owned browser PID and a supported shortcut")
}
guard !locked() else { fail("Native keyboard validation requires an unlocked desktop") }
guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
  fail("Existing accessibility and event-posting permissions required")
}
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
  fail("Refusing to deliver keys: owned browser is not frontmost")
}
let app = AXUIElementCreateApplication(pid)

func attribute(_ target: AXUIElement, _ name: String) -> CFTypeRef? {
  var result: CFTypeRef?
  AXUIElementCopyAttributeValue(target, name as CFString, &result)
  return result
}

func focus() -> [String: Any] {
  guard let value = attribute(app, kAXFocusedUIElementAttribute),
    CFGetTypeID(value) == AXUIElementGetTypeID() else { return [:] }
  let target = value as! AXUIElement
  var owner: pid_t = 0
  AXUIElementGetPid(target, &owner)
  return ["pid": owner, "role": attribute(target, kAXRoleAttribute) as? String ?? "",
    "title": attribute(target, kAXTitleAttribute) as? String ?? "",
    "description": attribute(target, kAXDescriptionAttribute) as? String ?? "",
    "focused": attribute(target, kAXFocusedAttribute) as? Bool ?? false]
}

let shortcut = CommandLine.arguments[2]
let key: CGKeyCode
let flags: CGEventFlags
switch shortcut {
case "Option+Shift+PageDown": key = CGKeyCode(kVK_PageDown); flags = [.maskAlternate, .maskShift]
case "Option+Shift+PageUp": key = CGKeyCode(kVK_PageUp); flags = [.maskAlternate, .maskShift]
case "Option+PageDown": key = CGKeyCode(kVK_PageDown); flags = .maskAlternate
case "Option+PageUp": key = CGKeyCode(kVK_PageUp); flags = .maskAlternate
case "Command+B": key = CGKeyCode(kVK_ANSI_B); flags = .maskCommand
case "Command+F": key = CGKeyCode(kVK_ANSI_F); flags = .maskCommand
case "Command+G": key = CGKeyCode(kVK_ANSI_G); flags = .maskCommand
case "Command+Shift+G": key = CGKeyCode(kVK_ANSI_G); flags = [.maskCommand, .maskShift]
case "Command+/": key = CGKeyCode(kVK_ANSI_Slash); flags = .maskCommand
case "Return": key = CGKeyCode(kVK_Return); flags = []
case "Escape": key = CGKeyCode(kVK_Escape); flags = []
default: fail("Unsupported shortcut")
}
let before = focus()
guard before["pid"] as? Int32 == pid else { fail("Owned browser has no native focused element") }
guard let source = CGEventSource(stateID: .privateState),
  let down = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true),
  let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false) else {
  fail("Could not create native keyboard events")
}
down.flags = flags
up.flags = flags
down.setIntegerValueField(.keyboardEventAutorepeat, value: 0)
// PID-targeted native delivery never injects keys into a different user's window.
down.postToPid(pid)
usleep(30000)
up.postToPid(pid)
usleep(150000)
emit(["pid": pid, "shortcut": shortcut, "keyCode": key, "flags": flags.rawValue,
  "frontmostPid": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
  "before": before, "after": focus()])
