require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'DictionariusHapticTick'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/smitravitz/Dictionarius'
  s.author = package['author']
  s.source = { :git => 'https://github.com/smitravitz/Dictionarius.git', :tag => 'v' + package['version'] }
  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
