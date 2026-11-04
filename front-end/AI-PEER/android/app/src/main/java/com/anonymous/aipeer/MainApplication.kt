package com.anonymous.aipeer

import android.app.Application
import android.content.res.Configuration
import android.preference.PreferenceManager

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

import com.anonymous.aipeer.poselandmarker.PoseLandmarkerFrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
            }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    // When app-debug.apk is compiled inside a Docker container, Gradle bakes the
    // container's internal bridge IP (172.x.x.x) into react_native_dev_server_ip.
    // Force debug_http_host to localhost:8081 so USB devices using `adb reverse`
    // always reach Metro on the host PC.
    if (BuildConfig.DEBUG) {
      val prefs = PreferenceManager.getDefaultSharedPreferences(this)
      val currentHost = prefs.getString("debug_http_host", null)
      if (currentHost.isNullOrBlank() || currentHost.startsWith("172.")) {
        prefs.edit().putString("debug_http_host", "localhost:8081").apply()
      }
    }
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }

  // ── VisionCamera frame processor plugin registration ──────────────────
  // Registers the "poseLandmarker" plugin so the shared TypeScript code in
  // src/vision/frameProcessor.ts can resolve it via
  //   VisionCameraProxy.initFrameProcessorPlugin('poseLandmarker', {})
  //
  // The companion-object init runs when MainApplication is class-loaded by
  // the JVM, which happens via android:name=".MainApplication" before
  // Application.onCreate() and before any JS bundle loads. Earlier than
  // onCreate so the registry is populated before any frame processor is
  // initialized from JS.
  //
  // Plugin name "poseLandmarker" MUST match exactly:
  //   - JS:  src/vision/frameProcessor.ts:19
  //   - iOS: ios/AIPEER/PoseLandmarkerPlugin.m:25
  // Mismatch silently makes poseLandmarkerPlugin === null in JS.
  companion object {
    init {
      FrameProcessorPluginRegistry.addFrameProcessorPlugin("poseLandmarker") { proxy, options ->
        PoseLandmarkerFrameProcessorPlugin(proxy, options)
      }
    }
  }
}
