"""Compare screenshots using Pillow/NumPy; no implementation rescaling or masks.

SSIM: luminance, Gaussian 11x11/sigma 1.5, population covariance, valid interior,
L=255, K1=.01, K2=.03. Run: python compare.py
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent


def blur(array):
    kernel = np.exp(-(np.arange(-5, 6) ** 2) / (2 * 1.5**2))
    kernel /= kernel.sum()
    horizontal = sum(kernel[i] * array[:, i : array.shape[1] - 10 + i] for i in range(11))
    return sum(kernel[i] * horizontal[i : horizontal.shape[0] - 10 + i] for i in range(11))


def metrics(reference, actual):
    a, b = (np.asarray(value, dtype=np.float64) for value in (reference, actual))
    x, y = (value @ np.array([0.299, 0.587, 0.114]) for value in (a, b))
    ux, uy = blur(x), blur(y)
    vx, vy, cov = blur(x * x) - ux * ux, blur(y * y) - uy * uy, blur(x * y) - ux * uy
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ssim = ((2 * ux * uy + c1) * (2 * cov + c2)) / (
        (ux * ux + uy * uy + c1) * (vx + vy + c2)
    )
    return {"ssim": round(float(ssim.mean()), 6), "rgb_mae_0_255": round(float(np.abs(a - b).mean()), 4)}


reference = Image.open(ROOT / "reference.png").convert("RGB")
results = {}
for source in sorted(ROOT.glob("dashboard-*-1672.png")):
    if not source.stem.startswith(("dashboard-before-", "dashboard-iteration-", "dashboard-final-")):
        continue
    actual = Image.open(source).convert("RGB")
    # Early full-page captures are cropped to the viewport, never scaled.
    actual = actual.crop((0, 0, *reference.size))
    results[source.name] = metrics(reference, actual)

for width, height in ((1672, 941), (1648, 928)):
    source = ROOT / f"dashboard-final-{width}.png"
    if not source.exists():
        continue
    target = reference if width == 1672 else reference.resize((width, height), Image.Resampling.LANCZOS)
    actual = Image.open(source).convert("RGB")
    assert actual.size == target.size
    results[source.name] = metrics(target, actual)
    Image.blend(target, actual, 0.5).save(ROOT / f"overlay-{width}.png")
    difference = np.abs(np.asarray(target, dtype=np.int16) - np.asarray(actual, dtype=np.int16))
    Image.fromarray(np.minimum(difference * 4, 255).astype(np.uint8)).save(ROOT / f"difference-{width}.png")
    side = Image.new("RGB", (width * 2, height), "white")
    side.paste(target, (0, 0))
    side.paste(actual, (width, 0))
    side.save(ROOT / f"comparison-{width}.png")
(ROOT / "measurements.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps(results, indent=2))
