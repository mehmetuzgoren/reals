# Fictional offline fixtures

The two four-second MP4s are original procedurally illustrated portraits with AAC synthetic tones, not footage of real people, live captures, spoken testimony, or transcriptions. Both are labeled inside the video and in the UI. No biography or political claim is asserted. Captions are unavailable rather than invented.

`scripts/generate-fixtures.py` reproduces these assets with Pillow, ffmpeg and DejaVu Sans Bold. The app uses bundled bytes and never contacts a media host in Demo Mode. Actual front-camera recording remains available in Demo Mode on supported hardware. Simulator fixture publication is explicit and cannot pass the live service's capture provenance checks.
