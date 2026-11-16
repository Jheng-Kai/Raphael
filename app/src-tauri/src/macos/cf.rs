//! Owned CoreFoundation objects and the conversions the shell needs (strings, numbers, booleans,
//! arrays and dictionaries).

use std::ffi::c_void;
use std::ptr::NonNull;

use super::ffi::*;

/// A CoreFoundation object this side owns (one retain), released when dropped.
#[derive(Debug)]
pub struct Cf(NonNull<c_void>);

// SAFETY: CoreFoundation's retain counts are atomic and the immutable objects used here (strings,
// numbers, arrays, dictionaries, accessibility elements) may be used from any thread.
unsafe impl Send for Cf {}
// SAFETY: as above.
unsafe impl Sync for Cf {}

impl Cf {
    /// Takes ownership of an object returned by a Create or Copy function. `None` for null.
    ///
    /// # Safety
    ///
    /// `ptr` must be null or a CoreFoundation object the caller owns one retain of.
    pub unsafe fn owned(ptr: CFTypeRef) -> Option<Self> {
        NonNull::new(ptr.cast_mut()).map(Self)
    }

    /// Retains an object returned by a Get function. `None` for null.
    ///
    /// # Safety
    ///
    /// `ptr` must be null or a valid CoreFoundation object.
    pub unsafe fn retained(ptr: CFTypeRef) -> Option<Self> {
        if ptr.is_null() {
            return None;
        }
        // SAFETY: a valid object, per the caller.
        unsafe { CFRetain(ptr) };
        NonNull::new(ptr.cast_mut()).map(Self)
    }

    pub fn as_ptr(&self) -> CFTypeRef {
        self.0.as_ptr().cast_const()
    }

    pub fn type_id(&self) -> CFTypeID {
        // SAFETY: a valid object.
        unsafe { CFGetTypeID(self.as_ptr()) }
    }

    /// The object as a string, if it is one.
    pub fn string(&self) -> Option<String> {
        string_of(self.as_ptr())
    }

    /// The object as a boolean, if it is one (a number counts as its being non-zero).
    pub fn boolean(&self) -> Option<bool> {
        bool_of(self.as_ptr())
    }

    /// The object as a 64-bit integer, if it is a number.
    pub fn int(&self) -> Option<i64> {
        int_of(self.as_ptr())
    }

    /// The elements of an array (retained), if the object is one.
    pub fn array(&self) -> Option<Vec<Cf>> {
        array_of(self.as_ptr())
    }
}

impl Clone for Cf {
    fn clone(&self) -> Self {
        // SAFETY: a valid object; the new value owns the new retain.
        unsafe { CFRetain(self.as_ptr()) };
        Self(self.0)
    }
}

impl Drop for Cf {
    fn drop(&mut self) {
        // SAFETY: this value owns one retain.
        unsafe { CFRelease(self.as_ptr()) };
    }
}

/// A new CoreFoundation string with `text`.
pub fn string(text: &str) -> Cf {
    // SAFETY: the bytes are valid UTF-8 of the length given; the result is owned.
    unsafe {
        Cf::owned(CFStringCreateWithBytes(
            kCFAllocatorDefault,
            text.as_ptr(),
            text.len() as CFIndex,
            kCFStringEncodingUTF8,
            0,
        ))
    }
    .expect("CFStringCreateWithBytes failed")
}

/// The text of `ptr` if it is a string.
pub fn string_of(ptr: CFTypeRef) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: a valid object; the buffer is as long as said.
    unsafe {
        if CFGetTypeID(ptr) != CFStringGetTypeID() {
            return None;
        }
        let length = CFStringGetLength(ptr);
        let range = CFRange {
            location: 0,
            length,
        };
        let mut needed: CFIndex = 0;
        CFStringGetBytes(
            ptr,
            range,
            kCFStringEncodingUTF8,
            b'?',
            0,
            std::ptr::null_mut(),
            0,
            &mut needed,
        );
        let mut buffer = vec![0u8; needed.max(0) as usize];
        let mut used: CFIndex = 0;
        CFStringGetBytes(
            ptr,
            range,
            kCFStringEncodingUTF8,
            b'?',
            0,
            buffer.as_mut_ptr(),
            buffer.len() as CFIndex,
            &mut used,
        );
        buffer.truncate(used.max(0) as usize);
        Some(String::from_utf8_lossy(&buffer).into_owned())
    }
}

