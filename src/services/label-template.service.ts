/**
 * 4×6 UnieCourier shipping label template.
 * Must match the Kiosk/UnieWMS label format exactly.
 * Format: UnieLogo - UnieCourier | Slogan | Tracking (barcode) | Carrier | Ship to/from | Boxes/Weight/Size | Track URL
 */

const DEFAULT_LOGO_URL =
  process.env.UNIE_LOGO_URL ||
  'https://prepcenternearme.s3.us-east-1.amazonaws.com/unielogics/nobguniewmslogo.png'
const TRACK_URL = 'www.track.UnieCourier.com'

export interface LabelData {
  trackingNumber: string
  shipTo: string
  shipFrom: string
  boxes: number
  weight: string
  size: string
  logoUrl?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Simple Code128-style barcode pattern for display */
function generateCode128Barcode(data: string): string {
  const patterns: Record<string, string> = {
    '0': '11011001100', '1': '11001101100', '2': '11001100110', '3': '10010011000',
    '4': '10010001100', '5': '10001001100', '6': '10011001000', '7': '10011000100',
    '8': '10001100100', '9': '11001001000', 'A': '11001000100', 'B': '11000100100',
    'C': '10110011100', 'D': '10011011100', 'E': '10011001110', 'F': '10111001100',
    'G': '10011101100', 'H': '10011100110', 'I': '11001110010', 'J': '11001011100',
    'K': '11001001110', 'L': '11011100100', 'M': '11001110100', 'N': '11101101110',
    'O': '11101001100', 'P': '11100101100', 'Q': '11100100110', 'R': '11101100100',
    'S': '11100110100', 'T': '11100110010', 'U': '11011011000', 'V': '11011000110',
    'W': '11000110110', 'X': '10100011000', 'Y': '10001011000', 'Z': '10001000110',
    ' ': '10110111000', '-': '10001110110', '.': '10100001110', '_': '10001000010',
  }
  let barcode = '11010010000'
  let checksum = 104
  for (let i = 0; i < data.length; i++) {
    const char = data[i]
    const pattern = patterns[char] ?? patterns[' ']
    barcode += pattern
    const value = char.charCodeAt(0) - 32
    checksum += Math.max(0, value) * (i + 1)
  }
  const checkDigit = checksum % 103
  const checkPattern =
    Object.values(patterns)[Math.min(checkDigit, Object.keys(patterns).length - 1)] ?? patterns['0']
  barcode += checkPattern + '1100011101011'
  return barcode
}

function barcodeToSvg(data: string, barWidth = 2, barHeight = 44): string {
  const pattern = generateCode128Barcode(data)
  let xPos = 0
  let svg = `<svg width="100%" height="${barHeight}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pattern.length * barWidth} ${barHeight}">`
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '1') {
      svg += `<rect x="${xPos}" y="0" width="${barWidth}" height="${barHeight}" fill="black"/>`
    }
    xPos += barWidth
  }
  svg += '</svg>'
  return svg
}

/**
 * Generate 4×6 UnieCourier label HTML (identical to Kiosk).
 */
export function generateUnieCourierLabelHtml(data: LabelData): string {
  const logoUrl = data.logoUrl ?? DEFAULT_LOGO_URL
  const barcodeSvg = barcodeToSvg(data.trackingNumber)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UnieCourier Label - ${escapeHtml(data.trackingNumber)}</title>
  <style>
    @page { size: 4in 6in; margin: 0; }
    @media print {
      body { margin: 0; padding: 0; }
      .no-print { display: none; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 10px 12px;
      width: 4in;
      min-height: 6in;
      font-size: 11px;
      color: #111;
    }
    .label-logo-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      padding-bottom: 6px;
      border-bottom: 2px solid #000;
    }
    .label-logo {
      height: 36px;
      width: auto;
      object-fit: contain;
    }
    .label-brand {
      font-size: 18px;
      font-weight: bold;
      letter-spacing: 0.5px;
    }
    .label-slogan {
      font-size: 10px;
      color: #444;
      margin-top: 2px;
    }
    .label-section {
      margin: 8px 0;
    }
    .label-section-title {
      font-size: 9px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .label-tracking-num {
      font-family: 'Courier New', monospace;
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 1px;
      margin: 6px 0 2px 0;
    }
    .barcode-wrap {
      text-align: center;
      margin: 4px 0;
    }
    .barcode-wrap svg {
      max-width: 100%;
      height: 40px;
    }
    .label-ship-block {
      font-size: 10px;
      line-height: 1.35;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .label-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 16px;
      margin: 6px 0;
      font-size: 10px;
    }
    .label-meta-row strong { margin-right: 2px; }
    .label-footer {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 2px solid #000;
      text-align: center;
    }
    .label-track-title {
      font-size: 10px;
      font-weight: bold;
      margin-bottom: 2px;
    }
    .label-track-url {
      font-size: 12px;
      font-weight: bold;
      letter-spacing: 0.5px;
    }
  </style>
</head>
<body>
  <div class="label-logo-row">
    <img src="${escapeHtml(logoUrl)}" alt="Unie" class="label-logo" />
    <div>
      <div class="label-brand">UnieCourier</div>
      <div class="label-slogan">Affordable Local Deliveries</div>
    </div>
  </div>

  <div class="label-section">
    <div class="label-section-title">Tracking Number</div>
    <div class="barcode-wrap">${barcodeSvg}</div>
    <div class="label-tracking-num">${escapeHtml(data.trackingNumber)}</div>
  </div>

  <div class="label-section">
    <div class="label-section-title">Carrier: UnieCourier</div>
  </div>

  <div class="label-section">
    <div class="label-section-title">Ship to:</div>
    <div class="label-ship-block">${escapeHtml(data.shipTo)}</div>
  </div>

  <div class="label-section">
    <div class="label-section-title">Ship from:</div>
    <div class="label-ship-block">${escapeHtml(data.shipFrom)}</div>
  </div>

  <div class="label-meta-row">
    <span><strong>Boxes:</strong> ${escapeHtml(String(data.boxes))}</span>
    <span><strong>Weight:</strong> ${escapeHtml(data.weight)}</span>
    <span><strong>Size:</strong> ${escapeHtml(data.size)}</span>
  </div>

  <div class="label-footer">
    <div class="label-track-title">Track your shipment</div>
    <div class="label-track-url">${TRACK_URL}</div>
  </div>
</body>
</html>`
}
