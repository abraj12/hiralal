const {
  withAppBuildGradle,
  withMainApplication,
  createRunOncePlugin,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const INTEGRITY_DEPENDENCY = "implementation 'com.google.android.play:integrity:1.4.0'";

function insertImportAfterPackageDeclaration(contents, qualifiedName, isKotlin) {
  const importLine = `import ${qualifiedName}${isKotlin ? '' : ';'}`;

  if (contents.split(/\r?\n/).some((line) => line.trim() === importLine)) {
    return contents;
  }

  const packageMatch = contents.match(
    /^[ \t]*package[ \t]+[A-Za-z0-9_.]+;?[ \t]*\r?\n/m
  );

  if (!packageMatch || packageMatch.index === undefined) {
    throw new Error(
      'Cannot register Play Integrity: MainApplication has no recognizable package declaration.'
    );
  }

  const insertAt = packageMatch.index + packageMatch[0].length;

  return (
    contents.slice(0, insertAt) +
    `${importLine}\n` +
    contents.slice(insertAt)
  );
}

function registerPlayIntegrityPackage(contents, isKotlin) {
  if (contents.includes('PlayIntegrityPackage()') || contents.includes('new PlayIntegrityPackage()')) {
    return contents;
  }

  if (isKotlin) {
    if (contents.includes('PackageList(this).packages.apply {')) {
      return contents.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n              add(PlayIntegrityPackage())'
      );
    }
    if (contents.includes('PackageList(this).packages')) {
      return contents.replace(
        'PackageList(this).packages',
        'PackageList(this).packages.apply {\n              add(PlayIntegrityPackage())\n            }'
      );
    }
    throw new Error(
      'Cannot register Play Integrity: MainApplication.kt does not match any recognized Kotlin package registration pattern.'
    );
  } else {
    if (contents.includes('List<ReactPackage> packages = new PackageList(this).getPackages();')) {
      return contents.replace(
        'List<ReactPackage> packages = new PackageList(this).getPackages();',
        'List<ReactPackage> packages = new PackageList(this).getPackages();\n      packages.add(new PlayIntegrityPackage());'
      );
    }
    if (contents.includes('new PackageList(this).getPackages();')) {
      return contents.replace(
        'new PackageList(this).getPackages();',
        'new PackageList(this).getPackages();\n      packages.add(new PlayIntegrityPackage());'
      );
    }
    if (contents.includes('new PackageList(this).getPackages()')) {
      return contents.replace(
        'new PackageList(this).getPackages()',
        'new PackageList(this).getPackages();\n      packages.add(new PlayIntegrityPackage())'
      );
    }
    throw new Error(
      'Cannot register Play Integrity: MainApplication.java does not match any recognized Java package registration pattern.'
    );
  }
}

function withPlayIntegrityBuildGradle(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (!gradleConfig.modResults.contents.includes(INTEGRITY_DEPENDENCY)) {
      gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    ${INTEGRITY_DEPENDENCY}`
      );
    }
    return gradleConfig;
  });
}

function withPlayIntegrityNativeFiles(config) {
  return withMainApplication(config, (mainAppConfig) => {
    const projectRoot = mainAppConfig.modRequest.projectRoot;
    const androidPackage = config.android?.package || 'com.hiralal.rewards';
    const packagePath = androidPackage.replace(/\./g, '/');
    const targetDir = path.join(
      projectRoot,
      'android/app/src/main/java',
      packagePath,
      'integrity'
    );

    fs.mkdirSync(targetDir, { recursive: true });

    // 1. PlayIntegrityModule.java
    const moduleJava = `package ${androidPackage}.integrity;

import android.content.Context;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.google.android.play.core.integrity.IntegrityManager;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;
import com.google.android.play.core.integrity.IntegrityTokenResponse;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.android.gms.tasks.OnFailureListener;

public class PlayIntegrityModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;

    public PlayIntegrityModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "PlayIntegrity";
    }

    @ReactMethod
    public void requestIntegrityToken(String nonce, Promise promise) {
        try {
            if (nonce == null || nonce.trim().isEmpty()) {
                promise.reject("ERR_INVALID_NONCE", "Nonce is required for Play Integrity request");
                return;
            }

            IntegrityManager integrityManager = IntegrityManagerFactory.create(reactContext);
            IntegrityTokenRequest request = IntegrityTokenRequest.builder()
                .setNonce(nonce)
                .build();

            integrityManager.requestIntegrityToken(request)
                .addOnSuccessListener(new OnSuccessListener<IntegrityTokenResponse>() {
                    @Override
                    public void onSuccess(IntegrityTokenResponse response) {
                        promise.resolve(response.token());
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override
                    public void onFailure(Exception e) {
                        promise.reject("ERR_PLAY_INTEGRITY_FAILED", e.getMessage() != null ? e.getMessage() : "Play Integrity request failed", e);
                    }
                });
        } catch (Exception e) {
            promise.reject("ERR_PLAY_INTEGRITY_EXCEPTION", e.getMessage() != null ? e.getMessage() : "Error initializing Play Integrity", e);
        }
    }
}
`;
    fs.writeFileSync(path.join(targetDir, 'PlayIntegrityModule.java'), moduleJava, 'utf8');

    // 2. PlayIntegrityPackage.java
    const packageJava = `package ${androidPackage}.integrity;

import androidx.annotation.NonNull;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class PlayIntegrityPackage implements ReactPackage {
    @NonNull
    @Override
    public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new PlayIntegrityModule(reactContext));
        return modules;
    }

    @NonNull
    @Override
    public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
`;
    fs.writeFileSync(path.join(targetDir, 'PlayIntegrityPackage.java'), packageJava, 'utf8');

    // 3. Register package in MainApplication.kt or MainApplication.java
    let contents = mainAppConfig.modResults.contents;
    const isKotlin =
      mainAppConfig.modResults.language === 'kt' ||
      mainAppConfig.modRequest?.mainApplicationPath?.endsWith('.kt') ||
      contents.includes('class MainApplication :') ||
      contents.includes('fun getPackages');

    // Safe import insertion after package declaration
    contents = insertImportAfterPackageDeclaration(
      contents,
      `${androidPackage}.integrity.PlayIntegrityPackage`,
      isKotlin
    );

    // Register package in package list
    contents = registerPlayIntegrityPackage(contents, isKotlin);

    mainAppConfig.modResults.contents = contents;
    return mainAppConfig;
  });
}

function withPlayIntegrity(config) {
  config = withPlayIntegrityBuildGradle(config);
  config = withPlayIntegrityNativeFiles(config);
  return config;
}

const plugin = createRunOncePlugin(withPlayIntegrity, 'withPlayIntegrity', '1.0.0');
plugin.insertImportAfterPackageDeclaration = insertImportAfterPackageDeclaration;
plugin.registerPlayIntegrityPackage = registerPlayIntegrityPackage;
plugin.withPlayIntegrityBuildGradle = withPlayIntegrityBuildGradle;
plugin.withPlayIntegrityNativeFiles = withPlayIntegrityNativeFiles;

module.exports = plugin;
