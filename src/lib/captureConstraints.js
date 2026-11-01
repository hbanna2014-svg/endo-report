/**
 * captureConstraints.js — pure helpers for opening a video processor.
 *
 * Kept free of React and of the DOM so the fallback order can be unit tested
 * without a capture card attached.
 */

/**
 * The ordered list of getUserMedia video constraints to try.
 *
 * Endoscopy video processors and USB capture cards expose a fixed set of modes
 * — a PAL unit answers 720×576 and refuses 4K with NotReadableError, which
 * surfaces to the user as "Could not start video source". Asking for the exact
 * device with no size at all makes the driver pick its native mode.
 */
export function buildConstraintStages(deviceId, want) {
  const size = want && want.width ? { width: { ideal: want.width }, height: { ideal: want.height } } : {}
  if (!deviceId) return [{ ...size }, true]
  return [
    { deviceId: { exact: deviceId }, ...size },
    { deviceId: { exact: deviceId } },
    { deviceId },
    { ...size },
  ]
}

/** Turns a getUserMedia rejection into something a clinic can act on. */
export function describeMediaError(err) {
  const name = err?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Windows denied access to the capture device. Allow camera access for EndoReport, then press “Try again”.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return 'The capture device is no longer connected. Reconnect the video processor and press “Rescan”.'
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return 'The card is connected but Windows could not start the video source. Another program (OBS, the endoscopy unit software, Teams, Zoom) is most likely holding it — close that program, then press “Try again”.'
  if (name === 'OverconstrainedError')
    return 'The capture card does not support the selected resolution. Choose “PAL 720×576”, then press “Try again”.'
  if (name === 'AbortError')
    return 'The capture device stopped responding. Unplug and reconnect it, then press “Try again”.'
  return err?.message || 'The capture device could not be opened.'
}
