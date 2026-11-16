//! The media of macOS as a [`Transport`].
//!
//! Two kinds of player are listed:
//!
//! - The system's now-playing app, through the MediaRemote framework (what the media keys and
//!   Control Center talk to), when macOS lets this app use it: it asks whether the app plays and
//!   sends it pause and play as two different commands. macOS 15.4 and later answer only
//!   Apple's own processes, and then this player is simply not listed.
//! - The players that take Apple Events and run now (Music, Spotify, TV, VLC), each asked for its
//!   state and told to pause or play by `osascript`. A player that does not run is never asked, so
//!   that nothing is started; macOS asks the person once per player whether Raphael may control
//!   it.
//!
//! Everything runs on the worker's thread; each request has a time limit, so that a player that
//! hangs holds nothing up for long.

use std::ffi::{CString, c_void};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use block2::RcBlock;
use objc2::rc::autoreleasepool;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{class, msg_send};
use objc2_foundation::NSString;

use super::{Failure, Listed, MediaPauser, Outcome, Playback, SETTLE, Transport, Worker};

/// How long one player may take to answer.
const PLAYER_TIMEOUT: Duration = Duration::from_millis(1500);

/// Pauses and resumes the media of this computer. See [`Worker`].
pub struct MacMedia(Worker);

impl MacMedia {
    /// Starts the thread that talks to the players. Nothing is asked of them until the first
    /// recording.
    pub fn start() -> Self {
        Self(Worker::start(|| Some(Players::new()), SETTLE))
    }
}

impl MediaPauser for MacMedia {
    fn pause(&self) {
        self.0.pause();
    }

    fn resume(&self) {
        self.0.resume();
    }
}

/// A scriptable player: its bundle identifier and the scripts that read and change its state.
struct Scripted {
    bundle: &'static str,
    /// Answers "playing", "paused" or anything else.
    state: &'static str,
    pause: &'static str,
    play: &'static str,
}

const SCRIPTED: [Scripted; 4] = [
    Scripted {
        bundle: "com.apple.Music",
        state: "player state as string",
        pause: "pause",
        play: "play",
    },
    Scripted {
        bundle: "com.spotify.client",
        state: "player state as string",
        pause: "pause",
        play: "play",
    },
    Scripted {
        bundle: "com.apple.TV",
        state: "player state as string",
        pause: "pause",
        play: "play",
    },
    Scripted {
        bundle: "org.videolan.vlc",
        state: "if playing then \"playing\" else \"paused\"",
        // VLC's `play` toggles: each is said only from the state it changes.
        pause: "if playing then play",
        play: "if not playing then play",
    },
];

/// A player in the list.
#[derive(Clone, Copy)]
pub enum Session {
    /// The system's now-playing app (MediaRemote).
    NowPlaying,
    /// One of [`SCRIPTED`].
    Scripted(usize),
}

pub struct Players {
    remote: Option<MediaRemote>,
}

impl Players {
    fn new() -> Self {
        Self {
            remote: MediaRemote::load(),
        }
    }
}

impl Transport for Players {
    type Session = Session;

    fn list(&mut self) -> Result<Vec<Listed<Session>>, Failure> {
        let mut listed = Vec::new();
        if let Some(remote) = &self.remote
            && let Some(playing) = remote.is_playing()
        {
            listed.push(Listed {
                app: "now-playing".to_owned(),
                playback: if playing {
                    Playback::Playing
                } else {
                    Playback::Paused
                },
                session: Session::NowPlaying,
            });
        }
        for (index, player) in SCRIPTED.iter().enumerate() {
            if !running(player.bundle) {
                continue;
            }
            let state = match tell(player.bundle, player.state) {
                Ok(state) => state,
                Err(failure) => {
                    log::debug!("media: a player did not say its state: {failure}");
                    continue;
                }
            };
            listed.push(Listed {
                app: player.bundle.to_owned(),
                playback: match state.trim() {
                    "playing" => Playback::Playing,
                    "paused" => Playback::Paused,
                    _ => Playback::Other,
                },
                session: Session::Scripted(index),
            });
        }
        Ok(listed)
    }

    fn pause(&mut self, sessions: Vec<Session>) -> Vec<Outcome> {
        sessions
            .into_iter()
            .map(|session| self.command(session, false))
            .collect()
    }

