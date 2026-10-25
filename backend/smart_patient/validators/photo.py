"""Decode untrusted uploads and keep only normalized avatar pixels."""
from io import BytesIO
from pathlib import PurePath
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_PHOTO_BYTES = 2 * 1024 * 1024
MAX_PHOTO_PIXELS = 16_000_000
PHOTO_FORMATS = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}


def validate_photo(upload):
    extension = PurePath(upload.filename or "").suffix.lower()
    if extension not in PHOTO_FORMATS:
        raise ValueError("Choose a JPG, JPEG, PNG, or WebP image.")
    content = upload.stream.read(MAX_PHOTO_BYTES + 1)
    if not content:
        raise ValueError("Choose a non-empty image file.")
    if len(content) > MAX_PHOTO_BYTES:
        raise ValueError("Profile photos must be 2 MB or smaller.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content), formats=["JPEG", "PNG", "WEBP"]) as image:
                if image.format != PHOTO_FORMATS[extension]:
                    raise ValueError("The image content must match its JPG, PNG, or WebP file extension.")
                if image.width * image.height > MAX_PHOTO_PIXELS or max(image.size) > 8192:
                    raise ValueError("Choose an image with at most 16 million pixels and sides no larger than 8192 pixels.")
                if getattr(image, "is_animated", False):
                    raise ValueError("Choose a still image rather than an animated photo.")
                image.verify()
            with Image.open(BytesIO(content), formats=["JPEG", "PNG", "WEBP"]) as image:
                image.load()
                oriented = ImageOps.exif_transpose(image)
                oriented.thumbnail((512, 512), Image.Resampling.LANCZOS)
                # A new image keeps only pixels, discarding EXIF, GPS, comments, and profiles.
                pixels = Image.new("RGBA", oriented.size)
                pixels.paste(oriented.convert("RGBA"))
                output = BytesIO()
                pixels.save(output, format="WEBP", quality=85, method=4)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError,
            Image.DecompressionBombWarning):
        raise ValueError("This image is invalid or damaged. Choose a valid JPG, PNG, or WebP photo.") from None
