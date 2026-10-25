plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 항상 같은 키로 서명해야 새 버전을 덮어 설치할 수 있다.
// GitHub Actions는 저장소 비밀값(SYNCMUSIC_KEYSTORE_B64)을 풀어 이 경로를 넘겨준다. 없으면 임시 디버그 키.
val sharedKeystore = System.getenv("SYNCMUSIC_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "com.syncmusic.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.syncmusic.companion"
        minSdk = 29 // MediaStore RELATIVE_PATH / IS_PENDING
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
    }

    signingConfigs {
        if (sharedKeystore != null) {
            create("shared") {
                storeFile = sharedKeystore
                storePassword = System.getenv("SYNCMUSIC_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SYNCMUSIC_KEY_ALIAS") ?: "syncmusic"
                keyPassword = System.getenv("SYNCMUSIC_KEYSTORE_PASSWORD")
                storeType = "pkcs12"
            }
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfigs.findByName("shared")?.let { signingConfig = it }
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("shared") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.media:media:1.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // 단위 테스트에서 진짜 org.json 쓰기
}
