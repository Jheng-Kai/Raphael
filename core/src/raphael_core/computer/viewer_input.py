"""Tell the iframe's navigation handler when Back should fold the computer."""

FRAME_PRESENTATION = b"""
let desktopExpanded = false;
window.raphaelFoldsInput = () => desktopExpanded;
addEventListener('message', event => {
  if (event.source === parent && event.data?.type === 'raphael-desktop-expanded') {
    desktopExpanded = event.data.expanded === true;
  }
});
"""
