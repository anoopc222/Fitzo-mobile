# /new-screen

Scaffold a new screen component for the Fitzo app.

Steps:
1. Create `screens/<ScreenName>.js` (or `.tsx` if TypeScript is added)
2. Export a default React component from it
3. Register it in the navigation stack (install `@react-navigation/native` via `npx expo install` if not present)

Minimal screen template:

```js
import { View, Text, StyleSheet } from 'react-native';

export default function <ScreenName>Screen() {
  return (
    <View style={styles.container}>
      <Text><ScreenName></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```
