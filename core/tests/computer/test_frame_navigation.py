"""The side buttons inside a computer's screen: the app's while the owner watches, the computer's while the owner holds it."""

from raphael_core.computer.viewer import BOOTSTRAP
from raphael_core.frame_navigation import FRAME_NAVIGATION


def test_the_computer_keeps_its_side_buttons_and_keys_while_the_owner_holds_the_controls():
    # Seen in review: a back press on the remote computer ended the owner's control instead of going back in its browser.
    script = BOOTSTRAP.decode()
    assert "window.raphaelOwnsInput = () => !!rfb && !rfb.viewOnly;" in script
    assert script.index("window.raphaelOwnsInput") < script.index(FRAME_NAVIGATION)
    # Both the buttons and the keys ask first, before they consume anything or tell the app.
    assert FRAME_NAVIGATION.count("owned()") == 2
    assert "event.button !== 3 && event.button !== 4 || owned()" in FRAME_NAVIGATION
    assert "if (owned()) return;" in FRAME_NAVIGATION
