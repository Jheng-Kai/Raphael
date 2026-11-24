use super::{Mode, OverlayEvent};
use std::time::{Duration, Instant};

const FRAME_WAIT: Duration = Duration::from_millis(1_500);
const NUDGE_WAIT: Duration = Duration::from_secs(1);
// The page loads textures before subscribing. Allow that startup work after navigation.
const PAGE_WAIT: Duration = Duration::from_secs(4);
const CAPTION_LIMIT: Duration = Duration::from_millis(crate::agent::SAY_MAX_MS);
/// A caption whose page still answers is given more time at its end, a long answer being read a page at a time: never
/// more than this in all, so a caption that never clears still goes.
const CAPTION_HARD_LIMIT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Action {
    Show,
    Hide,
    /// Ask the page whether it still paints the caption whose time is up (its time was extended meanwhile).
    Probe,
    Nudge,
    Reload,
    Recreate,
    Expire,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Frame,
    Nudged,
    Reloaded,
    Recreated,
}

struct Probe {
    id: u64,
    deadline: Instant,
    stage: Stage,
}

#[derive(Default)]
pub(super) struct Recovery {
    serial: u64,
    probe: Option<Probe>,
    scene: Vec<OverlayEvent>,
    expires: Option<Instant>,
    /// When the caption on screen came: it is not extended past `CAPTION_HARD_LIMIT` from then.
    caption_since: Option<Instant>,
    /// The probe a caption's extension replaced. The page may have cleared the caption and said so to that probe just
    /// before the new one came, and then it never answers the new one: its "hidden" still counts.
    extended_from: Option<u64>,
    native_hidden: bool,
    replay: bool,
    refresh: bool,
}

impl Recovery {
    pub(super) fn is_caption(&self) -> bool {
        matches!(
            self.scene.first(),
            Some(
                OverlayEvent::Say { .. }
                    | OverlayEvent::Notice { .. }
                    | OverlayEvent::Learned { .. }
            )
        )
    }

    #[cfg(windows)]
    pub(super) fn has_scene(&self) -> bool {
        !self.scene.is_empty()
    }

    pub(super) fn native_hidden(&self) -> bool {
        self.native_hidden
    }

    pub(super) fn replay(&mut self, now: Instant) -> Option<&[OverlayEvent]> {
        if !std::mem::take(&mut self.replay) {
            return None;
        }
        if self.expires.is_some_and(|end| now >= end) {
            self.scene.clear();
        }
        if let (Some(OverlayEvent::Ask(prompt)), Some(end)) = (self.scene.first_mut(), self.expires)
            && prompt.timeout_ms != 0
        {
            prompt.timeout_ms = end.saturating_duration_since(now).as_millis().max(1) as u64;
        }
        Some(&self.scene)
    }

    pub(super) fn track(
        &mut self,
        event: &OverlayEvent,
        now: Instant,
        subscribed: bool,
    ) -> Option<OverlayEvent> {
        let hidden = self.scene.is_empty();
        match event {
            OverlayEvent::Hide => self.scene.clear(),
            OverlayEvent::Show { .. }
            | OverlayEvent::Say { .. }
            | OverlayEvent::Notice { .. }
            | OverlayEvent::Ask(_)
            | OverlayEvent::Operate { .. }
            | OverlayEvent::Complete => {
                self.scene.clear();
                if matches!(event, OverlayEvent::Complete) && hidden {
                    return None;
                }
                if matches!(event, OverlayEvent::Complete) {
                    self.scene.push(OverlayEvent::Show {
                        mode: Mode::Listening,
                        line: None,
                    });
                }
                self.scene.push(event.clone());
            }
            OverlayEvent::Learned { .. } if hidden => self.scene.push(event.clone()),
            OverlayEvent::Mode { mode, .. } => {
                if hidden {
                    return None;
                }
                if let Some(OverlayEvent::Show { mode: shown, .. }) = self.scene.first_mut() {
                    *shown = *mode;
                }
                self.replace(event);
                return None;
            }
            OverlayEvent::Step { .. } | OverlayEvent::Progress(_) if !hidden => {
                self.replace(event);
                return None;
            }
            _ => return None,
        }

        self.caption_since = match event {
            OverlayEvent::Say { .. }
            | OverlayEvent::Notice { .. }
            | OverlayEvent::Learned { .. }
            | OverlayEvent::Complete => Some(now),
            _ => None,
        };
        self.expires = match event {
            OverlayEvent::Say { .. }
            | OverlayEvent::Notice { .. }
            | OverlayEvent::Learned { .. }
            | OverlayEvent::Complete => Some(now + CAPTION_LIMIT),
            OverlayEvent::Ask(prompt) if prompt.timeout_ms != 0 => {
                Some(now + Duration::from_millis(prompt.timeout_ms))
            }
            _ => None,
        };
        self.refresh = !self.scene.is_empty() && self.native_hidden;
        self.extended_from = None;
        self.serial += 1;
        let wait = if subscribed { FRAME_WAIT } else { PAGE_WAIT };
        // A replacement with the same visibility cannot postpone an existing recovery step.
        let (stage, deadline) = self
            .probe
            .as_ref()
            .filter(|_| hidden == self.scene.is_empty())
            .map_or((Stage::Frame, now + wait), |probe| {
                (probe.stage, probe.deadline)
            });
        self.probe = Some(Probe {
            id: self.serial,
            stage,
            deadline,
        });
        self.probe_event()
    }

