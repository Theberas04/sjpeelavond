plugins { id("com.android.application") }

// De versie staat in version.txt; versionCode volgt de vaste formule
// (1.0.0 -> 10000) zodat een nieuwe versie altijd over de oude heen installeert.
val appVersionName = rootProject.file("version.txt").readText().trim()
val versiedelen = appVersionName.split(".")
val appVersionCode = versiedelen[0].toInt() * 10000 + versiedelen[1].toInt() * 100 + versiedelen[2].toInt()

// Ondertekend met de vaste sleutel van Tom (dezelfde als zijn andere apps), zodat een
// nieuwe versie over de oude heen installeert. In de bouwpijplijn komt de sleutel uit
// GitHub-secrets; staat hij er niet, dan bouwt Gradle een niet-ondertekende APK.
val keystoreFile = File(System.getenv("ANDROID_KEYSTORE_PATH") ?: rootProject.file("app/release.p12").absolutePath)
val hasKeystore = keystoreFile.exists() && !System.getenv("ANDROID_KEYSTORE_PASSWORD").isNullOrEmpty()

android {
    namespace = "nl.werdens.sjpeelavond"
    compileSdk = 35

    defaultConfig {
        applicationId = "nl.werdens.sjpeelavond"
        // 24 is de ondergrens die Play Protect aanhoudt voor een installatie.
        minSdk = 24
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName
    }

    signingConfigs {
        create("release") {
            if (hasKeystore) {
                storeFile = keystoreFile
                storeType = "PKCS12"
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "thuis"
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (hasKeystore) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    // Alleen voor WebViewAssetLoader: de app-schil verder zonder toeters en bellen.
    implementation("androidx.webkit:webkit:1.12.1")

    // ZXing leest de QR-code van een kaartje. Eén bibliotheek, geen dienst eromheen:
    // het beeld gaat er rechtstreeks in (zie QrLezer.java).
    implementation("com.google.zxing:core:3.5.3")

    // De proef op QrLezer bouwt zelf een QR-code en eist dat de lezer de tekst er weer
    // uithaalt; dat kan zonder toestel en zonder camera.
    testImplementation("junit:junit:4.13.2")
}
