import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.royalcasino.app',
    appName: 'Royal Casino',
    webDir: 'www',

    // Load directly from server - no need to bundle web files
    server: {
        // Production URL
        url: 'https://g18game.onrender.com',
        cleartext: true,
        androidScheme: 'https',
        allowNavigation: [
            'g18game.onrender.com',
            'discord.com',
            '*.discord.com',
            'discordapp.com',
            '*.discordapp.com'
        ]
    },

    // Android specific settings
    android: {
        allowMixedContent: true, // Allow loading http content
        captureInput: true,
        webContentsDebuggingEnabled: true // Enable for debugging, disable in production
    },

    // Status bar and splash screen configuration
    plugins: {
        StatusBar: {
            style: 'DARK',
            backgroundColor: '#0a0612',
            overlaysWebView: true,
            visible: false
        },
        SplashScreen: {
            launchShowDuration: 2000,
            backgroundColor: '#0a0612',
            showSpinner: true,
            spinnerColor: '#ffd700'
        }
    }
};

export default config;
