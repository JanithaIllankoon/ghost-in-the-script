//! Minimal runtime bindings to libvosk.dll (offline speech recognition).
//!
//! The DLL is loaded at runtime instead of linked, so the app still starts
//! (with voice features disabled) if the speech files are missing.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;
use std::sync::OnceLock;

use libloading::os::windows::{Library, LOAD_WITH_ALTERED_SEARCH_PATH};

type ModelNew = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type ModelFree = unsafe extern "C" fn(*mut c_void);
type ModelFindWord = unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int;
type RecNew = unsafe extern "C" fn(*mut c_void, f32) -> *mut c_void;
type RecNewGrm = unsafe extern "C" fn(*mut c_void, f32, *const c_char) -> *mut c_void;
type RecAccept = unsafe extern "C" fn(*mut c_void, *const i16, c_int) -> c_int;
type RecResult = unsafe extern "C" fn(*mut c_void) -> *const c_char;
type RecFree = unsafe extern "C" fn(*mut c_void);
type SetLogLevel = unsafe extern "C" fn(c_int);

pub struct Vosk {
    _lib: Library,
    model_new: ModelNew,
    model_free: ModelFree,
    model_find_word: ModelFindWord,
    rec_new: RecNew,
    rec_new_grm: RecNewGrm,
    rec_accept: RecAccept,
    rec_result: RecResult,
    rec_partial: RecResult,
    rec_final: RecResult,
    rec_free: RecFree,
}

static VOSK: OnceLock<Result<Vosk, String>> = OnceLock::new();

pub fn get(lib_dir: &Path) -> Result<&'static Vosk, String> {
    VOSK.get_or_init(|| unsafe { load(lib_dir) })
        .as_ref()
        .map_err(|e| e.clone())
}

unsafe fn load(lib_dir: &Path) -> Result<Vosk, String> {
    let dll = lib_dir.join("libvosk.dll");
    if !dll.exists() {
        return Err(format!("Speech engine not found at {}", dll.display()));
    }
    // ALTERED_SEARCH_PATH makes Windows find libstdc++ etc. next to libvosk.dll.
    let lib = Library::load_with_flags(&dll, LOAD_WITH_ALTERED_SEARCH_PATH)
        .map_err(|e| format!("Could not load speech engine: {e}"))?;

    macro_rules! sym {
        ($name:literal, $ty:ty) => {
            *lib.get::<$ty>(concat!($name, "\0").as_bytes())
                .map_err(|e| format!("Speech engine is missing {}: {e}", $name))?
        };
    }

    let set_log: SetLogLevel = sym!("vosk_set_log_level", SetLogLevel);
    set_log(-1);

    Ok(Vosk {
        model_new: sym!("vosk_model_new", ModelNew),
        model_free: sym!("vosk_model_free", ModelFree),
        model_find_word: sym!("vosk_model_find_word", ModelFindWord),
        rec_new: sym!("vosk_recognizer_new", RecNew),
        rec_new_grm: sym!("vosk_recognizer_new_grm", RecNewGrm),
        rec_accept: sym!("vosk_recognizer_accept_waveform_s", RecAccept),
        rec_result: sym!("vosk_recognizer_result", RecResult),
        rec_partial: sym!("vosk_recognizer_partial_result", RecResult),
        rec_final: sym!("vosk_recognizer_final_result", RecResult),
        rec_free: sym!("vosk_recognizer_free", RecFree),
        _lib: lib,
    })
}

pub struct Model {
    api: &'static Vosk,
    ptr: *mut c_void,
}

// A Vosk model is read-only after loading and safe to share between threads.
unsafe impl Send for Model {}
unsafe impl Sync for Model {}

impl Model {
    pub fn load(api: &'static Vosk, path: &Path) -> Result<Model, String> {
        let c = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let ptr = unsafe { (api.model_new)(c.as_ptr()) };
        if ptr.is_null() {
            return Err(format!("Could not load speech model from {}", path.display()));
        }
        Ok(Model { api, ptr })
    }

    pub fn knows(&self, word: &str) -> bool {
        match CString::new(word) {
            Ok(c) => unsafe { (self.api.model_find_word)(self.ptr, c.as_ptr()) >= 0 },
            Err(_) => false,
        }
    }
}

impl Drop for Model {
    fn drop(&mut self) {
        unsafe { (self.api.model_free)(self.ptr) }
    }
}

pub struct Recognizer {
    api: &'static Vosk,
    ptr: *mut c_void,
}

unsafe impl Send for Recognizer {}

impl Recognizer {
    /// `grammar` is a JSON array of allowed phrases; `None` means free dictation.
    pub fn new(model: &Model, sample_rate: f32, grammar: Option<&str>) -> Result<Self, String> {
        let ptr = unsafe {
            match grammar {
                Some(g) => {
                    let c = CString::new(g).map_err(|e| e.to_string())?;
                    (model.api.rec_new_grm)(model.ptr, sample_rate, c.as_ptr())
                }
                None => (model.api.rec_new)(model.ptr, sample_rate),
            }
        };
        if ptr.is_null() {
            return Err("Could not start speech recognizer".into());
        }
        Ok(Recognizer { api: model.api, ptr })
    }

    /// Returns true when an utterance just ended (call `result` then).
    pub fn accept(&mut self, samples: &[i16]) -> bool {
        unsafe { (self.api.rec_accept)(self.ptr, samples.as_ptr(), samples.len() as c_int) == 1 }
    }

    pub fn result(&mut self) -> String {
        unsafe { read(self.api.rec_result, self.ptr) }
    }
    pub fn partial(&mut self) -> String {
        unsafe { read(self.api.rec_partial, self.ptr) }
    }
    pub fn final_result(&mut self) -> String {
        unsafe { read(self.api.rec_final, self.ptr) }
    }
}

unsafe fn read(f: RecResult, ptr: *mut c_void) -> String {
    let p = f(ptr);
    if p.is_null() {
        return String::new();
    }
    CStr::from_ptr(p).to_string_lossy().into_owned()
}

impl Drop for Recognizer {
    fn drop(&mut self) {
        unsafe { (self.api.rec_free)(self.ptr) }
    }
}
