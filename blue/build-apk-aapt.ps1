# APK build using aapt (legacy, simpler)
param(
    [string]$SdkRoot = "C:\Users\a\Android\Sdk",
    [string]$JavaHome = "I:\jdk17"
)

# 手动检查 $LASTEXITCODE，不用 Stop（否则 javac 警告会触发终止错误）
$ErrorActionPreference = "Continue"
$BuildTools = "$SdkRoot\build-tools\33.0.0"
$Platform = "$SdkRoot\platforms\android-33"
$AppDir = $PSScriptRoot
$AppSrc = "$AppDir\app\src\main"
$OutputDir = "$AppDir\build\apk"
$env:JAVA_HOME = $JavaHome
$env:PATH = "$JavaHome\bin;$env:PATH"

Write-Host "=== Building DSH Mobile APK ===" -ForegroundColor Cyan

# Clean
Remove-Item -Recurse -Force $OutputDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$OutputDir\classes", "$OutputDir\obj" | Out-Null

# Step 1: Generate R.java with aapt
Write-Host "[1/5] Generating R.java..." -ForegroundColor Yellow
$manifest = "$AppSrc\AndroidManifest.xml"
$resDir = "$AppSrc\res"
$genDir = "$OutputDir\gen"
New-Item -ItemType Directory -Force -Path $genDir | Out-Null

Write-Host "  Running: aapt package -f -m -M $manifest -S $resDir -I $Platform\android.jar -J $genDir" -ForegroundColor Gray
& "$BuildTools\aapt.exe" package -f -m -M $manifest -S $resDir -I "$Platform\android.jar" -J $genDir 2>&1
if ($LASTEXITCODE -ne 0) { throw "aapt R.java generation failed" }

# Verify R.java was generated
$rJava = Get-ChildItem $genDir -Recurse -Filter "R.java" -ErrorAction SilentlyContinue
if ($rJava) { Write-Host "  R.java generated: $($rJava.FullName)" -ForegroundColor Green }
else { throw "R.java not generated" }
Write-Host "  R.java generated" -ForegroundColor Green

# Step 2: Compile Java sources
Write-Host "[2/5] Compiling Java sources..." -ForegroundColor Yellow
$srcFiles = Get-ChildItem "$AppSrc\java" -Recurse -Filter "*.java" | ForEach-Object { $_.FullName }
$genFiles = Get-ChildItem "$OutputDir\gen" -Recurse -Filter "*.java" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
$allSrc = $srcFiles + $genFiles
$zxingJar = "I:\zxing-core.jar"
$javacOut = & "$JavaHome\bin\javac.exe" -d "$OutputDir\classes" -cp "$Platform\android.jar;$zxingJar" -encoding UTF-8 -source 8 -target 8 $allSrc 2>&1
$javacExit = $LASTEXITCODE
if ($javacExit -ne 0) {
    $javacOut | ForEach-Object { Write-Host $_ }
    throw "javac compilation failed (exit $javacExit)"
}
Write-Host "  Java compilation OK" -ForegroundColor Green

# Step 3: Convert to DEX (包含 zxing 库；用 java 直接调用，d8.bat 在 JDK17 下不可用)
Write-Host "[3/5] Converting to DEX..." -ForegroundColor Yellow
$classFiles = Get-ChildItem "$OutputDir\classes" -Recurse -Filter "*.class" | ForEach-Object { $_.FullName }
& "$JavaHome\bin\java.exe" -Xmx1024M -Xss1m --class-path "$BuildTools\lib\d8.jar" com.android.tools.r8.D8 --lib "$Platform\android.jar" --output "$OutputDir\obj" --min-api 24 $classFiles $zxingJar 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { throw "d8 conversion failed" }
Write-Host "  DEX conversion OK" -ForegroundColor Green

# Step 4: Package APK with aapt
Write-Host "[4/5] Packaging APK..." -ForegroundColor Yellow
& "$BuildTools\aapt.exe" package -f -M $manifest -S $resDir -I "$Platform\android.jar" --min-sdk-version 24 --target-sdk-version 33 --version-code 1 --version-name "$(Get-Date -Format '1.0.MMddHHmm')" -F "$OutputDir\obj\app-unsigned.apk" --auto-add-overlay 2>&1
if ($LASTEXITCODE -ne 0) { throw "aapt package failed" }

# Add classes.dex
$dexPath = "$OutputDir\obj\classes.dex"
if (Test-Path $dexPath) {
    Push-Location "$OutputDir\obj"
    & "$BuildTools\aapt.exe" add "app-unsigned.apk" "classes.dex" 2>&1 | Out-Null
    Pop-Location
    Write-Host "  Added classes.dex ($([math]::Round((Get-Item $dexPath).Length / 1KB)) KB)" -ForegroundColor Green
}

# Step 5: Align and sign
Write-Host "[5/5] Aligning and signing..." -ForegroundColor Yellow
& "$BuildTools\zipalign.exe" -f -v 4 "$OutputDir\obj\app-unsigned.apk" "$OutputDir\app-debug-unsigned.apk" 2>&1 | Out-Null

$keystorePath = "$env:USERPROFILE\.android\debug.keystore"
if (-not (Test-Path $keystorePath)) {
    & "$JavaHome\bin\keytool.exe" -genkey -v -keystore $keystorePath -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" 2>&1
}
& "$BuildTools\apksigner.bat" sign --ks $keystorePath --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android "$OutputDir\app-debug-unsigned.apk" 2>&1
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }
Copy-Item "$OutputDir\app-debug-unsigned.apk" "$OutputDir\app-debug.apk" -Force

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Green
$apkSize = (Get-Item "$OutputDir\app-debug.apk").Length / 1KB
Write-Host "APK: $OutputDir\app-debug.apk ($([math]::Round($apkSize)) KB)" -ForegroundColor Green
return "$OutputDir\app-debug.apk"