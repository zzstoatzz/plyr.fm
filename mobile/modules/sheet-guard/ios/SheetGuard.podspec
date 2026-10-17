Pod::Spec.new do |s|
  s.name           = 'SheetGuard'
  s.version        = '1.0.0'
  s.summary        = 'A region of a sheet that drags do not dismiss'
  s.description    = 'Wraps AVSheetGuardView so the player can offer AirPlay and other audio outputs'
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
