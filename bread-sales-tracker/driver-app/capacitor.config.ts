import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Change appId before publishing on the Play Store (it can never change afterwards).
  appId: 'com.breadsales.driver',
  appName: 'Bread Sales',
  webDir: 'dist',
  android: {
    // The server must be https:// - plain http is blocked inside the app.
    allowMixedContent: false,
  },
  plugins: {
    // White status-bar icons on the brand-coloured bar.
    SystemBars: { style: 'DARK' },
  },
};

export default config;
