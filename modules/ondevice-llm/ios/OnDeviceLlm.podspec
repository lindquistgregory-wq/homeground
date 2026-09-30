Pod::Spec.new do |s|
  s.name           = 'OnDeviceLlm'
  s.version        = '0.1.0'
  s.summary        = 'Plotwright on-device planner model bridge (Apple Foundation Models)'
  s.author         = 'Plotwright'
  s.homepage       = 'https://github.com/lindquistgregory-wq/homeground'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '17.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  # FoundationModels exists from iOS 26; weak-link it so the app still launches on iOS 17-25
  # (Apple DTS: mark frameworks newer than the deployment target Optional / -weak_framework).
  s.weak_frameworks = 'FoundationModels'
end