    fn play(&mut self, sessions: Vec<Session>) -> Vec<Outcome> {
        sessions
            .into_iter()
            .map(|session| self.command(session, true))
            .collect()
    }
}

impl Players {
    fn command(&self, session: Session, play: bool) -> Outcome {
        match session {
            Session::NowPlaying => match &self.remote {
                Some(remote) => Ok(remote.send(if play { PLAY } else { PAUSE })),
                None => Ok(false),
            },
            Session::Scripted(index) => {
                let player = &SCRIPTED[index];
                tell(player.bundle, if play { player.play } else { player.pause }).map(|_| true)
            }
        }
    }
}

/// Whether an app with this bundle identifier runs now.
fn running(bundle: &str) -> bool {
    autoreleasepool(|_| {
        let class: &AnyClass = class!(NSRunningApplication);
        let bundle = NSString::from_str(bundle);
        // SAFETY: a class method returning an array, which may be empty.
        unsafe {
            let list: objc2::rc::Retained<AnyObject> =
                msg_send![class, runningApplicationsWithBundleIdentifier: &*bundle];
            let count: usize = msg_send![&*list, count];
            count > 0
        }
    })
}

/// Runs `tell application id "<bundle>" to <body>` with a time limit, and gives what it printed.
fn tell(bundle: &str, body: &str) -> Result<String, Failure> {
    let script = format!("tell application id \"{bundle}\" to {body}");
    let mut child = Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| Failure::Os(e.raw_os_error().unwrap_or(-1)))?;
    let deadline = Instant::now() + PLAYER_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    let _ = stdout.read_to_string(&mut out);
                }
                return if status.success() {
                    Ok(out)
                } else {
                    Err(Failure::Os(status.code().unwrap_or(-1)))
                };
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(15)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Failure::TimedOut);
            }
            Err(e) => return Err(Failure::Os(e.raw_os_error().unwrap_or(-1))),
        }
    }
}

// ---------- MediaRemote ----------

/// `kMRPlay`.
const PLAY: u32 = 0;
/// `kMRPause`.
const PAUSE: u32 = 1;

type GetIsPlaying = unsafe extern "C" fn(queue: *mut c_void, block: *mut c_void);
type SendCommand = unsafe extern "C" fn(command: u32, options: *const c_void) -> bool;

unsafe extern "C" {
    fn dlopen(path: *const std::ffi::c_char, mode: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const std::ffi::c_char) -> *mut c_void;
    fn dispatch_get_global_queue(identifier: isize, flags: usize) -> *mut c_void;
}

/// The private MediaRemote framework, loaded at run time.
struct MediaRemote {
    is_playing: GetIsPlaying,
    send: SendCommand,
}

// SAFETY: plain function pointers into a framework that stays loaded.
unsafe impl Send for MediaRemote {}

impl MediaRemote {
    fn load() -> Option<Self> {
        let path =
            CString::new("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote")
                .ok()?;
        // SAFETY: dlopen and dlsym with valid strings; the symbols have the signatures declared.
        unsafe {
            let handle = dlopen(path.as_ptr(), 1 /* RTLD_LAZY */);
            if handle.is_null() {
                return None;
            }
            let is_playing = dlsym(
                handle,
                c"MRMediaRemoteGetNowPlayingApplicationIsPlaying".as_ptr(),
            );
            let send = dlsym(handle, c"MRMediaRemoteSendCommand".as_ptr());
            if is_playing.is_null() || send.is_null() {
                return None;
            }
            Some(Self {
                is_playing: std::mem::transmute::<*mut c_void, GetIsPlaying>(is_playing),
                send: std::mem::transmute::<*mut c_void, SendCommand>(send),
            })
        }
    }

    /// Whether the now-playing app plays; `None` when macOS does not answer this app.
    fn is_playing(&self) -> Option<bool> {
        let (send, receive) = mpsc::channel();
        let block = RcBlock::new(move |playing: Bool| {
            let _ = send.send(playing.as_bool());
        });
        // SAFETY: a global queue and a block that MediaRemote copies.
        unsafe {
            (self.is_playing)(
                dispatch_get_global_queue(0, 0),
                RcBlock::as_ptr(&block).cast::<c_void>(),
            );
        }
        receive.recv_timeout(PLAYER_TIMEOUT).ok()
    }

    fn send(&self, command: u32) -> bool {
        // SAFETY: a command number and no options.
        unsafe { (self.send)(command, std::ptr::null()) }
    }
}