/// The value of `ptr` if it is a boolean or a number.
pub fn bool_of(ptr: CFTypeRef) -> Option<bool> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: a valid object.
    unsafe {
        if CFGetTypeID(ptr) == CFBooleanGetTypeID() {
            return Some(CFBooleanGetValue(ptr) != 0);
        }
    }
    int_of(ptr).map(|value| value != 0)
}

/// The value of `ptr` if it is a number (or a boolean).
pub fn int_of(ptr: CFTypeRef) -> Option<i64> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: a valid object; the value pointer has the size of the type asked for.
    unsafe {
        let type_id = CFGetTypeID(ptr);
        if type_id == CFBooleanGetTypeID() {
            return Some(i64::from(CFBooleanGetValue(ptr) != 0));
        }
        if type_id != CFNumberGetTypeID() {
            return None;
        }
        let mut value: i64 = 0;
        if CFNumberGetValue(ptr, kCFNumberSInt64Type, (&raw mut value).cast()) != 0 {
            return Some(value);
        }
        let mut real: f64 = 0.0;
        (CFNumberGetValue(ptr, kCFNumberDoubleType, (&raw mut real).cast()) != 0)
            .then_some(real as i64)
    }
}

/// The value of `ptr` as a floating-point number, if it is a number.
pub fn f64_of(ptr: CFTypeRef) -> Option<f64> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: a valid object; the value pointer has the size of the type asked for.
    unsafe {
        if CFGetTypeID(ptr) != CFNumberGetTypeID() {
            return None;
        }
        let mut real: f64 = 0.0;
        (CFNumberGetValue(ptr, kCFNumberDoubleType, (&raw mut real).cast()) != 0).then_some(real)
    }
}

/// The elements of `ptr` (each retained) if it is an array.
pub fn array_of(ptr: CFTypeRef) -> Option<Vec<Cf>> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: a valid array; each element is retained by `Cf::retained`.
    unsafe {
        if CFGetTypeID(ptr) != CFArrayGetTypeID() {
            return None;
        }
        let count = CFArrayGetCount(ptr);
        Some(
            (0..count)
                .filter_map(|index| Cf::retained(CFArrayGetValueAtIndex(ptr, index)))
                .collect(),
        )
    }
}

/// The value under `key` of the dictionary `dict` (not retained: valid while `dict` is).
pub fn dict_get(dict: CFTypeRef, key: CFStringRef) -> CFTypeRef {
    if dict.is_null() || key.is_null() {
        return std::ptr::null();
    }
    // SAFETY: a valid dictionary and key.
    unsafe {
        if CFGetTypeID(dict) != CFDictionaryGetTypeID() {
            return std::ptr::null();
        }
        CFDictionaryGetValue(dict, key)
    }
}

/// A one-entry dictionary `{key: true}`, as option dictionaries take it.
pub fn dict_true(key: CFStringRef) -> Option<Cf> {
    let keys = [key];
    // SAFETY: the static boolean; the callbacks are CoreFoundation's own for CF types.
    unsafe {
        let values = [kCFBooleanTrue];
        Cf::owned(CFDictionaryCreate(
            kCFAllocatorDefault,
            keys.as_ptr(),
            values.as_ptr(),
            1,
            (&raw const kCFTypeDictionaryKeyCallBacks).cast(),
            (&raw const kCFTypeDictionaryValueCallBacks).cast(),
        ))
    }
}

/// A CoreFoundation number holding `value`.
#[cfg(test)]
pub fn number(value: i64) -> Cf {
    // SAFETY: the pointer is to an i64 of the type given; the result is owned.
    unsafe {
        Cf::owned(CFNumberCreate(
            kCFAllocatorDefault,
            kCFNumberSInt64Type,
            (&raw const value).cast(),
        ))
    }
    .expect("CFNumberCreate failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_go_there_and_back_with_any_characters() {
        for text in ["", "Raphael", "拉斐爾 ok ✓", "line\nbreak"] {
            assert_eq!(string(text).string().as_deref(), Some(text));
        }
    }

    #[test]
    fn numbers_and_booleans_read_back() {
        assert_eq!(number(42).int(), Some(42));
        assert_eq!(number(-7).boolean(), Some(true));
        assert_eq!(number(0).boolean(), Some(false));
        assert_eq!(string("1").int(), None);
    }
}
