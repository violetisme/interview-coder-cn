import { BrowserWindow, ipcMain, screen } from 'electron'

type DragState = {
  window: BrowserWindow
  /** Cursor-to-window-origin offset captured at drag start, so the grab point stays under the pointer */
  offsetX: number
  offsetY: number
  lastX: number
  lastY: number
}

/** Cursor sampling interval while dragging, roughly one frame */
const POLL_INTERVAL = 16
/** Only the renderer can end a drag, so never follow the cursor indefinitely */
const MAX_DRAG_DURATION = 30_000

let dragState: DragState | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let safetyTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Custom window dragging, replacing `-webkit-app-region: drag`.
 *
 * A native drag region on a transparent, frameless Windows window does two
 * things the user does not want: the OS drag loop paints only a "ghost" outline
 * at the target position instead of moving the real window, and the caption
 * hit-testing swallows the pointer, so hover cursors (button arrow, text caret)
 * never update over the header. Driving the move from here, sampling the cursor
 * in main exactly like window-resize.ts, moves the actual window and leaves the
 * header as ordinary client area for Chromium's cursor handling.
 */
ipcMain.on('window-drag-start', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) return

  const { x, y } = screen.getCursorScreenPoint()
  const [windowX, windowY] = window.getPosition()
  dragState = {
    window,
    offsetX: x - windowX,
    offsetY: y - windowY,
    lastX: x,
    lastY: y
  }

  stopTimers()
  pollTimer = setInterval(trackCursor, POLL_INTERVAL)
  safetyTimer = setTimeout(stopDrag, MAX_DRAG_DURATION)
})

ipcMain.on('window-drag-stop', (event) => {
  if (dragState?.window.webContents === event.sender) stopDrag()
})

function trackCursor(): void {
  if (!dragState || dragState.window.isDestroyed()) {
    stopDrag()
    return
  }

  const { x, y } = screen.getCursorScreenPoint()
  if (x === dragState.lastX && y === dragState.lastY) return
  dragState.lastX = x
  dragState.lastY = y

  // setPosition fires the window's 'move' event, which the toolbar listens to
  // for its own follow, so no extra sync is needed here.
  dragState.window.setPosition(x - dragState.offsetX, y - dragState.offsetY)
}

function stopDrag(): void {
  stopTimers()
  dragState = null
}

function stopTimers(): void {
  if (pollTimer) clearInterval(pollTimer)
  if (safetyTimer) clearTimeout(safetyTimer)
  pollTimer = null
  safetyTimer = null
}
