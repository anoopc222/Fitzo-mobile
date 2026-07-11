import { useQuery } from '@tanstack/react-query';

async function fetchExerciseImage(exerciseName) {
  const searchUrl =
    `https://wger.de/api/v2/exercise/search/?term=${encodeURIComponent(exerciseName)}&language=english&format=json`;

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) return null;

  const searchData = await searchRes.json();
  const suggestions = searchData?.suggestions;
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

  const baseId = suggestions[0]?.data?.base_id;
  if (!baseId) return null;

  const imageUrl =
    `https://wger.de/api/v2/exerciseimage/?exercise_base=${baseId}&format=json`;

  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) return null;

  const imageData = await imageRes.json();
  const results = imageData?.results;
  if (!Array.isArray(results) || results.length === 0) return null;

  // Prefer is_main, fall back to first result
  const main = results.find(r => r.is_main) ?? results[0];
  return main?.image ?? null;
}

export default function useExerciseDemo(exerciseName) {
  const { data: imageUrl = null, isLoading, error } = useQuery({
    queryKey: ['exerciseDemo', exerciseName],
    queryFn: () => fetchExerciseImage(exerciseName),
    enabled: Boolean(exerciseName),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
    retry: 1,
  });

  return { imageUrl, isLoading, error };
}
