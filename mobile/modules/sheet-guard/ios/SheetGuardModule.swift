import ExpoModulesCore
import UIKit

public class SheetGuardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SheetGuard")

    View(SheetGuardView.self) {}
  }
}

/// A pan that starts inside this view is taken here and goes nowhere, so the sheet and the scroll view behind it stay put.
final class SheetGuardView: ExpoView, UIGestureRecognizerDelegate {
  private let pan = UIPanGestureRecognizer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    pan.delegate = self
    pan.cancelsTouchesInView = false
    pan.delaysTouchesBegan = false
    pan.delaysTouchesEnded = false
    addGestureRecognizer(pan)
  }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
    guard other is UIPanGestureRecognizer, let owner = other.view else { return false }
    return !owner.isDescendant(of: self)
  }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    other.view?.isDescendant(of: self) ?? false
  }
}
