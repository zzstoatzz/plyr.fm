Pod::Spec.new do |s|
  s.name           = 'Scrubber'
  s.version        = '1.0.0'
  s.summary        = 'The system slider as a playback scrubber'
  s.description    = 'Wraps AVScrubberView so the player can offer AirPlay and other audio outputs'
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
