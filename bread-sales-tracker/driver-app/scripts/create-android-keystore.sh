#!/bin/sh
# Creates the release signing key for the Android app (do this ONCE, then keep the file safe).
# Every app update must be signed with the same key, otherwise phones refuse to install the update.
#
# Usage: sh scripts/create-android-keystore.sh
# Needs Java's "keytool" (comes with Java / Android Studio).
set -e
FILE=bread-sales-release.jks
ALIAS=breadsales
if [ -e "$FILE" ]; then
  echo "$FILE already exists - not overwriting it."
  exit 1
fi
printf "Choose a password for the key (at least 6 characters): "
stty -echo 2>/dev/null || true
read -r PASS
stty echo 2>/dev/null || true
echo
keytool -genkeypair -keystore "$FILE" -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=Bread Sales, O=Bread Sales, C=IN"
base64 < "$FILE" | tr -d '\n' > "$FILE.base64.txt"
cat <<MSG

Done. Now add these two in GitHub: your repository > Settings > Secrets and variables > Actions > New repository secret

  ANDROID_KEYSTORE_BASE64   = the whole text inside $FILE.base64.txt
  ANDROID_KEYSTORE_PASSWORD = the password you just typed

(The key alias "$ALIAS" and key password = keystore password are the defaults, so nothing else is needed.)

Then delete $FILE.base64.txt, and store $FILE + the password somewhere safe (e.g. Google Drive + password manager).
NEVER commit $FILE to git.
MSG
