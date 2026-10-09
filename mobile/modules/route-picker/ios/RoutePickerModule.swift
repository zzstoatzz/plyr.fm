import AVKit
import ExpoModulesCore

public class RoutePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RoutePicker")

    View(RoutePickerView.self) {
      Prop("tint") { (view: RoutePickerView, color: UIColor?) in
        view.picker.tintColor = color
      }

      Prop("activeTint") { (view: RoutePickerView, color: UIColor?) in
        view.picker.activeTintColor = color
      }
    }
  }
}

final class RoutePickerView: ExpoView {
  let picker = AVRoutePickerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    picker.prioritizesVideoDevices = false
    addSubview(picker)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    picker.frame = bounds
  }
}
