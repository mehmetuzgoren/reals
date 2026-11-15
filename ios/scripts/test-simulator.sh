#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
DESTINATION="${TAKE_TEST_DESTINATION:-platform=iOS Simulator,name=iPhone 16,OS=18.5}"
set +e
xcodebuild -project TAKE.xcodeproj -scheme TAKE -configuration Debug -destination "$DESTINATION" -derivedDataPath build -resultBundlePath build/TAKE-tests.xcresult CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual test
status=$?
set -e
if [[ "${TAKE_EXPORT_MOCK_SCREENSHOTS:-0}" == "1" && -d build/TAKE-tests.xcresult ]]; then
  rm -rf build/mock-attachments
  if xcrun xcresulttool export attachments --path build/TAKE-tests.xcresult --output-path build/mock-attachments; then
    find build/mock-attachments -name '*.png' -exec sips -Z 1278 {} \; >/dev/null 2>&1 || true
    python3 scripts/export-mock-screenshots.py build/mock-attachments || true
  fi
fi
exit "$status"
