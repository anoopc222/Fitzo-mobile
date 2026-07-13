import { useCallback } from 'react';
import { SOUND_URIS } from './soundUris';

// Global mute state (persists across component remounts without context)
let _muted = false;
export function getSoundMuted() { return _muted; }
export function setSoundMuted(v) { _muted = v; }

export function useSound() {
  const play = useCallback(async (name) => {
    if (_muted) return;
    try {
      const uri = SOUND_URIS[name];
      if (!uri) return;
      // Lazy-import so bundler only loads expo-audio when actually needed
      const { AudioPlayer } = await import('expo-audio');
      const player = new AudioPlayer({ uri });
      player.play();
    } catch {
      // Silently ignore audio errors — never crash the game
    }
  }, []);

  return { play };
}
