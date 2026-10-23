Pod::Spec.new do |s|
  s.name           = 'RoutePicker'
  s.version        = '1.0.0'
  s.summary        = 'The system audio route picker (AirPlay) as a view'
  s.description    = 'Wraps AVRoutePickerView so the player can offer AirPlay and other audio outputs'
  s.author         = 'plyr.fm'
  s.homepage       = 'https://plyr.fm'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
