/** Picture of the plan currently drawn on the canvas, for Cursor to check. */

export function capturePlanSvg(): Promise<string> {
  const svg = document.querySelector<SVGSVGElement>('[data-testid="plan-svg"]')
  if (!svg) {
    return Promise.reject(new Error("The plan is not on screen."))
  }
  const width = Number(svg.getAttribute("width")) || svg.clientWidth
  const height = Number(svg.getAttribute("height")) || svg.clientHeight
  if (width < 2 || height < 2) {
    return Promise.reject(new Error("The plan is not on screen."))
  }
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect")
  background.setAttribute("width", String(width))
  background.setAttribute("height", String(height))
  background.setAttribute("fill", "#ffffff")
  clone.insertBefore(background, clone.firstChild)
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }))
  return loadImage(url)
    .then((image) => {
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      if (!context) {
        throw new Error("The plan picture could not be taken.")
      }
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, width, height)
      context.drawImage(image, 0, 0, width, height)
      return canvas.toDataURL("image/png")
    })
    .finally(() => URL.revokeObjectURL(url))
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("The plan picture could not be taken."))
    image.src = url
  })
}

export function waitForPlanPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}
