import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Must be unique on your Apple Developer account; change before the first TestFlight upload.
  appId: 'com.pokerbank.app',
  appName: 'Poker Bank',
  webDir: 'dist',
  backgroundColor: '#111311',
  ios: {
    // The page handles safe areas itself (viewport-fit=cover + env(safe-area-inset-*)).
    contentInset: 'never',
    backgroundColor: '#111311',
  },
};

export default config;
