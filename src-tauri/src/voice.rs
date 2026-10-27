//! Microphone capture + offline speech recognition.
//!
//! Emits to all windows:
//!   gp:voice-level   { level: 0..1 }           ~20 times a second
//!   gp:voice-partial { text }                  words heard so far in the current phrase
//!   gp:voice-final   { text }                  a finished phrase
//!   gp:voice-error   { message }

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::vosk::{self, Model, Recognizer};

#[derive(Default)]
pub struct VoiceState {
    running: Mutex<Option<Running>>,
    model: Mutex<Option<(PathBuf, Arc<Model>)>>,
}

struct Running {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Running {
    fn halt(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig {
    /// Microphone name; None = Windows default input.
    pub device: Option<String>,
    /// false = only measure loudness (voice-activated scrolling), true = also recognise words.
    pub recognize: bool,
    /// Words the recogniser may output. Restricting to the script's words helps accuracy a lot.
    pub vocabulary: Option<Vec<String>>,
    /// Custom Vosk model folder; None = bundled small English model.
    pub model_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    device: String,
    sample_rate: u32,
    recognizing: bool,
    vocabulary_size: usize,
    unknown_words: Vec<String>,
}

fn vosk_dir(app: &AppHandle) -> PathBuf {
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("vosk");
        if p.exists() {
            return p;
        }
    }
    // Development fallback: straight from the source tree.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("vosk")
}

fn get_model(app: &AppHandle, state: &VoiceState, custom: Option<&str>) -> Result<Arc<Model>, String> {
    let dir = vosk_dir(app);
    let api = vosk::get(&dir.join("lib"))?;
    let path = match custom {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
        _ => dir.join("model"),
    };
    let mut cache = state.model.lock().unwrap();
    if let Some((p, m)) = cache.as_ref() {
        if *p == path {
            return Ok(m.clone());
        }
    }
    *cache = None; // free the old model before loading a new one
    let model = Arc::new(Model::load(api, &path)?);
    *cache = Some((path, model.clone()));
    Ok(model)
}

fn find_device(name: &Option<String>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(wanted) = name.as_ref().filter(|n| !n.is_empty()) {
        if let Ok(devices) = host.input_devices() {
            for d in devices {
                if d.name().map(|n| &n == wanted).unwrap_or(false) {
                    return Ok(d);
                }
            }
        }
    }
    host.default_input_device()
        .ok_or_else(|| "No microphone found. Check Windows Settings > Privacy > Microphone.".to_string())
}

#[tauri::command]
pub fn voice_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|it| it.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn voice_start(
    app: AppHandle,
    state: State<'_, VoiceState>,
    config: VoiceConfig,
) -> Result<VoiceInfo, String> {
    if let Some(r) = state.running.lock().unwrap().take() {
        r.halt();
    }

    let mut unknown = Vec::new();
    let mut vocab_size = 0;
    let recognizer_setup = if config.recognize {
        let model = get_model(&app, &state, config.model_path.as_deref())?;
        let grammar = config.vocabulary.as_ref().filter(|v| !v.is_empty()).map(|words| {
            let mut known: Vec<String> = Vec::new();
            for w in words {
                if model.knows(w) {
                    known.push(w.clone());
                } else {
                    unknown.push(w.clone());
                }
            }
            vocab_size = known.len();
            known.push("[unk]".into());
            serde_json::to_string(&known).unwrap()
        });
        Some((model, grammar))
    } else {
        None
    };

    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(String, u32), String>>();
    let thread_stop = stop.clone();
    let thread_app = app.clone();
    let device_name = config.device.clone();

    let thread = std::thread::spawn(move || {
        if let Err(e) = audio_loop(thread_app.clone(), device_name, recognizer_setup, thread_stop, &ready_tx) {
            // If we failed before signalling ready, report through the channel; else as an event.
            if ready_tx.send(Err(e.clone())).is_err() {
                let _ = thread_app.emit("gp:voice-error", json!({ "message": e }));
            }
        }
    });

    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok((device, sample_rate))) => {
            *state.running.lock().unwrap() = Some(Running { stop, thread: Some(thread) });
            Ok(VoiceInfo {
                device,
                sample_rate,
                recognizing: config.recognize,
                vocabulary_size: vocab_size,
                unknown_words: unknown,
            })
        }
        Ok(Err(e)) => {
            stop.store(true, Ordering::SeqCst);
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            Err("The microphone did not respond.".into())
        }
    }
}

#[tauri::command]
pub fn voice_stop(state: State<'_, VoiceState>) {
    if let Some(r) = state.running.lock().unwrap().take() {
        r.halt();
    }
}

pub fn stop_all(app: &AppHandle) {
    if let Some(state) = app.try_state::<VoiceState>() {
        if let Some(r) = state.running.lock().unwrap().take() {
            r.halt();
        }
    }
}

