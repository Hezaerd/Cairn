//! Random passwords from the OS CSPRNG.
use crate::{Result, VaultError};
use serde::Deserialize;
use zeroize::Zeroizing;

pub const MIN_LENGTH: usize = 8;
pub const MAX_LENGTH: usize = 128;

const LOWERCASE: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPERCASE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!#$%&()*+,-./:;<=>?@[]^_{|}~";
/// Characters that are easy to confuse with another one when read or typed by hand.
const AMBIGUOUS: &[u8] = b"Il1O0o|";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordOptions {
    pub length: usize,
    pub lowercase: bool,
    pub uppercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub avoid_ambiguous: bool,
}

impl Default for PasswordOptions {
    fn default() -> Self {
        Self {
            length: 20,
            lowercase: true,
            uppercase: true,
            digits: true,
            symbols: true,
            avoid_ambiguous: false,
        }
    }
}

impl PasswordOptions {
    /// The enabled character sets, without ambiguous characters if asked to.
    fn sets(&self) -> Vec<Vec<u8>> {
        [
            (self.lowercase, LOWERCASE),
            (self.uppercase, UPPERCASE),
            (self.digits, DIGITS),
            (self.symbols, SYMBOLS),
        ]
        .into_iter()
        .filter(|(enabled, _)| *enabled)
        .map(|(_, set)| {
            set.iter()
                .copied()
                .filter(|byte| !(self.avoid_ambiguous && AMBIGUOUS.contains(byte)))
                .collect()
        })
        .collect()
    }
}

/// Generates a password with at least one character from every enabled set.
pub fn generate_password(options: &PasswordOptions) -> Result<Zeroizing<String>> {
    if !(MIN_LENGTH..=MAX_LENGTH).contains(&options.length) {
        return Err(VaultError::InvalidInput);
    }
    let sets = options.sets();
    if sets.is_empty() {
        return Err(VaultError::InvalidInput);
    }
    let alphabet: Vec<u8> = sets.concat();
    let mut random = Uniform::default();
    let mut password = Zeroizing::new(Vec::with_capacity(options.length));
    // One character from each set, then the rest from all of them, then a shuffle so the
    // required characters don't sit at the start.
    for set in &sets {
        password.push(set[random.below(set.len())?]);
    }
    while password.len() < options.length {
        password.push(alphabet[random.below(alphabet.len())?]);
    }
    for index in (1..password.len()).rev() {
        password.swap(index, random.below(index + 1)?);
    }
    let password = std::str::from_utf8(&password).map_err(|_| VaultError::InvalidInput)?;
    Ok(Zeroizing::new(password.to_owned()))
}

/// Unbiased indexes from buffered OS randomness.
struct Uniform {
    buffer: Zeroizing<[u8; 32]>,
    used: usize,
}

impl Default for Uniform {
    fn default() -> Self {
        Self {
            buffer: Zeroizing::new([0; 32]),
            used: 32,
        }
    }
}

impl Uniform {
    fn byte(&mut self) -> Result<u8> {
        if self.used == self.buffer.len() {
            getrandom::fill(self.buffer.as_mut()).map_err(|_| VaultError::Randomness)?;
            self.used = 0;
        }
        let byte = self.buffer[self.used];
        self.used += 1;
        Ok(byte)
    }

    /// A uniform index below `bound`, which is at most 256. Rejection sampling drops the bytes
    /// past the largest multiple of `bound`, so no index is likelier than another.
    fn below(&mut self, bound: usize) -> Result<usize> {
        debug_assert!((1..=256).contains(&bound));
        let limit = 256 - 256 % bound;
        loop {
            let byte = usize::from(self.byte()?);
            if byte < limit {
                return Ok(byte % bound);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> PasswordOptions {
        PasswordOptions::default()
    }

    #[test]
    fn has_the_requested_length() {
        for length in [MIN_LENGTH, 20, 64, MAX_LENGTH] {
            let password = generate_password(&PasswordOptions { length, ..options() }).unwrap();
            assert_eq!(password.len(), length);
        }
    }

    #[test]
    fn rejects_lengths_out_of_range_and_empty_selections() {
        for length in [0, MIN_LENGTH - 1, MAX_LENGTH + 1] {
            let options = PasswordOptions { length, ..options() };
            assert_eq!(generate_password(&options).err(), Some(VaultError::InvalidInput));
        }
        let none = PasswordOptions {
            lowercase: false,
            uppercase: false,
            digits: false,
            symbols: false,
            ..options()
        };
        assert_eq!(generate_password(&none).err(), Some(VaultError::InvalidInput));
    }

    #[test]
    fn includes_every_enabled_set_and_nothing_else() {
        let combinations = (1..16u8).map(|bits| PasswordOptions {
            length: MIN_LENGTH,
            lowercase: bits & 1 != 0,
            uppercase: bits & 2 != 0,
            digits: bits & 4 != 0,
            symbols: bits & 8 != 0,
            avoid_ambiguous: bits % 3 == 0,
        });
        for options in combinations {
            let sets = options.sets();
            let alphabet = sets.concat();
            for _ in 0..200 {
                let password = generate_password(&options).unwrap();
                let bytes = password.as_bytes();
                assert!(bytes.iter().all(|byte| alphabet.contains(byte)), "{options:?}");
                for set in &sets {
                    assert!(bytes.iter().any(|byte| set.contains(byte)), "{options:?}");
                }
            }
        }
    }

    #[test]
    fn avoids_ambiguous_characters() {
        let options = PasswordOptions {
            length: MAX_LENGTH,
            avoid_ambiguous: true,
            ..options()
        };
        for _ in 0..100 {
            let password = generate_password(&options).unwrap();
            assert!(!password.bytes().any(|byte| AMBIGUOUS.contains(&byte)));
        }
    }

    #[test]
    fn spreads_characters_evenly() {
        // 26 lowercase letters over about 260,000 characters: each expects 10,000 hits with a
        // standard deviation near 100, so 10% either way only fails on a real bias.
        let options = PasswordOptions {
            length: MAX_LENGTH,
            uppercase: false,
            digits: false,
            symbols: false,
            ..options()
        };
        let mut counts = [0usize; 26];
        for _ in 0..2_032 {
            for byte in generate_password(&options).unwrap().bytes() {
                counts[usize::from(byte - b'a')] += 1;
            }
        }
        let expected = counts.iter().sum::<usize>() / counts.len();
        for (letter, count) in counts.iter().enumerate() {
            assert!(
                count.abs_diff(expected) < expected / 10,
                "{} appeared {count} times, expected about {expected}",
                char::from(b'a' + letter as u8)
            );
        }
    }

    #[test]
    fn index_sampling_is_unbiased_for_awkward_bounds() {
        // 256 % 94 leaves 68 values that a plain modulo would hand to the first 68 indexes.
        let mut random = Uniform::default();
        let bound = 94;
        let mut counts = vec![0usize; bound];
        for _ in 0..188_000 {
            counts[random.below(bound).unwrap()] += 1;
        }
        let low: usize = counts[..68].iter().sum::<usize>() / 68;
        let high: usize = counts[68..].iter().sum::<usize>() / (bound - 68);
        assert!(low.abs_diff(high) < 100, "low {low}, high {high}");
    }
}
