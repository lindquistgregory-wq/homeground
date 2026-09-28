Pod::Spec.new do |s|
  s.name           = 'UserSync'
  s.version        = '0.1.0'
  s.summary        = 'Homeground sync via the user\'s CloudKit private database'
  s.author         = 'Homeground'
  s.homepage       = 'https://github.com/lindquistgregory-wq/homeground'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '17.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'CloudKit'
end
