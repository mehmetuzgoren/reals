#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
DESTINATION="${TAKE_TEST_DESTINATION:-platform=iOS Simulator,name=iPhone 16,OS=18.5}"
xcodebuild -project TAKE.xcodeproj -scheme TAKE -configuration Debug -destination "$DESTINATION" -derivedDataPath build -resultBundlePath build/TAKE-tests.xcresult CODE_SIGNING_ALLOWED=NO test
