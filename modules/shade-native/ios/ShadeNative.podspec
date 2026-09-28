Pod::Spec.new do |s|
  s.name           = 'ShadeNative'
  s.version        = '0.1.0'
  s.summary        = 'Plotwright shade engine inner loop'
  s.author         = 'Plotwright'
  s.homepage       = 'https://github.com/lindquistgregory-wq/homeground'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '17.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'SWIFT_OPTIMIZATION_LEVEL' => '-O' }
end
