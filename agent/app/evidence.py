"""Show the source: render a stored bill as an image and cut out the printed value.

The extractor reports where each quantity sits on its page as a box on a
0..1000 scale. This module turns a stored upload (a photo or a PDF) into a
page image the browser can lay that box over, and crops the box out for the
methodology note, so the evidence is visible without the app.
"""

from __future__ import annotations

import io

from PIL import Image, ImageDraw

MAX_PAGE_PX = 1800  # longest side of a rendered page


def page_count(data: bytes, mime_type: str) -> int:
    if mime_type != "application/pdf":
        return 1
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    try:
        return len(pdf)
    finally:
        pdf.close()


def render_page(data: bytes, mime_type: str, page: int = 1) -> Image.Image:
    """The 1-based page as an RGB image. Photos have one page."""
    if mime_type == "application/pdf":
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(data)
        try:
            idx = min(max(page, 1), len(pdf)) - 1
            pg = pdf[idx]
            w, h = pg.get_size()
            scale = min(2.5, MAX_PAGE_PX / max(w, h))
            img = pg.render(scale=scale).to_pil().convert("RGB")
        finally:
            pdf.close()
        return img
    img = Image.open(io.BytesIO(data))
    img.load()
    img = img.convert("RGB")
    if max(img.size) > MAX_PAGE_PX:
        img.thumbnail((MAX_PAGE_PX, MAX_PAGE_PX))
    return img


def page_png(data: bytes, mime_type: str, page: int = 1) -> bytes:
    out = io.BytesIO()
    render_page(data, mime_type, page).save(out, format="PNG", optimize=True)
    return out.getvalue()


def _px(box: list[int], size: tuple[int, int]) -> tuple[int, int, int, int]:
    """[ymin, xmin, ymax, xmax] on 0..1000 to (left, top, right, bottom) pixels."""
    w, h = size
    y0, x0, y1, x1 = box
    return round(x0 / 1000 * w), round(y0 / 1000 * h), round(x1 / 1000 * w), round(y1 / 1000 * h)


def crop_evidence(data: bytes, mime_type: str, page: int, box: list[int], *, width: int = 420) -> bytes:
    """A PNG of the area around the printed value with the value itself outlined.

    The crop is the box grown to a readable minimum, so a single number still
    arrives with the row label beside it.
    """
    img = render_page(data, mime_type, page)
    left, top, right, bottom = _px(box, img.size)
    draw = ImageDraw.Draw(img)
    pad = max(3, round(img.size[0] * 0.003))
    draw.rectangle((left - pad, top - pad, right + pad, bottom + pad), outline=(225, 29, 72), width=max(3, pad))

    # Labels sit to the left of a printed figure, so grow the crop that way.
    w, h = img.size
    l, r = max(0, round(left - 0.5 * w)), min(w, round(right + 0.06 * w))
    cy = (top + bottom) / 2
    ch = max(bottom - top + 2 * h * 0.03, (r - l) * 0.3)
    t, b = max(0, round(cy - ch / 2)), min(h, round(cy + ch / 2))
    crop = img.crop((l, t, r, b))
    if crop.size[0] > width:
        crop = crop.resize((width, max(1, round(crop.size[1] * width / crop.size[0]))), Image.LANCZOS)
    out = io.BytesIO()
    crop.save(out, format="PNG", optimize=True)
    return out.getvalue()
