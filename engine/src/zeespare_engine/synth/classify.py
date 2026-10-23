"""Syntetos-Boylan-Croston demand classification.

Convention (documented so Phase 2 matches the tests):

* The series is evaluated on OPEN days only (weekends and all-sector closures removed first),
  otherwise a branch that sells every open day shows a calendar ADI of 1.4 and is misclassified.
* ADI is the mean interval between consecutive non-zero days, counting the first demand's offset
  from the start of the series (the tsintermittent ``idclass`` convention).
* CV² uses the sample standard deviation (ddof = 1) of the non-zero sizes.
* Boundaries follow ``idclass``: ADI > 1.32 or CV² > 0.49 moves a series off the smooth class.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

ADI_CUTOFF = 1.32
CV2_CUTOFF = 0.49


@dataclass(frozen=True)
class Classification:
    adi: float
    cv2: float
    label: str
    non_zero_periods: int


def sbc_class(adi: float, cv2: float) -> str:
    if adi > ADI_CUTOFF:
        return "lumpy" if cv2 > CV2_CUTOFF else "intermittent"
    return "erratic" if cv2 > CV2_CUTOFF else "smooth"


def classify(series: np.ndarray, open_mask: np.ndarray | None = None) -> Classification:
    """Classifies one daily series. ``open_mask`` selects the periods that count."""
    values = np.asarray(series, dtype=np.float64)
    if open_mask is not None:
        values = values[np.asarray(open_mask, dtype=bool)]
    non_zero = np.flatnonzero(values > 0)
    if non_zero.size == 0:
        return Classification(adi=float("inf"), cv2=0.0, label="dead", non_zero_periods=0)
    intervals = np.diff(np.concatenate(([-1], non_zero)))
    adi = float(intervals.mean())
    sizes = values[non_zero]
    if sizes.size < 2:
        cv2 = 0.0
    else:
        cv2 = float((sizes.std(ddof=1) / sizes.mean()) ** 2)
    return Classification(adi=adi, cv2=cv2, label=sbc_class(adi, cv2), non_zero_periods=int(non_zero.size))