    fn replace(&mut self, event: &OverlayEvent) {
        self.scene.retain(|entry| entry.kind() != event.kind());
        self.scene.push(event.clone());
    }

    pub(super) fn probe_event(&self) -> Option<OverlayEvent> {
        self.probe.as_ref().map(|probe| OverlayEvent::FrameProbe {
            id: probe.id,
            again: self.extended_from.is_some(),
            hidden: self.scene.is_empty(),
            watch_end: self.expires.is_some()
                && self
                    .scene
                    .first()
                    .is_some_and(|event| !matches!(event, OverlayEvent::Ask(_))),
        })
    }

    pub(super) fn frame(&mut self, id: u64, hidden: bool) -> bool {
        if self.serial != id && !(hidden && self.extended_from == Some(id)) {
            return false;
        }
        self.extended_from = None;
        if self.scene.is_empty() && !hidden {
            return false;
        }
        if hidden && self.expires.is_some() {
            self.scene.clear();
            self.expires = None;
        }
        self.probe
            .take()
            .is_some_and(|probe| probe.stage != Stage::Frame)
    }

    #[cfg(windows)]
    pub(super) fn due(&self, now: Instant) -> bool {
        self.refresh
            || self.expires.is_some_and(|end| now >= end)
            || self
                .probe
                .as_ref()
                .is_some_and(|probe| now >= probe.deadline)
    }

