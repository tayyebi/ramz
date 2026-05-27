#!/bin/bash
# -----------------------------------------------------------------------
# Ramz Android — build script (zero Gradle / Maven dependency)
#
# Inspired by https://github.com/tayyebi/android-webclient
#
# Prerequisites:
#   - JDK 17+   (javac, keytool)
#   - Android SDK command-line & build-tools
#
# Environment variables (set these or edit the defaults below):
#   ANDROID_SDK_ROOT  — path to Android SDK (e.g. ~/Android/Sdk)
#   BUILD_TOOLS_VER   — build-tools version   (default: 34.0.0)
#   PLATFORM_VER      — platform version       (default: android-28)
# -----------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

# --- Configurable paths ------------------------------------------------
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}"
BUILD_TOOLS_VER="${BUILD_TOOLS_VER:-34.0.0}"
PLATFORM_VER="${PLATFORM_VER:-android-28}"

BT="$ANDROID_SDK_ROOT/build-tools/$BUILD_TOOLS_VER"
AAPT="$BT/aapt"
D8="$BT/d8"
ZIPALIGN="$BT/zipalign"
APKSIGNER="$BT/apksigner"
PLATFORM="$ANDROID_SDK_ROOT/platforms/$PLATFORM_VER/android.jar"

KEYSTORE="ramz.keystore"
KS_PASS="ramz-dev"
KS_ALIAS="ramz"

# --- Functions ----------------------------------------------------------

generate_keystore() {
    if [ ! -f "$KEYSTORE" ]; then
        echo "==> Generating self-signed keystore …"
        keytool -genkeypair \
            -keystore "$KEYSTORE" \
            -alias "$KS_ALIAS" \
            -keyalg RSA -keysize 2048 \
            -validity 10000 \
            -storepass "$KS_PASS" \
            -keypass "$KS_PASS" \
            -dname "CN=Ramz Dev,O=Ramz,C=US"
    fi
}

clean() {
    echo "==> Cleaning …"
    rm -rf obj bin classes.dex gen
    mkdir -p obj bin gen
}

build() {
    generate_keystore
    clean

    echo "==> Generating R.java …"
    $AAPT package -f -m \
        -J gen \
        -M AndroidManifest.xml \
        -S res \
        -I "$PLATFORM"

    echo "==> Compiling Java sources …"
    find src gen -name '*.java' > /tmp/ramz_sources.txt
    javac \
        -source 1.8 -target 1.8 \
        -classpath "$PLATFORM" \
        -d obj \
        @/tmp/ramz_sources.txt

    echo "==> Packaging resources …"
    $AAPT package -f -m \
        -F bin/app.unaligned.apk \
        -M AndroidManifest.xml \
        -S res \
        -I "$PLATFORM"

    echo "==> Creating classes.dex …"
    find obj -name '*.class' > /tmp/ramz_classes.txt
    $D8 --lib "$PLATFORM" --output . @/tmp/ramz_classes.txt
    $AAPT add bin/app.unaligned.apk classes.dex

    echo "==> Aligning APK …"
    $ZIPALIGN -f 4 bin/app.unaligned.apk bin/ramz.apk

    echo "==> Signing APK …"
    $APKSIGNER sign \
        --ks "$KEYSTORE" \
        --ks-key-alias "$KS_ALIAS" \
        --v1-signing-enabled true \
        --v2-signing-enabled true \
        --ks-pass "pass:$KS_PASS" \
        bin/ramz.apk

    echo "==> Verifying …"
    $APKSIGNER verify --print-certs -v bin/ramz.apk

    echo ""
    echo "✔ Build complete: bin/ramz.apk"
}

# --- Entry point --------------------------------------------------------
case "${1:-build}" in
    build) build ;;
    clean) clean ;;
    *)
        echo "Usage: $0 [build|clean]"
        exit 1
        ;;
esac
