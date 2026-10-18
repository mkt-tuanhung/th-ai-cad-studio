; Inno Setup script — MD CAD AI STUDIO for Windows (x64). Built by build_windows.ps1.
#ifndef AppVersion
  #define AppVersion "0.1.1"
#endif
#ifndef StageDir
  #define StageDir "..\..\dist-win\MD CAD AI STUDIO"
#endif

[Setup]
AppId={{7E1B6C1E-5C2B-4C1A-9F4E-3A1D2B7C9E10}
AppName=MD CAD AI STUDIO
AppVersion={#AppVersion}
AppPublisher=Minh Dũng
DefaultDirName={autopf}\MD CAD AI STUDIO
DefaultGroupName=MD CAD AI STUDIO
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputBaseFilename=MD-CAD-AI-STUDIO-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; brand: the welcome page with the MD CAD AI STUDIO hero (exported from the app's InstallerWelcomeScreen by
; ui/tools/make-installer-art.mjs, one image per display scale) and the app icon
DisableWelcomePage=no
WizardImageFile=art\wizard-100.bmp,art\wizard-125.bmp,art\wizard-150.bmp,art\wizard-175.bmp,art\wizard-200.bmp,art\wizard-225.bmp,art\wizard-250.bmp
WizardSmallImageFile=art\small-100.bmp,art\small-125.bmp,art\small-150.bmp,art\small-175.bmp,art\small-200.bmp,art\small-225.bmp,art\small-250.bmp
WizardImageStretch=no
SetupIconFile=..\..\app\resources\branding\app.ico
AppVerName=MD CAD AI STUDIO {#AppVersion}
UninstallDisplayIcon={app}\MD CAD AI STUDIO.exe
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
; Vietnamese is an unofficial Inno Setup translation (not installed with Inno Setup): vendored from
; jrsoftware/issrc Files/Languages/Unofficial/Vietnamese.isl, same license as Inno Setup
Name: "vi"; MessagesFile: "Vietnamese.isl"

[Messages]
; the credit line must read exactly "Xây dựng và phát triển bởi Minh Dũng" in every language
en.WelcomeLabel1=Welcome to the setup of MD CAD AI STUDIO
en.WelcomeLabel2=Design Smarter. Build Faster.%n%nThis will install [name/ver] on your computer: 2D CAD, BIM, MEP, civil, mechanical, interior and renders, with a local AI that runs entirely on this machine — no account, no cloud.%n%nXây dựng và phát triển bởi Minh Dũng
vi.WelcomeLabel1=Chào mừng đến với trình cài đặt MD CAD AI STUDIO
vi.WelcomeLabel2=Design Smarter. Build Faster.%n%nTrình cài đặt sẽ cài [name/ver] lên máy: CAD 2D, BIM, MEP, hạ tầng, cơ khí, nội thất và render, cùng AI chạy hoàn toàn trên máy này — không tài khoản, không cloud.%n%nXây dựng và phát triển bởi Minh Dũng
en.FinishedHeadingLabel=MD CAD AI STUDIO is installed
vi.FinishedHeadingLabel=Đã cài đặt xong MD CAD AI STUDIO

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; updating over an earlier version: the bundled web UI is replaced as a whole (old hashed assets removed).
; The user's data is never here: projects, settings, the licence key, AI models and the 3D library live in the
; user's own folders (%APPDATA% / %LOCALAPPDATA%) and are kept by an update.
Type: filesandordirs; Name: "{app}\ui"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; the 3D interior library (Poly Haven CC0 starter set, user imports): %LOCALAPPDATA%\MD CAD AI STUDIO\library
Name: "{localappdata}\MD CAD AI STUDIO\library"
; local AI models live per user: %LOCALAPPDATA%\MD CAD AI STUDIO\models (never in Program Files)
Name: "{localappdata}\MD CAD AI STUDIO\models"

[Icons]
Name: "{group}\MD CAD AI STUDIO"; Filename: "{app}\MD CAD AI STUDIO.exe"
Name: "{autodesktop}\MD CAD AI STUDIO"; Filename: "{app}\MD CAD AI STUDIO.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\MD CAD AI STUDIO.exe"; Description: "{cm:LaunchProgram,MD CAD AI STUDIO}"; Flags: nowait postinstall skipifsilent