    pub(super) fn tick(&mut self, now: Instant) -> Option<Action> {
        // A caption read a page at a time can outlast its first time (a long answer took about 28 s): while its page still
        // answers it is given more, up to the hard limit; a page that does not answer goes down the recovery below. One the
        // recovery already hid natively is not asked again: it expires.
        if let Some(since) = self
            .caption_since
            .filter(|since| now < *since + CAPTION_HARD_LIMIT)
            && self.expires.is_some_and(|end| now >= end)
            && self.is_caption()
            && self.probe.is_none()
            && !self.native_hidden
        {
            self.expires = Some((now + CAPTION_LIMIT).min(since + CAPTION_HARD_LIMIT));
            self.extended_from = Some(self.serial);
            self.serial += 1;
            self.probe = Some(Probe {
                id: self.serial,
                deadline: now + FRAME_WAIT,
                stage: Stage::Frame,
            });
            return Some(Action::Probe);
        }
        if self.expires.is_some_and(|end| now >= end) {
            self.track(&OverlayEvent::Hide, now, true);
            self.native_hidden = true;
            self.probe = None;
            return Some(Action::Expire);
        }
        if std::mem::take(&mut self.refresh) {
            self.native_hidden = false;
            return Some(Action::Show);
        }
        let probe = self.probe.as_mut()?;
        if now < probe.deadline {
            return None;
        }
        if self.scene.is_empty() {
            self.probe = None;
            self.native_hidden = true;
            return Some(Action::Hide);
        }
        let (action, stage, delay) = match probe.stage {
            Stage::Frame => (Action::Nudge, Stage::Nudged, NUDGE_WAIT),
            Stage::Nudged => (Action::Reload, Stage::Reloaded, PAGE_WAIT),
            Stage::Reloaded => (Action::Recreate, Stage::Recreated, PAGE_WAIT),
            Stage::Recreated => {
                self.probe = None;
                self.native_hidden = true;
                return Some(Action::Hide);
            }
        };
        self.serial += 1;
        *probe = Probe {
            id: self.serial,
            deadline: now + delay,
            stage,
        };
        self.replay = matches!(action, Action::Reload | Action::Recreate);
        Some(action)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn show() -> OverlayEvent {
        OverlayEvent::Show {
            mode: Mode::Listening,
            line: None,
        }
    }

    #[test]
    fn missing_frames_escalate_and_an_old_ack_cannot_end_recovery() {
        let now = Instant::now();
        let mut state = Recovery::default();
        state.track(&show(), now, true);
        assert_eq!(state.tick(now + FRAME_WAIT), Some(Action::Nudge));
        assert!(!state.frame(1, false));
        let reload = now + FRAME_WAIT + NUDGE_WAIT;
        assert_eq!(state.tick(reload), Some(Action::Reload));
        assert!(matches!(
            state.replay(reload),
            Some([OverlayEvent::Show { .. }])
        ));
        assert_eq!(state.tick(reload + PAGE_WAIT), Some(Action::Recreate));
        assert!(state.frame(4, false));
        assert_eq!(state.tick(reload + PAGE_WAIT * 2), None);
    }

    #[test]
    fn a_missing_hidden_frame_hides_natively_and_the_next_show_restores_it() {
        let now = Instant::now();
        let mut state = Recovery::default();
        state.track(&show(), now, true);
        state.track(&OverlayEvent::Hide, now, true);
        assert!(!state.frame(1, true));
        assert_eq!(state.tick(now + FRAME_WAIT), Some(Action::Hide));
        assert!(state.native_hidden());
        state.track(&show(), now + FRAME_WAIT, true);
        assert_eq!(state.tick(now + FRAME_WAIT), Some(Action::Show));
        assert!(!state.native_hidden());
    }

    #[test]
    fn a_caption_that_paints_but_never_clears_still_expires_natively() {
        let now = Instant::now();
        let mut state = Recovery::default();
        state.track(
            &OverlayEvent::Say {
                prefix: "Answer".into(),
                text: "Hello".into(),
            },
            now,
            true,
        );
        state.frame(1, false);
        assert!(state.is_caption());
        // Each time its time is up the page is asked, answers, and the caption is given more, until the hard limit.
        let mut at = now + CAPTION_LIMIT;
        while at < now + CAPTION_HARD_LIMIT {
            assert_eq!(state.tick(at), Some(Action::Probe));
            let id = match state.probe_event() {
                Some(OverlayEvent::FrameProbe { id, .. }) => id,
                _ => panic!("no probe"),
            };
            state.frame(id, false);
            at += CAPTION_LIMIT;
        }
        assert_eq!(state.tick(at), Some(Action::Expire));
        assert!(state.native_hidden());
        assert!(!state.is_caption());
    }

    #[test]
    fn a_long_caption_whose_page_answers_is_not_cut_at_its_first_time() {
        let now = Instant::now();
        let mut state = Recovery::default();
        state.track(
            &OverlayEvent::Say {
                prefix: "Answer".into(),
                text: "a long answer read a page at a time".into(),
            },
            now,
            true,
        );
        state.frame(1, false);
        assert_eq!(state.tick(now + CAPTION_LIMIT), Some(Action::Probe));
        assert!(!state.native_hidden());
        assert!(state.is_caption());
        // The page goes on and clears it by itself, about 28 s in: nothing is hidden natively.
        let id = match state.probe_event() {
            Some(OverlayEvent::FrameProbe { id, .. }) => id,
            _ => panic!("no probe"),
        };
        state.frame(id, false);
        state.frame(id, true);
        assert!(!state.is_caption());
        assert_eq!(state.tick(now + Duration::from_secs(28)), None);
        assert!(!state.native_hidden());
    }

    #[test]
    fn a_caption_whose_page_stops_answering_goes_down_the_recovery() {
        let now = Instant::now();
        let mut state = Recovery::default();
        state.track(
            &OverlayEvent::Say {
                prefix: "Answer".into(),
                text: "Hello".into(),
            },
            now,
            true,
        );
        state.frame(1, false);
        assert_eq!(state.tick(now + CAPTION_LIMIT), Some(Action::Probe));
        assert_eq!(
            state.tick(now + CAPTION_LIMIT + FRAME_WAIT),
            Some(Action::Nudge)
        );
    }

    #[test]
    fn a_hidden_answer_to_the_probe_an_extension_replaced_still_clears_the_caption() {
        let now = Instant::now();
        let mut state = Recovery::default();
        state.track(
            &OverlayEvent::Say {
                prefix: "Answer".into(),
                text: "Hello".into(),
            },
            now,
            true,
        );
        state.frame(1, false);
        assert_eq!(state.tick(now + CAPTION_LIMIT), Some(Action::Probe));
        // The page cleared the caption and told the first probe just before the second one came; it never answers that.
        state.frame(1, true);
        assert!(!state.is_caption());
        assert_eq!(state.tick(now + CAPTION_LIMIT + FRAME_WAIT), None);
        assert!(!state.native_hidden());
    }

    #[test]
    fn an_old_hidden_answer_does_not_clear_a_newer_caption() {
        let now = Instant::now();
        let mut state = Recovery::default();
        let say = |text: &str| OverlayEvent::Say {
            prefix: "Answer".into(),
            text: text.into(),
        };
        state.track(&say("first"), now, true);
        state.frame(1, false);
        assert_eq!(state.tick(now + CAPTION_LIMIT), Some(Action::Probe));
        state.track(&say("second"), now + CAPTION_LIMIT, true);
        assert!(!state.frame(1, true));
        assert!(state.is_caption());
    }

    #[test]
    fn a_caption_the_recovery_hid_is_not_asked_again_and_expires() {
        let now = Instant::now();
        let mut state = Recovery::default();
        state.track(
            &OverlayEvent::Say {
                prefix: "Answer".into(),
                text: "Hello".into(),
            },
            now,
            true,
        );
        let mut at = now + FRAME_WAIT;
        assert_eq!(state.tick(at), Some(Action::Nudge));
        at += NUDGE_WAIT;
        assert_eq!(state.tick(at), Some(Action::Reload));
        at += PAGE_WAIT;
        assert_eq!(state.tick(at), Some(Action::Recreate));
        at += PAGE_WAIT;
        assert_eq!(state.tick(at), Some(Action::Hide));
        assert!(state.native_hidden());
        assert_eq!(state.tick(now + CAPTION_LIMIT), Some(Action::Expire));
        assert!(!state.is_caption());
    }

    #[test]
    fn an_extended_caption_ends_at_the_hard_limit() {
        let now = Instant::now();
        let mut state = Recovery::default();
        state.track(
            &OverlayEvent::Say {
                prefix: "Answer".into(),
                text: "Hello".into(),
            },
            now,
            true,
        );
        state.frame(1, false);
        // Each tick comes a little late, as real ones do, so the last extension would run past the limit if it were not cut.
        let late = Duration::from_millis(100);
        let mut at = now + CAPTION_LIMIT + late;
        while state.tick(at) == Some(Action::Probe) {
            let id = match state.probe_event() {
                Some(OverlayEvent::FrameProbe { id, again, .. }) => {
                    assert!(again);
                    id
                }
                _ => panic!("no probe"),
            };
            state.frame(id, false);
            assert!(
                state
                    .expires
                    .is_some_and(|end| end <= now + CAPTION_HARD_LIMIT)
            );
            at = state.expires.unwrap() + late;
        }
        // It ends at its first tick past the limit.
        assert!(at <= now + CAPTION_HARD_LIMIT + late);
        assert!(state.native_hidden());
    }

    #[test]
    fn a_caption_that_clears_on_its_own_needs_no_native_hide() {
        let now = Instant::now();
        let mut state = Recovery::default();
        state.track(
            &OverlayEvent::Notice {
                text: "Hello".into(),
            },
            now,
            true,
        );
        state.frame(1, false);
        state.frame(1, true);
        assert_eq!(state.tick(now + CAPTION_LIMIT), None);
    }
}
