import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

/**
 * Small app theme on top of Chakra's defaults: a "brand" palette (blue, the previous primary
 * color) used as the default colorPalette, and a few semantic tokens for app chrome. No web
 * fonts are loaded (CSP font-src is 'self' only), so the default system font stack applies.
 */
const config = defineConfig({
  globalCss: {
    html: { colorPalette: 'brand' },
    body: { bg: 'bg', color: 'fg' },
  },
  theme: {
    semanticTokens: {
      colors: {
        brand: {
          solid: { value: '{colors.blue.600}' },
          contrast: { value: '{colors.white}' },
          fg: { value: { _light: '{colors.blue.700}', _dark: '{colors.blue.300}' } },
          muted: { value: { _light: '{colors.blue.100}', _dark: '{colors.blue.900}' } },
          subtle: { value: { _light: '{colors.blue.50}', _dark: '{colors.blue.950}' } },
          emphasized: { value: { _light: '{colors.blue.200}', _dark: '{colors.blue.800}' } },
          focusRing: { value: '{colors.blue.500}' },
          border: { value: { _light: '{colors.blue.500}', _dark: '{colors.blue.400}' } },
        },
        header: {
          bg: { value: { _light: '{colors.white}', _dark: '{colors.gray.950}' } },
        },
        row: {
          selected: { value: '{colors.brand.subtle}' },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
