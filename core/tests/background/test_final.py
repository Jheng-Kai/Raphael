"""Terminal envelopes cannot be replaced by narration; an address that would not be served is written as plain text."""
import pytest
from raphael_core.background.final import validate_terminal

@pytest.mark.parametrize('text',[None,'','   ','@'])
def test_an_empty_terminal_is_missing(text):
    assert validate_terminal(text,names=['Bob']).reason=='missing_terminal'

@pytest.mark.parametrize('text,cleaned',[('Done @','Done'),('Done @ Bob','Done @Bob'),('請 @ Bob 先說','請 @Bob 先說'),
    ('Done @Unknown','Done Unknown'),('@Unknown 你好','Unknown 你好')])
def test_an_unserved_address_becomes_plain_text_and_the_reply_is_kept(text,cleaned):
    terminal=validate_terminal(text,names=['Bob'])
    assert (terminal.text,terminal.reason)==(cleaned,None)

@pytest.mark.parametrize('text',['Delivered @Bob','Contact a@example.com','Quote: `@`','正在 is a quoted fact, not a message type.','「@Unknown」'])
def test_valid_final_and_quoted_content_are_preserved(text):
    assert validate_terminal(text,names=['Bob']).text==text
    assert validate_terminal(text,names=['Bob']).reason is None

def test_chief_terminal_cannot_create_an_unserved_reply_intent():
    terminal=validate_terminal('Delivered @Bob, ask @ Bob',names=['Bob'],wrapup=True)
    assert (terminal.text,terminal.reason)==('Delivered Bob, ask Bob',None)

SHAPES=['Done @','Done @ Bob','@','@ @','@@Bob','x@','@'+chr(10),'Done @'+chr(10)+'next','請 @ 先','@Bob @','a @ b @ c @','「@」','Done @ Unknown']

@pytest.mark.parametrize('wrapup',[False,True])
@pytest.mark.parametrize('names',[None,[],['Bob']])
@pytest.mark.parametrize('text',SHAPES)
def test_no_shape_of_a_stray_address_ends_in_a_reason_but_an_empty_reply(text,names,wrapup):
    """The reason a dangling address once gave is gone: the only reason a final text can carry is that it is empty."""
    terminal=validate_terminal(text,names=names,wrapup=wrapup)
    assert terminal.reason in (None,'missing_terminal')
    assert (terminal.reason is None)==bool(terminal.text.strip())
