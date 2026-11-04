import { esc } from './ui';

/** Rasterize the glyph mask once; the moving light is an ordinary composited HTML gradient. */
export function mountShimmers(root: HTMLElement): void {
  for (const span of root.querySelectorAll<HTMLElement>('.shimmer')) {
    const style=getComputedStyle(span), box=span.getBoundingClientRect(), words=span.textContent ?? '';
    if(!box.width || !box.height)continue;
    const key=`${style.font}|${style.letterSpacing}|${box.width}|${box.height}|${words}`;
    if(span.dataset.shimmerMask===key)continue;
    const canvas=document.createElement('canvas'), context=canvas.getContext('2d');
    if(!context)continue;
    context.font=style.font;
    const metrics=context.measureText(words), size=parseFloat(style.fontSize);
    const ascent=metrics.fontBoundingBoxAscent ?? size*.8, descent=metrics.fontBoundingBoxDescent ?? size*.2;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"><text x="0" y="${(box.height-ascent-descent)/2+ascent}" font-family="${esc(style.fontFamily)}" font-size="${size}" font-weight="${style.fontWeight}" textLength="${box.width}" lengthAdjust="spacingAndGlyphs" fill="white">${esc(words)}</text></svg>`;
    let mask=span.querySelector<HTMLElement>(':scope > .shimmer-mask');
    if(!mask){mask=document.createElement('span');mask.className='shimmer-mask';mask.ariaHidden='true';span.append(mask);}
    mask.style.maskImage=`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    span.dataset.shimmerMask=key;
  }
}
