# Project guidance for Codex

Read README.md and docs/CODEX_HANDOFF.md before editing. Communicate with the user
in Russian. The primary app is Dwarf Gym in dist/. The rowing prototype under
reference/strumok is a separate historical reference, not the main entry point.

- This is a buildless HTML/CSS/JavaScript project. dist/ is hand-written source.
- Run npm test and npm run check after changes to application logic.
- The current optical-flow detector is known to be unreliable for real swings.
  Never present passing synthetic tests as validation on real iPhone video.
- MediaPipe was researched, not implemented. Keep implemented and proposed work distinct.
- Preserve front-facing camera, mirrored preview, pre-game calibration, red retry
  state, green success state, and excluding calibration repetitions from game counts.
- Video stays on device. Do not add recording, upload, telemetry, or paid services
  without a user request. Keep microphone disabled.
- Preserve camera lifecycle cleanup, cancellation handling, and background pause.
- Keep the scene and game responsive while improving detection. Do not silently
  fall back to unreliable optical flow when a new pose model fails to load.
- Follow the new repository's deployment instructions. This export contains no
  credentials or active Sites configuration and does not authorize changing access
  to the old hosted sites.
