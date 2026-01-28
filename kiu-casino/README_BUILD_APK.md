# Hướng Dẫn Build APK Android

Ứng dụng đã được cấu hình và build thành công. File APK hiện tại đang nằm ở `public/download/royal-casino.apk`.

## Để build phiên bản mới (khi cập nhật Plugin/Icon...)
Lưu ý: Nếu chỉ cập nhật Code Web (HTML/JS/CSS), bạn KHÔNG CẦN build lại APK. App load trực tiếp từ server.

Nếu cần build lại APK (ví dụ đổi icon, đổi server URL):

1. **Yêu cầu**: Java 17.
   (Hệ thống đã tự động dùng Java 17 tại `C:\Program Files\Java\jdk-17`)

2. **Lệnh build**:
   ```powershell
   cd mobile-app
   npx cap sync
   cd android
   $env:JAVA_HOME="C:\Program Files\Java\jdk-17"
   .\gradlew assembleDebug
   ```

3. **Copy APK**:
   ```powershell
   Copy-Item "app/build/outputs/apk/debug/app-debug.apk" "../../public/download/royal-casino.apk"
   ```
