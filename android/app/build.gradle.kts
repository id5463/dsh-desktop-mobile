plugins {
    id("com.android.application")
}

android {
    namespace = "com.dsh.mobile"
    compileSdk = 33

    defaultConfig {
        applicationId = "com.dsh.mobile"
        minSdk = 24
        targetSdk = 33
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

dependencies {
    // No external dependencies - use basic Android SDK only
    // This avoids network download issues
}