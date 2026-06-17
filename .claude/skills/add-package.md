# /add-package

Install a package with Expo-compatible versioning.

Always use `npx expo install` instead of `npm install` for React Native / Expo packages so that Expo picks a version compatible with the current SDK.

```bash
npx expo install <package-name>
```

For pure JS packages with no native dependencies, `npm install` is fine.
