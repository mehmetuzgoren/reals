#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -resolvePackageDependencies -project TAKE.xcodeproj -scheme TAKE
echo TAKE_RESOLVED_BEGIN
cat TAKE.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
echo TAKE_RESOLVED_END
xcodebuild -project TAKE.xcodeproj -scheme TAKE -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build ARCHS=arm64 CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual build
codesign --verify --deep --strict build/Build/Products/Debug-iphonesimulator/TAKE.app
codesign -d --entitlements :- build/Build/Products/Debug-iphonesimulator/TAKE.app
