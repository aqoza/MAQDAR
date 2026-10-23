from zeespare_engine import __version__, main


def test_version_is_set() -> None:
    assert __version__


def test_main_prints_version(capsys) -> None:
    main()
    assert f"zeespare-engine {__version__}" in capsys.readouterr().out
