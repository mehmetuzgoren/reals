#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -resolvePackageDependencies -project TAKE.xcodeproj -scheme TAKE
echo TAKE_RESOLVED_BEGIN
cat TAKE.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
echo TAKE_RESOLVED_END
xcodebuild -project TAKE.xcodeproj -scheme TAKE -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build ARCHS=arm64 CODE_SIGNING_ALLOWED=NO build
