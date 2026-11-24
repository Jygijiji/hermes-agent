/** Fit the browser app to the visible area when a keyboard leaves layout height
 * unchanged. `interactive-widget=resizes-content` handles supporting browsers;
 * VisualViewport covers the others. Pan/zoom stays with the browser: a pinch
 * must not turn its smaller visible area into a smaller application layout.
 *
 * The visible area is also PUBLISHED, unconditionally, as a CSS metric on
 * `<html>` (`--browser-visible-height` / `--browser-visible-top` under
 * `data-browser-visible`). Only `#root` can be resized here, and portalled
 * UI — every Radix dialog — is a sibling of `#root` on `<body>`, so it cannot
 * inherit the fit. Publishing on the root element lets those overlays size
 * themselves against the area a keyboard actually leaves free.
 */
const VISIBLE_HEIGHT_VAR = '--browser-visible-height'
const VISIBLE_TOP_VAR = '--browser-visible-top'
const VISIBLE_ATTR = 'data-browser-visible'

export function installBrowserViewport(): () => void {
  const viewport = window.visualViewport
  const root = document.getElementById('root')

  if (!viewport || document.documentElement.dataset.hermesDesktopHost !== 'browser') {
    return () => {}
  }

  let frame = 0
  let unzoomedTop = 0

  const publishVisibleArea = (height: number, top: number) => {
    const html = document.documentElement
    html.style.setProperty(VISIBLE_HEIGHT_VAR, `${height}px`)
    html.style.setProperty(VISIBLE_TOP_VAR, `${top}px`)
    html.setAttribute(VISIBLE_ATTR, '')
  }

  const clearVisibleArea = () => {
    const html = document.documentElement
    html.style.removeProperty(VISIBLE_HEIGHT_VAR)
    html.style.removeProperty(VISIBLE_TOP_VAR)
    html.removeAttribute(VISIBLE_ATTR)
  }

  const reset = () => {
    root?.removeAttribute('data-browser-viewport')
    root?.style.removeProperty('--browser-viewport-height')
    root?.style.removeProperty('--browser-viewport-top')
  }

  const update = () => {
    frame = 0

    // Remove pinch magnification from the height, so opening/closing the
    // keyboard still updates available space while zoomed. No focus(),
    // scrollIntoView(), or browser zoom changes here.
    const height = viewport.height * viewport.scale

    if (!Number.isFinite(height) || height <= 0) {
      return
    }

    // Hermes' UI scale is CSS zoom on <html>, separate from pinch zoom.
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1
    // Offset during a pinch belongs to the user's pan, not the app shell.
    const visibleTop = Math.abs(viewport.scale - 1) < 0.01 ? Math.max(0, viewport.offsetTop) : 0
    publishVisibleArea(height / zoom, visibleTop / zoom)

    // Without a shell to fit there is nothing further to do: the metric above
    // is the whole contract for portalled overlays.
    if (!root) {
      return
    }

    // iOS Safari reports the visible area as innerHeight, zoomed or not, and
    // scrolls the focused field into view itself. Fitting the shell under that
    // scroll would shrink the app out of the visible area.
    if (Math.abs(viewport.height - window.innerHeight) < 1) {
      unzoomedTop = 0
      reset()

      return
    }

    // Offset during a pinch belongs to the user's pan, not the app shell.
    if (Math.abs(viewport.scale - 1) < 0.01) {
      unzoomedTop = Math.max(0, viewport.offsetTop)
    }

    const top = Math.min(unzoomedTop, Math.max(0, window.innerHeight - height))

    if (Math.abs(height - window.innerHeight) < 1 && top < 1) {
      unzoomedTop = 0
      reset()

      return
    }

    root.style.setProperty('--browser-viewport-height', `${height / zoom}px`)
    root.style.setProperty('--browser-viewport-top', `${top / zoom}px`)
    root.setAttribute('data-browser-viewport', '')
  }

  const schedule = () => {
    if (!frame) {
      frame = requestAnimationFrame(update)
    }
  }

  viewport.addEventListener('resize', schedule)
  viewport.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  update()

  return () => {
    cancelAnimationFrame(frame)
    viewport.removeEventListener('resize', schedule)
    viewport.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    reset()
    clearVisibleArea()
  }
}
