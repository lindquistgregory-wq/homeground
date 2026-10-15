/**
 * Text and TextInput in the app's typeface (Inter). Android picks a custom font by family name, not
 * by weight, so a style's fontWeight / fontStyle is mapped to the matching Inter file here; screens
 * keep writing `fontWeight: '600'` as usual. A style that sets its own fontFamily is left alone, and
 * nested text with no weight of its own inherits its parent's font, as React Native text does.
 */
import { createContext, useContext } from 'react';
import { Text as RNText, TextInput as RNTextInput, StyleSheet, type TextInputProps, type TextProps, type TextStyle } from 'react-native';

export const FONTS = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

const Nested = createContext(false);

function family(style: TextStyle | undefined, nested: boolean): TextStyle | undefined {
  if (style?.fontFamily) return undefined;
  if (nested && style?.fontWeight === undefined && style?.fontStyle === undefined) return undefined;
  const w = String(style?.fontWeight ?? '400');
  const base = w === 'bold' || Number(w) >= 700 ? FONTS.bold : Number(w) >= 600 ? FONTS.semibold : Number(w) >= 500 ? FONTS.medium : FONTS.regular;
  return { fontFamily: style?.fontStyle === 'italic' ? `${base}_Italic` : base, fontWeight: 'normal', fontStyle: 'normal' };
}

export function Text(props: TextProps) {
  const nested = useContext(Nested);
  const f = family(StyleSheet.flatten(props.style) as TextStyle | undefined, nested);
  return (
    <Nested.Provider value>
      <RNText {...props} style={f ? [props.style, f] : props.style} />
    </Nested.Provider>
  );
}

export function TextInput(props: TextInputProps) {
  const f = family(StyleSheet.flatten(props.style) as TextStyle | undefined, false);
  return <RNTextInput {...props} style={f ? [props.style, f] : props.style} />;
}
