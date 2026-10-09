import ExpoModulesCore
import UIKit

public class ScrubberModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Scrubber")

    View(ScrubberView.self) {
      Events("onScrub", "onCommit")

      Prop("max") { (view: ScrubberView, max: Double) in
        view.slider.maximumValue = Float(max > 0 ? max : 1)
        view.slider.isEnabled = max > 0
      }

      Prop("value") { (view: ScrubberView, value: Double) in
        view.follow(Float(value))
      }

      Prop("step") { (view: ScrubberView, step: Double) in
        view.slider.step = Float(step)
      }

      Prop("tint") { (view: ScrubberView, color: UIColor?) in
        view.slider.minimumTrackTintColor = color
      }

      Prop("label") { (view: ScrubberView, label: String) in
        view.slider.accessibilityLabel = label
      }

      Prop("valueText") { (view: ScrubberView, text: String) in
        view.slider.spoken = text
      }
    }
  }
}

final class ScrubberView: ExpoView {
  let slider = GrabSlider()
  let onScrub = EventDispatcher()
  let onCommit = EventDispatcher()
  // the slider can report one more change after the finger lifts; nothing is a scrub once the commit is out
  private var held = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    slider.addTarget(self, action: #selector(pressed), for: .touchDown)
    slider.addTarget(self, action: #selector(scrubbed), for: .valueChanged)
    slider.addTarget(self, action: #selector(released), for: [.touchUpInside, .touchUpOutside, .touchCancel])
    slider.stepped = { [weak self] in self?.commit() }
    addSubview(slider)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    slider.frame = bounds
  }

  func follow(_ value: Float) {
    if !held { slider.value = value }
  }

  @objc private func pressed() {
    held = true
    onScrub(["value": Double(slider.value)])
  }

  @objc private func scrubbed() {
    if held { onScrub(["value": Double(slider.value)]) }
  }

  @objc private func released() {
    if held { commit() }
  }

  private func commit() {
    held = false
    onCommit(["value": Double(slider.value)])
  }
}

/// A slider whose thumb comes to the finger wherever the strip is touched, so the whole strip is the handle.
final class GrabSlider: UISlider {
  var step: Float = 15
  var spoken: String?
  var stepped: (() -> Void)?

  // moved at hit-testing, before the slider decides whether the touch began on its thumb
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    if hit != nil, event?.type == .touches, isEnabled, !isTracking { bringThumb(to: point.x) }
    return hit
  }

  private func bringThumb(to x: CGFloat) {
    let track = trackRect(forBounds: bounds)
    let thumb = thumbRect(forBounds: bounds, trackRect: track, value: value).width
    let travel = track.width - thumb
    guard travel > 0 else { return }
    let fraction = (x - track.minX - thumb / 2) / travel
    setValue(minimumValue + Float(min(max(fraction, 0), 1)) * (maximumValue - minimumValue), animated: false)
    layoutIfNeeded()
  }

  override var accessibilityValue: String? {
    get { spoken ?? super.accessibilityValue }
    set { super.accessibilityValue = newValue }
  }

  override func accessibilityIncrement() {
    setValue(min(value + step, maximumValue), animated: false)
    stepped?()
  }

  override func accessibilityDecrement() {
    setValue(max(value - step, minimumValue), animated: false)
    stepped?()
  }
}
