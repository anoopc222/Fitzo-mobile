import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

// Captures a branded off-screen view (an ExportCardTemplate) and shares
// the resulting PNG via the native share sheet.
export function useExportCard() {
  const ref = useRef(null);
  const [exporting, setExporting] = useState(false);

  const exportCard = async () => {
    if (!ref.current || exporting) return;
    setExporting(true);
    try {
      const uri = await captureRef(ref, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your progress' });
      } else {
        Alert.alert('Sharing unavailable', 'Sharing is not supported on this device.');
      }
    } catch (e) {
      Alert.alert('Export failed', e.message);
    } finally {
      setExporting(false);
    }
  };

  return { ref, exportCard, exporting };
}
