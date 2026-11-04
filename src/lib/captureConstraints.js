/**
 * captureConstraints.js — pure helpers for opening a video processor.
 *
 * Kept free of React and of the DOM so the fallback order can be unit tested
 * without a capture card attached.
 */

/**
 * The ordered list of getUserMedia video constraints to try.
 *
 * Real hardware does not negotiate. An endoscopy video processor answers in the
 * one mode its DIP switches or its HDMI input was set to — a PAL unit gives
 * 720×576, an NTSC unit 720×480 — and rejects anything else with
 * NotReadableError, which Windows surfaces as "Could not start video source".
 *
 * So the ladder starts with the requested size, then asks for the device with
 * no size at all (the driver's native mode, the most reliable request for an
 * old grabber), then walks the broadcast and VGA modes explicitly, and only
 * then falls back to "any camera".
 */
export function buildConstraintStages(deviceId, want) {
  const ideal = want && want.width ? { width: { ideal: want.width }, height: { ideal: want.height } } : {}
  const stages = []
  const push = (stage) => {
    const key = JSON.stringify(stage)
    if (!stages.some((s) => JSON.stringify(s) === key)) stages.push(stage)
  }

  if (deviceId) {
    const exact = { deviceId: { exact: deviceId } }

    // 1. The device the operator picked, at the size they asked for.
    push({ ...exact, ...ideal, frameRate: { ideal: 30 } })

    // 2. The same device with no size and no frame rate: let the driver hand
    //    over whatever it is already producing. This is what rescues cards that
    //    fail every explicit request.
    push({ ...exact })

    // 3. Explicit modes, cheapest first. PAL/NTSC matter for endoscopy units.
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [720, 576],
      [720, 480],
      [640, 480],
      [320, 240],
    ]) {
      push({ ...exact, width: { exact: w }, height: { exact: h } })
    }

    // 4. Soft hint: may resolve to another card, but better than no picture.
    push({ deviceId })
  }

  // 5. Any video input at all (the laptop's own camera, another grabber).
  push(ideal.width ? { ...ideal } : {})

  return stages
}

/** Errors that mean "the device is there but would not open" rather than "no device". */
export function isDeviceBusy(err) {
  const name = err?.name || ''
  return name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError'
}

/** Turns a getUserMedia rejection into something a clinic can act on. */
export function describeMediaError(err) {
  const name = err?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Windows denied access to the capture device. Open Settings → Privacy & security → Camera, allow desktop apps, then press “Try again”.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return 'The capture device is no longer connected. Reconnect the video processor and press “Rescan”.'
  if (isDeviceBusy(err))
    return 'The card is connected but Windows could not start the video source. Close every other program that can use the camera (OBS, the endoscopy unit software, Teams, Zoom, the Camera app), then press “Try again”. If it still refuses, use “Restart with DirectShow” below — older capture cards only start on that driver.'
  if (name === 'OverconstrainedError')
    return 'The capture card does not support the selected resolution. Choose “PAL 720×576”, then press “Try again”.'
  return err?.message || 'The capture device could not be opened.'
}
