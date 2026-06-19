export const typography = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 30,
  xxxl: 38,
};

export const weight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  black: '900',
};

// Web app uses Playfair Display (display), Plus Jakarta Sans (body), Space Mono (data).
// Family names below match the @expo-google-fonts/* loaded family keys — see useAppFonts().
export const fontFamily = {
  display:      'PlayfairDisplay_700Bold',
  displayItalic: 'PlayfairDisplay_700Bold_Italic',
  body:         'PlusJakartaSans_400Regular',
  bodyMedium:   'PlusJakartaSans_500Medium',
  bodySemibold: 'PlusJakartaSans_600SemiBold',
  bodyBold:     'PlusJakartaSans_700Bold',
  bodyExtraBold: 'PlusJakartaSans_800ExtraBold',
  mono:         'SpaceMono_400Regular',
  monoBold:     'SpaceMono_700Bold',
};
