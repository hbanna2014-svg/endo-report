/**
 * captureLock.js
 * ---------------------------------------------------------------------------
 * One capture device, one owner.
 *
 * When two procedure sessions are open side by side, both panes render the same
 * capture console. A capture card can only be opened once — asking for a second
 * `getUserMedia` stream on the same device fails, and on Windows it can leave the
 * first stream frozen. So whichever pane starts the camera claims the device and
 * every other pane is told to release it.
 */

let owner = null
const listeners = new Set()

function emit() {
  for (const fn of listeners) {
    try {
      fn(owner)
    } catch {
      /* a broken listener must not stop the others */
    }
  }
}

export function claimCapture(key) {
  if (owner === key) return
  owner = key
  emit()
}

export function releaseCapture(key) {
  if (owner !== key) return
  owner = null
  emit()
}

/** Returns an unsubscribe function, so it can be returned straight from useEffect. */
export function onCaptureOwner(handler) {
  listeners.add(handler)
  return () => listeners.delete(handler)
}

export function currentCaptureOwner() {
  return owner
}
