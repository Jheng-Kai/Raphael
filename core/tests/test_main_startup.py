"""The speech libraries load beside the application and are joined before stdin is read."""

import threading

from raphael_core import __main__ as entry


class _FakeApp:
    def wait_for_libraries(self, timeout):
        events.append("wait_for_libraries")

    startup_running = False

    async def aclose(self):
        pass

    async def wait_for_shutdown(self):
        pass


events: list[str] = []


def test_speech_libraries_overlap_the_application_import_and_finish_before_stdin(monkeypatch):
    events.clear()
    in_import = threading.Event()
    app_started = threading.Event()

    def libraries():
        events.append("libraries_start")
        in_import.set()
        # The application import only returns once it has seen the library import under way.
        assert app_started.wait(5), "the application import never started beside the libraries"
        events.append("libraries_done")

    def application():
        events.append("application_start")
        app_started.set()
        assert in_import.wait(5), "the libraries were not importing while the application imported"
        events.append("application_done")
        return type("Module", (), {"build_app": staticmethod(lambda **kw: events.append("build_app") or _FakeApp())})

    monkeypatch.setattr(entry, "import_speech_libraries", libraries)
    monkeypatch.setattr(entry, "load_application", application)
    monkeypatch.setattr(entry, "claim_stdout", lambda: events.append("claim_stdout") or object())
    monkeypatch.setattr(entry, "run_stdio", lambda *a, **kw: events.append("run_stdio"))
    monkeypatch.setattr(entry.sys, "argv", ["raphael_core"])
    monkeypatch.delenv("RAPHAEL_DATA_DIR", raising=False)

    entry.main()

    assert events.index("claim_stdout") < events.index("libraries_start")  # nothing native before the claim
    assert events.index("libraries_start") < events.index("application_done")
    assert events.index("application_start") < events.index("libraries_done")  # they ran at the same time
    assert events.index("libraries_done") < events.index("run_stdio")  # numpy is in before stdin is read
    assert events.index("libraries_done") < events.index("wait_for_libraries") < events.index("run_stdio")
