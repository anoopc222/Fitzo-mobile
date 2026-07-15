import { useCallback } from 'react';
import { SOUND_URIS } from './soundUris';

let _muted = false;
export function getSoundMuted() { return _muted; }
export function setSoundMuted(v) { _muted = v; }

export function useSound() {
  const play = useCallback(async (name) => {
    if (_muted) return;
    try {
      const uri = SOUND_URIS[name];
      if (!uri) return;
      const { Audio } = await import('expo-av');
      const { sound } = await Audio.Sound.createAsync({ uri });
      await sound.playAsync();
      // Unload after playback to free memory
      sound.setOnPlaybackStatusUpdate(status => {
        if (status.didJustFinish) sound.unloadAsync().catch(() => {});
      });
    } catch {
      // Silently ignore audio errors — never crash the game
    }
  }, []);

  return { play };
}
