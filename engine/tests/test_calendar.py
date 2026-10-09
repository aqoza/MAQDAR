from datetime import date

import numpy as np
import pytest

from maqdar_engine.synth.calendar import Calendar, holidays, ramadan_windows
from maqdar_engine.synth.network import countries, locations, product_groups
from maqdar_engine.synth.presets import N_DAYS, WINDOW_END, WINDOW_START


@pytest.fixture(scope="module")
def cal() -> Calendar:
    return Calendar(WINDOW_START, N_DAYS)


def test_window_is_36_months():
    assert N_DAYS == 1096
    assert (WINDOW_END - WINDOW_START).days + 1 == N_DAYS


def test_weekend_conventions():
    assert countries()["SA"].weekend_days == (5, 6)
    assert countries()["AE"].weekend_days == (6, 7)
    for code in ("QA", "KW", "OM", "BH"):
        assert countries()[code].weekend_days == (5, 6)


def test_weekend_masks(cal: Calendar):
    friday = date(2024, 7, 5)
    sunday = date(2024, 7, 7)
    assert cal.country("SA").weekend[cal.index(friday)]
    assert not cal.country("SA").weekend[cal.index(sunday)]
    assert cal.country("AE").weekend[cal.index(sunday)]
    assert not cal.country("AE").weekend[cal.index(friday)]


@pytest.mark.parametrize(
    ("country", "closed_day", "open_day"),
    [
        ("OM", date(2026, 1, 15), date(2026, 1, 11)),  # Accession Day moved to Thursday 15 January 2026
        ("KW", date(2025, 1, 30), date(2025, 1, 27)),  # Isra and Miraj observed on 30 January 2025
        ("AE", date(2025, 12, 2), date(2025, 12, 3)),  # Eid Al Etihad 1-2 December 2025
        ("SA", date(2024, 4, 8), date(2024, 4, 14)),  # Eid al-Fitr 2024: 8-11 April, work resumed Sunday 14 April
        ("OM", date(2025, 6, 9), date(2025, 6, 10)),  # Oman Eid al-Adha 2025 ran through Monday 9 June
    ],
)
def test_verified_holiday_anchors(cal: Calendar, country: str, closed_day: date, open_day: date):
    c = cal.country(country)
    assert not c.open[cal.index(closed_day)], f"{country} {closed_day} should be closed"
    assert c.open[cal.index(open_day)], f"{country} {open_day} should be open"


def test_kuwait_extended_eid_2026_is_government_only(cal: Calendar):
    kw = cal.country("KW")
    extra_day = cal.index(date(2026, 3, 23))
    assert kw.open[extra_day] and kw.government_quiet[extra_day]
    assert not kw.open[cal.index(date(2026, 3, 22))]


def test_government_only_closures_stay_open(cal: Calendar):
    kw = cal.country("KW")
    gcc_summit = cal.index(date(2024, 12, 1))
    assert kw.open[gcc_summit]
    assert kw.government_quiet[gcc_summit]
    qa = cal.country("QA")
    mourning = cal.index(date(2026, 7, 14))
    assert qa.open[mourning] and qa.government_quiet[mourning]


def test_oman_lags_its_neighbours(cal: Calendar):
    # Ramadan 1445 started a day later in Oman; Eid al-Fitr 1446 fell a day later.
    assert cal.country("SA").ramadan[cal.index(date(2024, 3, 11))]
    assert not cal.country("OM").ramadan[cal.index(date(2024, 3, 11))]
    assert cal.country("OM").ramadan[cal.index(date(2024, 3, 12))]
    assert cal.country("OM").ramadan[cal.index(date(2025, 3, 30))]
    assert not cal.country("SA").ramadan[cal.index(date(2025, 3, 30))]
    windows = {(w.country_code, w.hijri_year): w for w in ramadan_windows()}
    assert windows[("OM", 1446)].eid_al_fitr == date(2025, 3, 31)
    assert windows[("SA", 1446)].eid_al_fitr == date(2025, 3, 30)


def test_every_holiday_has_a_source_and_lies_in_coverage():
    for h in holidays():
        assert h.source, h
        country = countries()[h.country_code]
        assert country.holiday_coverage_from and country.holiday_coverage_to
        assert date.fromisoformat(country.holiday_coverage_from) <= h.holiday_date <= date.fromisoformat(country.holiday_coverage_to), h


def test_coverage_check_refuses_unverified_countries(cal: Calendar):
    with pytest.raises(ValueError):
        cal.check_coverage({"BH"})
    cal.check_coverage({"SA", "AE", "QA", "KW", "OM"})


def test_summer_heat_peaks_in_july_for_batteries(cal: Calendar):
    riyadh_branch = next(loc for loc in locations() if loc.code == "SA-RUH-N")
    battery = next(g for g in product_groups() if g.code == "battery")
    brake = next(g for g in product_groups() if g.code == "brake_disc")
    m_battery = cal.multipliers(riyadh_branch, battery)
    m_brake = cal.multipliers(riyadh_branch, brake)
    sa = cal.country("SA")
    july = np.array([d.month in (7, 8) for d in cal.dates]) & sa.open
    winter = np.array([d.month in (12, 1, 2) for d in cal.dates]) & sa.open
    assert m_battery[july].mean() / m_battery[winter].mean() > 1.6
    assert 0.8 < m_brake[july].mean() / m_brake[winter].mean() < 1.2
    assert (m_battery[~sa.open] == 0).all()


def test_oman_heat_peaks_earlier(cal: Calendar):
    om = cal.country("OM")
    june = np.array([d.month == 6 for d in cal.dates])
    august = np.array([d.month == 8 for d in cal.dates])
    assert om.heat[june].mean() > om.heat[august].mean()
