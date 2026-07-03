import { useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import { SOUND_URIS } from './soundUris';

// Global mute state (persists across component remounts without context)
let _muted = false;
export function getSoundMuted() { return _muted; }
export function setSoundMuted(v) { _muted = v; }

// Cache loaded Sound objects so we don't reload the same URI repeatedly
const _cache = {};

async function loadSound(name) {
  if (_cache[name]) return _cache[name];
  const uri = SOUND_URIS[name];
  if (!uri) return null;
  const { sound } = await Audio.Sound.createAsync({ uri });
  _cache[name] = sound;
  return sound;
}

export function useSound() {
  const activeRef = useRef([]);

  const play = useCallback(async (name) => {
    if (_muted) return;
    try {
      const sound = await loadSound(name);
      if (!sound) return;
      await sound.setPositionAsync(0);
      await sound.playAsync();
    } catch {
      // Silently ignore audio errors — never crash the game
    }
  }, []);

  return { play };
}
