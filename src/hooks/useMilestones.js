import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkMilestones } from '../components/MilestoneModal';

const SEEN_KEY = 'fitzo:seenMilestones';

export default function useMilestones({ workoutCount, totalVolume, streak, foodCount, sleepCount }) {
  const [pendingMilestone, setPendingMilestone] = useState(null);
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    if (workoutCount == null) return;
    (async () => {
      const raw = await AsyncStorage.getItem(SEEN_KEY);
      const seen = new Set(raw ? JSON.parse(raw) : []);
      const triggered = checkMilestones({ workoutCount, totalVolume, streak, foodCount, sleepCount });
      const fresh = triggered.filter(id => !seen.has(id));
      if (fresh.length) setQueue(fresh);
    })();
  }, [workoutCount, totalVolume, streak, foodCount, sleepCount]);

  useEffect(() => {
    if (queue.length && !pendingMilestone) {
      setPendingMilestone(queue[0]);
    }
  }, [queue, pendingMilestone]);

  const dismissMilestone = async () => {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const seen = new Set(raw ? JSON.parse(raw) : []);
    seen.add(pendingMilestone);
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    const next = queue.slice(1);
    setQueue(next);
    setPendingMilestone(next[0] ?? null);
  };

  return { pendingMilestone, dismissMilestone };
}