fn push_mono<T: Copy>(data: &[T], channels: usize, conv: impl Fn(T) -> f32, tx: &SyncSender<Vec<i16>>) {
    let channels = channels.max(1);
    let mut out = Vec::with_capacity(data.len() / channels);
    for frame in data.chunks(channels) {
        let sum: f32 = frame.iter().map(|s| conv(*s)).sum();
        let v = (sum / frame.len() as f32).clamp(-1.0, 1.0);
        out.push((v * 32767.0) as i16);
    }
    let _ = tx.try_send(out); // drop audio rather than block the audio thread
}

fn audio_loop(
    app: AppHandle,
    device_name: Option<String>,
    recognizer_setup: Option<(Arc<Model>, Option<String>)>,
    stop: Arc<AtomicBool>,
    ready: &mpsc::Sender<Result<(String, u32), String>>,
) -> Result<(), String> {
    let device = find_device(&device_name)?;
    let name = device.name().unwrap_or_else(|_| "Microphone".into());
    let supported = device
        .default_input_config()
        .map_err(|e| format!("Could not open microphone \"{name}\": {e}"))?;
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let format = supported.sample_format();
    let stream_config: cpal::StreamConfig = supported.into();

    let (tx, rx): (SyncSender<Vec<i16>>, Receiver<Vec<i16>>) = mpsc::sync_channel(256);
    let err_app = app.clone();
    let on_err = move |e: cpal::StreamError| {
        let _ = err_app.emit("gp:voice-error", json!({ "message": format!("Microphone error: {e}") }));
    };

    let stream = match format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |d: &[f32], _: &_| push_mono(d, channels, |s| s, &tx),
            on_err,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |d: &[i16], _: &_| push_mono(d, channels, |s| s as f32 / 32768.0, &tx),
            on_err,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &stream_config,
            move |d: &[u16], _: &_| push_mono(d, channels, |s| (s as f32 - 32768.0) / 32768.0, &tx),
            on_err,
            None,
        ),
        cpal::SampleFormat::I32 => device.build_input_stream(
            &stream_config,
            move |d: &[i32], _: &_| push_mono(d, channels, |s| s as f32 / 2147483648.0, &tx),
            on_err,
            None,
        ),
        other => return Err(format!("Unsupported microphone format {other:?}")),
    }
    .map_err(|e| format!("Could not start microphone \"{name}\": {e}"))?;

    stream
        .play()
        .map_err(|e| format!("Could not start microphone \"{name}\": {e}"))?;

    let mut recognizer = match &recognizer_setup {
        Some((model, grammar)) => Some(Recognizer::new(model, sample_rate as f32, grammar.as_deref())?),
        None => None,
    };

    let _ = ready.send(Ok((name, sample_rate)));

    // Feed the recogniser ~100 ms at a time; report loudness every ~50 ms.
    let feed_size = (sample_rate as usize / 10).max(1);
    let level_size = (sample_rate as usize / 20).max(1);
    let mut feed_buf: Vec<i16> = Vec::with_capacity(feed_size * 2);
    let mut sq_sum = 0f64;
    let mut sq_count = 0usize;
    let mut last_partial = String::new();
    let mut last_level_emit = Instant::now();

    while !stop.load(Ordering::SeqCst) {
        let chunk = match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(c) => c,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };

        for s in &chunk {
            let f = *s as f64 / 32768.0;
            sq_sum += f * f;
        }
        sq_count += chunk.len();
        if sq_count >= level_size || last_level_emit.elapsed() > Duration::from_millis(80) {
            let rms = (sq_sum / sq_count.max(1) as f64).sqrt();
            // Map -60 dB..0 dB to 0..1
            let db = 20.0 * rms.max(1e-6).log10();
            let level = ((db + 60.0) / 60.0).clamp(0.0, 1.0);
            let _ = app.emit("gp:voice-level", json!({ "level": level }));
            sq_sum = 0.0;
            sq_count = 0;
            last_level_emit = Instant::now();
        }

        if let Some(rec) = recognizer.as_mut() {
            feed_buf.extend_from_slice(&chunk);
            if feed_buf.len() >= feed_size {
                if rec.accept(&feed_buf) {
                    let text = text_field(&rec.result(), "text");
                    if !text.is_empty() {
                        let _ = app.emit("gp:voice-final", json!({ "text": text }));
                    }
                    last_partial.clear();
                } else {
                    let partial = text_field(&rec.partial(), "partial");
                    if partial != last_partial {
                        let _ = app.emit("gp:voice-partial", json!({ "text": partial }));
                        last_partial = partial;
                    }
                }
                feed_buf.clear();
            }
        }
    }

    drop(stream);
    if let Some(rec) = recognizer.as_mut() {
        let text = text_field(&rec.final_result(), "text");
        if !text.is_empty() {
            let _ = app.emit("gp:voice-final", json!({ "text": text }));
        }
    }
    let _ = app.emit("gp:voice-level", json!({ "level": 0.0 }));
    Ok(())
}

fn text_field(json_str: &str, key: &str) -> String {
    serde_json::from_str::<Value>(json_str)
        .ok()
        .and_then(|v| v.get(key).and_then(|t| t.as_str()).map(|s| s.trim().to_string()))
        .unwrap_or_default()
}

