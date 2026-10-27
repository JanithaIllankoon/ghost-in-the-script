//! Minimal runtime bindings to libvosk.dll (offline speech recognition).
//!
//! The DLL is loaded at runtime instead of linked, so the app still starts
//! (with voice features disabled) if the speech files are missing.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
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
        let plain = plain_windows_path(path);
        if !plain.join("am").is_dir() || !plain.join("conf").is_dir() {
            return Err(format!(
                "{} isn't a Vosk speech model folder. It should contain am, conf and graph folders.",
                plain.display()
            ));
        }
        let c = CString::new(engine_path(&plain)).map_err(|e| e.to_string())?;
        let ptr = unsafe { (api.model_new)(c.as_ptr()) };
        if ptr.is_null() {
            return Err(format!("Could not load the speech model from {}", plain.display()));
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

/// Windows hands apps their own folder in "verbatim" form (`\\?\C:\...`, from canonicalize).
/// The speech engine can't open files through that form, so turn it back into a normal path.
pub fn plain_windows_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

#[link(name = "kernel32")]
extern "system" {
    fn GetShortPathNameW(long: *const u16, short: *mut u16, len: u32) -> u32;
}

/// The engine reads paths as plain bytes in the system code page, so a folder name with
/// non-English characters can fail. In that case use Windows' short (8.3) form, which is ASCII.
fn engine_path(path: &Path) -> String {
    let s = path.to_string_lossy().into_owned();
    if s.is_ascii() {
        return s;
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut buf = vec![0u16; 1024];
    let n = unsafe { GetShortPathNameW(wide.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) } as usize;
    if n > 0 && n < buf.len() {
        let short = String::from_utf16_lossy(&buf[..n]);
        if short.is_ascii() {
            return short;
        }
    }
    s
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

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled_vosk() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("vosk")
    }

    #[test]
    fn strips_verbatim_prefixes() {
        assert_eq!(
            plain_windows_path(Path::new(r"\\?\C:\Apps\Ghost In The Script")),
            PathBuf::from(r"C:\Apps\Ghost In The Script")
        );
        assert_eq!(
            plain_windows_path(Path::new(r"\\?\UNC\server\share\x")),
            PathBuf::from(r"\\server\share\x")
        );
        assert_eq!(plain_windows_path(Path::new(r"C:\plain")), PathBuf::from(r"C:\plain"));
    }

    /// The reported bug: the installed app gets its folder as \\?\C:\... and the model failed to load.
    #[test]
    fn loads_bundled_model_from_verbatim_path() {
        let dir = std::fs::canonicalize(bundled_vosk()).expect("run `npm run setup:speech` first");
        assert!(dir.to_string_lossy().starts_with(r"\\?\"), "canonicalize should give a verbatim path");
        let api = get(&dir.join("lib")).expect("speech engine loads");
        Model::load(api, &dir.join("model")).expect("model loads from a verbatim path");
    }

    #[test]
    fn explains_a_folder_that_is_not_a_model() {
        let api = get(&bundled_vosk().join("lib")).expect("speech engine loads");
        let err = Model::load(api, Path::new(env!("CARGO_MANIFEST_DIR"))).err().expect("should fail");
        assert!(err.contains("isn't a Vosk speech model folder"), "{err}");
    }
}
