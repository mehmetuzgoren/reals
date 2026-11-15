#!/bin/bash
set -euo pipefail
SOURCE="${SRCROOT}/Config/GoogleService-Info.plist"
DESTINATION="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/GoogleService-Info.plist"
if [[ -f "$SOURCE" ]]; then
  cp "$SOURCE" "$DESTINATION"
else
  rm -f "$DESTINATION"
fi
